import { Coordinates, DeliveryOrder } from '../types/messigo';
import { isValidCoordinates, normalizeDigits, parseMapUrl } from './whatsappParser';

export interface GeocodingSearchResult {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Generates normalized Arabic query variations to handle Egyptian & Arabic spelling differences:
 * e.g. "سيتى سنتر مدينه نصر" -> "سيتي سنتر مدينة نصر"
 *      "النادى الاهلى" -> "النادي الأهلي"
 */
export function buildArabicSearchVariants(rawQuery: string): string[] {
  const clean = normalizeDigits(rawQuery)
    .trim()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!clean) return [];

  // Variant 1: Standardize final ى -> ي and common Egyptian ه -> ة words
  const standardized = clean
    .replace(/ى(?=\s|$)/g, 'ي')
    .replace(/\bمدينه\b/g, 'مدينة')
    .replace(/\bالمدينه\b/g, 'المدينة')
    .replace(/\bالقاهره\b/g, 'القاهرة')
    .replace(/\bالجيزه\b/g, 'الجيزة')
    .replace(/\bالاسكندريه\b|\bالإسكندريه\b|\bاسكندريه\b|\bاسكندرية\b/g, 'الإسكندرية')
    .replace(/\bالمنصوره\b/g, 'المنصورة')
    .replace(/\bالزقازيق\b/g, 'الزقازيق')
    .replace(/\bالمحله\b/g, 'المحلة')
    .replace(/\bالغردقه\b/g, 'الغردقة')
    .replace(/\bبوابه\b/g, 'بوابة')
    .replace(/\bحديقه\b/g, 'حديقة')
    .replace(/\bمكتبه\b/g, 'مكتبة')
    .replace(/\bصيدليه\b/g, 'صيدلية')
    .replace(/\bجامعه\b/g, 'جامعة')
    .replace(/\bمدرسه\b/g, 'مدرسة')
    .replace(/\bمحطه\b/g, 'محطة')
    .replace(/\bالاهلي\b|\bالاهلى\b/g, 'الأهلي')
    .replace(/\bالماظه\b|\bالماظة\b/g, 'ألماظة')
    .replace(/\bنزهه\b|\bالنزهه\b/g, 'النزهة')
    .replace(/\bمصر الجديده\b/g, 'مصر الجديدة');

  // Variant 2: Without "فرع" which sometimes confuses strict geocoders
  const withoutBranch = standardized
    .replace(/\bفرع\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return Array.from(new Set([standardized, clean, withoutBranch].filter(Boolean)));
}

/**
 * Queries Photon (OpenStreetMap Komoot geocoder) which is fast, CORS-friendly, and handles OSM POIs well.
 */
async function fetchPhotonResults(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.features)) return [];

    return data.features
      .map(
        (f: {
          geometry?: { coordinates?: [number, number] };
          properties?: {
            name?: string;
            street?: string;
            district?: string;
            city?: string;
            state?: string;
            country?: string;
          };
        }) => {
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!isValidCoordinates(lat, lng)) return null;

          const p = f.properties || {};
          const parts = [p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean);
          const displayName = parts.length > 0 ? Array.from(new Set(parts)).join('، ') : query;

          return { lat, lng, displayName };
        }
      )
      .filter((item: GeocodingSearchResult | null): item is GeocodingSearchResult => item !== null);
  } catch {
    return [];
  }
}

/**
 * Queries ArcGIS World Geocoding Service which has strong Arabic street & landmark coverage.
 */
async function fetchArcGisResults(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(
      query
    )}&maxLocations=6&outFields=Match_addr,PlaceName,Place_addr`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.candidates)) return [];

    return data.candidates
      .map(
        (c: {
          address?: string;
          location?: { x?: number; y?: number };
          attributes?: { PlaceName?: string; Place_addr?: string; Match_addr?: string };
        }) => {
          const lat = Number(c.location?.y);
          const lng = Number(c.location?.x);
          if (!isValidCoordinates(lat, lng)) return null;

          const placeName = c.attributes?.PlaceName || '';
          const placeAddr = c.attributes?.Place_addr || c.attributes?.Match_addr || c.address || '';
          const displayName =
            placeName && placeAddr && !placeAddr.includes(placeName)
              ? `${placeName} — ${placeAddr}`
              : placeAddr || placeName || query;

          return { lat, lng, displayName };
        }
      )
      .filter((item: GeocodingSearchResult | null): item is GeocodingSearchResult => item !== null);
  } catch {
    return [];
  }
}

/**
 * Queries OpenStreetMap Nominatim as an additional source.
 */
async function fetchNominatimResults(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      query
    )}&limit=5&accept-language=ar,en`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((item: { lat?: string; lon?: string; display_name?: string }) => ({
        lat: parseFloat(String(item.lat)),
        lng: parseFloat(String(item.lon)),
        displayName: item.display_name || query,
      }))
      .filter((item) => isValidCoordinates(item.lat, item.lng));
  } catch {
    return [];
  }
}

/**
 * Multi-provider Arabic & English place search:
 * 1. Checks if the user pasted a Google Maps URL or direct coordinates (lat, lng).
 * 2. Normalizes Egyptian/Arabic spelling variations (e.g. سيتى سنتر مدينه نصر -> سيتي سنتر مدينة نصر).
 * 3. Queries Photon (OSM), ArcGIS World Geocoder, and Nominatim, combining and deduplicating results.
 */
export async function searchPlaceNominatim(query: string): Promise<GeocodingSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length < 2) return [];

  // 1. Check if input is a Google Maps link
  if (/^https?:\/\//i.test(cleanQuery) || /google\.com\/maps|goo\.gl/i.test(cleanQuery)) {
    const parsed = parseMapUrl(cleanQuery);
    if (parsed.coordinates) {
      return [
        {
          lat: parsed.coordinates.lat,
          lng: parsed.coordinates.lng,
          displayName: `إحداثيات مستخرجة من الرابط (${parsed.coordinates.lat.toFixed(5)}, ${parsed.coordinates.lng.toFixed(5)})`,
        },
      ];
    }
    if (parsed.searchQuery) {
      return searchPlaceNominatim(parsed.searchQuery);
    }
  }

  // 2. Check if input is direct numeric coordinates "30.068, 31.344"
  const normDigits = normalizeDigits(cleanQuery);
  const directCoordMatch = normDigits.match(
    /^([+-]?\d{1,2}\.\d{2,})\s*[,،\s]\s*([+-]?\d{1,3}\.\d{2,})$/
  );
  if (directCoordMatch) {
    const lat = parseFloat(directCoordMatch[1]);
    const lng = parseFloat(directCoordMatch[2]);
    if (isValidCoordinates(lat, lng)) {
      return [
        {
          lat,
          lng,
          displayName: `إحداثيات مباشرة (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        },
      ];
    }
  }

  // 3. Build Arabic spelling variants and query providers
  const variants = buildArabicSearchVariants(cleanQuery);
  const primaryVariant = variants[0] || cleanQuery;

  const [photonRes, arcgisRes, nominatimRes] = await Promise.all([
    fetchPhotonResults(primaryVariant),
    fetchArcGisResults(primaryVariant),
    fetchNominatimResults(primaryVariant),
  ]);

  let combined = [...photonRes, ...arcgisRes, ...nominatimRes];

  // If primary variant returned nothing or only 1 broad result and we have another variant, try it too
  if (combined.length === 0 && variants.length > 1) {
    for (let i = 1; i < variants.length; i++) {
      const [p2, a2] = await Promise.all([
        fetchPhotonResults(variants[i]),
        fetchArcGisResults(variants[i]),
      ]);
      combined.push(...p2, ...a2);
      if (combined.length > 0) break;
    }
  }

  // Deduplicate results that are within 35 meters of each other
  const uniqueResults: GeocodingSearchResult[] = [];
  for (const candidate of combined) {
    const isDup = uniqueResults.some(
      (existing) =>
        calculateDistanceMetersBetweenCoords(
          { lat: existing.lat, lng: existing.lng },
          { lat: candidate.lat, lng: candidate.lng }
        ) < 35
    );
    if (!isDup) {
      uniqueResults.push({
        lat: Number(candidate.lat.toFixed(6)),
        lng: Number(candidate.lng.toFixed(6)),
        displayName: candidate.displayName,
      });
    }
  }

  return uniqueResults.slice(0, 8);
}

/**
 * Reverse-geocodes coordinates clicked on the map into a human-readable Arabic street/area name.
 */
export async function reverseGeocodeCoordinates(coords: Coordinates): Promise<string | null> {
  if (!isValidCoordinates(coords.lat, coords.lng)) return null;
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${coords.lng},${coords.lat}&langCode=ar`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const addr = data?.address?.LongLabel || data?.address?.Match_addr || data?.address?.Address;
      if (addr && typeof addr === 'string') {
        return addr;
      }
    }
  } catch {
    // Fallback to Photon reverse
  }

  try {
    const photonUrl = `https://photon.komoot.io/reverse?lon=${coords.lng}&lat=${coords.lat}`;
    const res = await fetch(photonUrl);
    if (res.ok) {
      const data = await res.json();
      const p = data?.features?.[0]?.properties;
      if (p) {
        const parts = [p.name, p.street, p.district, p.city].filter(Boolean);
        if (parts.length > 0) return parts.join('، ');
      }
    }
  } catch {
    // Ignore reverse geocode failure
  }

  return null;
}

/**
 * Computes Haversine distance in meters between two coordinates (used ONLY for duplicate location warning detection,
 * NEVER used for route optimization which uses actual OSRM road network distances).
 */
export function calculateDistanceMetersBetweenCoords(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Recalculates location validity statuses and detects duplicate locations across all orders
 * without deleting any duplicate order.
 */
export function recalculateOrdersLocationStatus(orders: DeliveryOrder[]): DeliveryOrder[] {
  // First pass: validate coordinates and base status
  const updated = orders.map((order) => {
    const copy: DeliveryOrder = {
      ...order,
      hasDuplicateLocation: false,
      duplicateWithNames: [],
    };

    if (!copy.coordinates) {
      if (copy.locationStatus === 'الإحداثيات غير صحيحة') {
        return copy;
      }
      if (copy.searchQueryFromUrl || copy.locationText || copy.address || copy.mapUrl) {
        copy.locationStatus =
          copy.locationStatus === 'الموقع غير موجود' ? 'الموقع غير موجود' : 'يحتاج إلى مراجعة';
      } else {
        copy.locationStatus = 'الموقع غير موجود';
      }
      return copy;
    }

    if (!isValidCoordinates(copy.coordinates.lat, copy.coordinates.lng)) {
      copy.locationStatus = 'الإحداثيات غير صحيحة';
      copy.reviewNote = 'الإحداثيات المدخلة خارج النطاق الجغرافي الصحيح.';
      return copy;
    }

    if (!copy.locationConfirmedByUser) {
      copy.locationStatus = 'يحتاج إلى مراجعة';
      if (!copy.reviewNote) {
        copy.reviewNote =
          'تم تحديد الموقع المبدئي من خلال خدمة الخرائط؛ يرجى مراجعته وتأكيده قبل حساب المسار.';
      }
      return copy;
    }

    copy.locationStatus = 'الموقع صحيح';
    return copy;
  });

  // Second pass: detect orders sharing the exact same (or within 20m) location
  for (let i = 0; i < updated.length; i++) {
    const a = updated[i];
    if (!a.coordinates || !isValidCoordinates(a.coordinates.lat, a.coordinates.lng)) continue;

    const dupNames: string[] = [];
    for (let j = 0; j < updated.length; j++) {
      if (i === j) continue;
      const b = updated[j];
      if (!b.coordinates || !isValidCoordinates(b.coordinates.lat, b.coordinates.lng)) continue;

      const dist = calculateDistanceMetersBetweenCoords(a.coordinates, b.coordinates);
      if (dist <= 20) {
        dupNames.push(b.customerName || `أوردر #${j + 1}`);
      }
    }

    if (dupNames.length > 0) {
      a.hasDuplicateLocation = true;
      a.duplicateWithNames = dupNames;
      if (a.locationConfirmedByUser && a.locationStatus === 'الموقع صحيح') {
        a.locationStatus = 'يوجد أوردر آخر في نفس الموقع';
      }
    }
  }

  return updated;
}

/**
 * Attempts to geocode orders that have a searchQueryFromUrl or locationText/address but no direct coordinates.
 * Marks found locations as "يحتاج إلى مراجعة" (`locationConfirmedByUser = false`) so the user explicitly reviews and confirms them.
 */
export async function resolvePendingOrderLocations(
  orders: DeliveryOrder[],
  onProgress?: (current: number, total: number) => void
): Promise<DeliveryOrder[]> {
  const result: DeliveryOrder[] = [...orders];
  const indicesToResolve = result
    .map((o, idx) => ({ o, idx }))
    .filter(
      ({ o }) =>
        !o.coordinates &&
        o.locationStatus !== 'الإحداثيات غير صحيحة' &&
        Boolean(o.searchQueryFromUrl || o.locationText || o.address)
    );

  for (let i = 0; i < indicesToResolve.length; i++) {
    const { o, idx } = indicesToResolve[i];
    if (onProgress) {
      onProgress(i + 1, indicesToResolve.length);
    }

    const queryToTry = o.searchQueryFromUrl || o.locationText || o.address;
    if (!queryToTry) continue;

    const matches = await searchPlaceNominatim(queryToTry);
    if (matches.length > 0) {
      const best = matches[0];
      result[idx] = {
        ...o,
        coordinates: { lat: best.lat, lng: best.lng },
        geocodedDisplayName: best.displayName,
        locationConfirmedByUser: false,
        locationStatus: 'يحتاج إلى مراجعة',
        reviewNote:
          'تم العثور على الموقع عبر خدمة الخرائط بناءً على نص البحث؛ يرجى مراجعته على الخريطة والضغط على «تأكيد صحة الموقع».',
      };
    } else {
      result[idx] = {
        ...o,
        locationStatus: 'الموقع غير موجود',
        reviewNote:
          'تعذر العثور على إحداثيات تلقائية لهذا العنوان؛ يرجى تحديد الموقع يدويًا على الخريطة.',
      };
    }
  }

  return recalculateOrdersLocationStatus(result);
}
