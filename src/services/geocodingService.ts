import { Coordinates, DeliveryOrder } from '../types/messigo';
import { EGYPT_BOUNDS, isValidCoordinates, normalizeDigits, parseMapUrl } from './whatsappParser';

export interface GeocodingSearchResult {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Generates normalized Arabic query variations tailored specifically for Egypt:
 * - Standardizes Egyptian Arabic spelling (ى -> ي, مدينه -> مدينة, etc.)
 * - Strips apartment/floor/villa unit numbers for cleaner landmark matching
 * - Appends "مصر" context when needed so geocoders prioritize Egyptian districts
 */
export function buildArabicSearchVariants(rawQuery: string): string[] {
  const clean = normalizeDigits(rawQuery)
    .trim()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!clean) return [];

  const standardized = clean
    .replace(/ى(?=\s|$)/g, 'ي')
    .replace(/\bمدينه\b/g, 'مدينة')
    .replace(/\bالمدينه\b/g, 'المدينة')
    .replace(/\bالقاهره\b/g, 'القاهرة')
    .replace(/\bالجيزه\b/g, 'الجيزة')
    .replace(/\bالاسكندريه\b|\bالإسكندريه\b|\bاسكندريه\b|\bاسكندرية\b/g, 'الإسكندرية')
    .replace(/\bالمنصوره\b/g, 'المنصورة')
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
    .replace(/\bمصر الجديده\b/g, 'مصر الجديدة')
    .replace(/\bقطاميه\b/g, 'قطامية')
    .replace(/\bالقطاميه\b/g, 'القطامية')
    .replace(/\bالمرحله\b/g, 'المرحلة');

  // Strip unit/villa/floor/gate numbers ("فيلا 331", "الدور الأول", "شقة 4", "الدخول من بوابة 4")
  const cleanedLandmarkOrDistrict = standardized
    .replace(/(?:الدخول من\s*)?بوابة\s*\d+/g, '')
    .replace(/الدور\s+\S+/g, '')
    .replace(/شقة\s*\d+/g, '')
    .replace(/فيلا\s*\d+/g, '')
    .replace(/المرحلة\s*\d+/g, '')
    .replace(/^\d+\s+/, '')
    .replace(/\bفرع\s+/g, '')
    .replace(/[،,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const withEgyptSuffix = /مصر/i.test(cleanedLandmarkOrDistrict)
    ? cleanedLandmarkOrDistrict
    : `${cleanedLandmarkOrDistrict}، مصر`;

  return Array.from(
    new Set(
      [standardized, cleanedLandmarkOrDistrict, withEgyptSuffix, clean].filter(
        (s) => s.length >= 2
      )
    )
  );
}

/**
 * Queries Photon (OpenStreetMap) strictly bounded to Egypt (`bbox=24.6,22.0,37.0,31.8` and biased to Cairo).
 */
async function fetchPhotonResultsEgypt(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const bbox = `${EGYPT_BOUNDS.minLng},${EGYPT_BOUNDS.minLat},${EGYPT_BOUNDS.maxLng},${EGYPT_BOUNDS.maxLat}`;
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      query
    )}&bbox=${bbox}&lat=30.0444&lon=31.2357&limit=8`;
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
            countrycode?: string;
          };
        }) => {
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);

          // Strictly enforce Egypt boundaries & country code
          if (!isValidCoordinates(lat, lng)) return null;
          const p = f.properties || {};
          if (p.countrycode && p.countrycode.toUpperCase() !== 'EG') return null;

          const parts = [p.name, p.street, p.district, p.city, p.state].filter(Boolean);
          const displayName =
            parts.length > 0 ? Array.from(new Set(parts)).join('، ') : query;

          return { lat, lng, displayName };
        }
      )
      .filter(
        (item: GeocodingSearchResult | null): item is GeocodingSearchResult =>
          item !== null
      );
  } catch {
    return [];
  }
}

/**
 * Queries ArcGIS World Geocoding Service strictly restricted to Egypt (`countryCode=EGY`).
 */
async function fetchArcGisResultsEgypt(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const searchExtent = `${EGYPT_BOUNDS.minLng},${EGYPT_BOUNDS.minLat},${EGYPT_BOUNDS.maxLng},${EGYPT_BOUNDS.maxLat}`;
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(
      query
    )}&countryCode=EGY&searchExtent=${searchExtent}&location=31.2357,30.0444&maxLocations=8&outFields=Match_addr,PlaceName,Place_addr,Country`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.candidates)) return [];

    return data.candidates
      .map(
        (c: {
          address?: string;
          location?: { x?: number; y?: number };
          attributes?: {
            PlaceName?: string;
            Place_addr?: string;
            Match_addr?: string;
            Country?: string;
          };
        }) => {
          const lat = Number(c.location?.y);
          const lng = Number(c.location?.x);
          if (!isValidCoordinates(lat, lng)) return null;
          if (c.attributes?.Country && c.attributes.Country !== 'EGY') return null;

          const placeName = c.attributes?.PlaceName || '';
          const placeAddr =
            c.attributes?.Place_addr || c.attributes?.Match_addr || c.address || '';
          const displayName =
            placeName && placeAddr && !placeAddr.includes(placeName)
              ? `${placeName} — ${placeAddr}`
              : placeAddr || placeName || query;

          return { lat, lng, displayName };
        }
      )
      .filter(
        (item: GeocodingSearchResult | null): item is GeocodingSearchResult =>
          item !== null
      );
  } catch {
    return [];
  }
}

/**
 * Queries OpenStreetMap Nominatim strictly restricted to Egypt (`countrycodes=eg&bounded=1`).
 */
async function fetchNominatimResultsEgypt(query: string): Promise<GeocodingSearchResult[]> {
  try {
    const viewbox = `${EGYPT_BOUNDS.minLng},${EGYPT_BOUNDS.maxLat},${EGYPT_BOUNDS.maxLng},${EGYPT_BOUNDS.minLat}`;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      query
    )}&countrycodes=eg&viewbox=${viewbox}&bounded=1&limit=5&accept-language=ar,en`;
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
 * Egypt-dedicated multi-provider place search:
 * Guarantees all returned locations are strictly inside Egypt (`مصر`).
 */
export async function searchPlaceNominatim(query: string): Promise<GeocodingSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length < 2) return [];

  // 1. Check if input is a Google Maps link
  if (/^https?:\/\//i.test(cleanQuery) || /google\.com\/maps|goo\.gl/i.test(cleanQuery)) {
    const parsed = parseMapUrl(cleanQuery);
    if (parsed.coordinates && isValidCoordinates(parsed.coordinates.lat, parsed.coordinates.lng)) {
      return [
        {
          lat: parsed.coordinates.lat,
          lng: parsed.coordinates.lng,
          displayName: `إحداثيات مستخرجة داخل مصر (${parsed.coordinates.lat.toFixed(5)}, ${parsed.coordinates.lng.toFixed(5)})`,
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
          displayName: `إحداثيات مباشرة داخل مصر (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        },
      ];
    }
  }

  // 3. Build Egypt-focused Arabic search variants and query providers
  const variants = buildArabicSearchVariants(cleanQuery);
  const primaryVariant = variants[0] || cleanQuery;

  const [photonRes, arcgisRes, nominatimRes] = await Promise.all([
    fetchPhotonResultsEgypt(primaryVariant),
    fetchArcGisResultsEgypt(primaryVariant),
    fetchNominatimResultsEgypt(primaryVariant),
  ]);

  const combined = [...photonRes, ...arcgisRes, ...nominatimRes];

  if (variants.length > 1) {
    for (let i = 1; i < variants.length; i++) {
      const [p2, a2] = await Promise.all([
        fetchPhotonResultsEgypt(variants[i]),
        fetchArcGisResultsEgypt(variants[i]),
      ]);
      combined.push(...p2, ...a2);
      if (combined.length >= 5) break;
    }
  }

  // Deduplicate results that are within 35 meters of each other and strictly inside Egypt
  const uniqueResults: GeocodingSearchResult[] = [];
  for (const candidate of combined) {
    if (!isValidCoordinates(candidate.lat, candidate.lng)) continue;
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
 * Reverse-geocodes coordinates clicked on the map into a human-readable Arabic street/area name inside Egypt.
 */
export async function reverseGeocodeCoordinates(coords: Coordinates): Promise<string | null> {
  if (!isValidCoordinates(coords.lat, coords.lng)) return null;
  try {
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${coords.lng},${coords.lat}&langCode=ar`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const addr =
        data?.address?.LongLabel || data?.address?.Match_addr || data?.address?.Address;
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
 * Computes Haversine distance in meters between two coordinates (used ONLY for duplicate location warning detection).
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
      copy.reviewNote = 'الإحداثيات خارج حدود جمهورية مصر العربية؛ يرجى تحديد الموقع داخل مصر.';
      return copy;
    }

    if (!copy.locationConfirmedByUser) {
      copy.locationStatus = 'يحتاج إلى مراجعة';
      if (!copy.reviewNote) {
        copy.reviewNote =
          'تم تحديد الموقع المبدئي داخل مصر من خلال خدمة الخرائط؛ يرجى مراجعته وتأكيده قبل حساب المسار.';
      }
      return copy;
    }

    copy.locationStatus = 'الموقع صحيح';
    return copy;
  });

  // Detect orders sharing the exact same (or within 20m) location
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
 * Strictly resolves only to locations inside Egypt.
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
          'تم العثور على الموقع داخل مصر عبر خدمة الخرائط؛ يرجى مراجعته والضغط على «تأكيد صحة الموقع».',
      };
    } else {
      result[idx] = {
        ...o,
        locationStatus: 'الموقع غير موجود',
        reviewNote:
          'تعذر العثور على إحداثيات تلقائية لهذا العنوان داخل مصر؛ يرجى تحديد الموقع يدويًا على الخريطة.',
      };
    }
  }

  return recalculateOrdersLocationStatus(result);
}
