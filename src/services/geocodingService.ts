import { Coordinates, DeliveryOrder } from '../types/messigo';
import { isValidCoordinates } from './whatsappParser';

export interface GeocodingSearchResult {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Searches OpenStreetMap Nominatim for a place query (e.g., extracted from a Google Maps search link
 * or typed in the manual map search modal).
 * Does NOT send customer names, phone numbers, or prices—only the geographic query text.
 */
export async function searchPlaceNominatim(query: string): Promise<GeocodingSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const tryFetch = async (q: string): Promise<GeocodingSearchResult[]> => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      q
    )}&limit=5&accept-language=ar,en`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`فشل الاتصال بخدمة البحث عن المواقع (${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((item: { lat?: string; lon?: string; display_name?: string }) => ({
        lat: parseFloat(String(item.lat)),
        lng: parseFloat(String(item.lon)),
        displayName: item.display_name || q,
      }))
      .filter((item) => isValidCoordinates(item.lat, item.lng));
  };

  try {
    let results = await tryFetch(cleanQuery);
    // If query contains dashes like "النادي الأهلي – فرع مدينة نصر، القاهرة" and Nominatim returns empty,
    // try normalizing dashes/punctuation into spaces so OpenStreetMap finds the landmark accurately.
    if (results.length === 0 && /[–—\-،,]/.test(cleanQuery)) {
      const simplified = cleanQuery
        .replace(/[–—-]/g, ' ')
        .replace(/فرع\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (simplified !== cleanQuery) {
        results = await tryFetch(simplified);
      }
    }
    return results;
  } catch (err) {
    console.warn('Nominatim geocoding warning:', err);
    return [];
  }
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
        copy.locationStatus = copy.locationStatus === 'الموقع غير موجود' ? 'الموقع غير موجود' : 'يحتاج إلى مراجعة';
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
          'تم العثور على الموقع عبر خدمة الخرائط بناءً على نص البحث؛ يرجى مراجعته على الخريطة والضغط على «تأكيد الموقع».',
      };
    } else {
      result[idx] = {
        ...o,
        locationStatus: 'الموقع غير موجود',
        reviewNote:
          'تعذر العثور على إحداثيات تلقائية لهذا العنوان؛ يرجى تحديد الموقع يدويًا على الخريطة.',
      };
    }

    // Small delay between Nominatim requests if there are multiple orders
    if (i < indicesToResolve.length - 1) {
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  return recalculateOrdersLocationStatus(result);
}
