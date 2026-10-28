import {
  CalculatedRoute,
  DayRecord,
  DeliveryOrder,
  LocationStatus,
  StartPoint,
} from '../types/messigo';
import { parsePriceToNumber } from '../components/RoutePdfModal';

/**
 * Downsamples geometry polyline coordinates to a reasonable number of points
 * so the share URL remains light and fast for mobile browsers.
 */
function sampleGeometry(
  points: [number, number][],
  targetCount: number = 100
): [number, number][] {
  if (!points || points.length <= targetCount) return points;
  const sampled: [number, number][] = [];
  const step = (points.length - 1) / (targetCount - 1);

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(Math.round(i * step), points.length - 1);
    sampled.push(points[idx]);
  }
  return sampled;
}

/**
 * Robust UTF-8 to Base64 encoder (handles Arabic strings without Latin-1 errors)
 */
function toBase64Utf8(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  // Convert standard base64 to URL-safe base64
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Robust Base64 to UTF-8 decoder (handles Arabic and URL-safe characters)
 */
function fromBase64Utf8(base64: string): string {
  let standardB64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (standardB64.length % 4 !== 0) {
    standardB64 += '=';
  }
  const binary = atob(standardB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Generates a clean, compact DayRecord payload for sharing with a courier
 */
export function createCompactSharePayload(day: DayRecord): Partial<DayRecord> {
  const compactOrders: DeliveryOrder[] = day.orders.map((o) => ({
    id: o.id,
    customerName: o.customerName || '',
    phone: o.phone || '',
    address: o.address || '',
    locationText: o.locationText || '',
    mapUrl: o.mapUrl || '',
    searchQueryFromUrl: o.searchQueryFromUrl,
    coordinates: o.coordinates,
    geocodedDisplayName: o.geocodedDisplayName,
    locationStatus: o.locationStatus || 'الموقع صحيح',
    locationConfirmedByUser: o.locationConfirmedByUser ?? true,
    reviewNote: o.reviewNote,
    hasDuplicateLocation: o.hasDuplicateLocation,
    duplicateWithNames: o.duplicateWithNames,
    orderDetails: o.orderDetails || '',
    totalPrice: o.totalPrice || '',
    rawMessage: '',
    deliveryStatus: o.deliveryStatus || 'قيد الانتظار',
    deliveredAt: o.deliveredAt,
    excludedFromRoute: o.excludedFromRoute ?? false,
    exclusionReason: o.exclusionReason,
    createdAt: o.createdAt || new Date().toISOString(),
  }));

  let compactRoute: CalculatedRoute | null = null;
  if (day.calculatedRoute) {
    compactRoute = {
      ...day.calculatedRoute,
      geometry: day.calculatedRoute.geometry
        ? sampleGeometry(day.calculatedRoute.geometry, 80)
        : [],
    };
  }

  return {
    id: day.id,
    title: day.title,
    dateKey: day.dateKey,
    courierName: day.courierName,
    createdAt: day.createdAt,
    updatedAt: day.updatedAt,
    startPoint: day.startPoint,
    isArchived: day.isArchived,
    orders: compactOrders,
    calculatedRoute: compactRoute,
  };
}

/**
 * Minimal data representation for sharing routes (under 250 bytes)
 */
export interface MicroDayPayload {
  t: string; // title
  k: string; // dateKey
  c?: string; // courierName
  s?: [number, number]; // startPoint coordinates [lat, lng]
  o: Array<[string, string, string, string, number | null, number | null, string?]>;
  // [customerName, phone, address, totalPrice, lat, lng, orderDetails]
}

/**
 * Creates an ultra-compact payload containing only necessary delivery info.
 * Drops heavy route polylines, duplicate texts, and redundant flags.
 */
export function createMicroDayPayload(day: DayRecord): MicroDayPayload {
  const o: MicroDayPayload['o'] = day.orders.map((ord) => [
    ord.customerName?.trim() || '',
    ord.phone?.trim() || '',
    ord.address?.trim() || ord.locationText?.trim() || '',
    ord.totalPrice?.trim() || '',
    ord.coordinates?.lat ? Number(ord.coordinates.lat.toFixed(5)) : null,
    ord.coordinates?.lng ? Number(ord.coordinates.lng.toFixed(5)) : null,
    ord.orderDetails?.trim() || '',
  ]);

  const s: [number, number] | undefined = day.startPoint?.coordinates
    ? [
        Number(day.startPoint.coordinates.lat.toFixed(5)),
        Number(day.startPoint.coordinates.lng.toFixed(5)),
      ]
    : undefined;

  return {
    t: day.title?.trim() || 'مسار توصيل',
    k: day.dateKey || new Date().toISOString().split('T')[0],
    c: day.courierName?.trim() || undefined,
    s,
    o,
  };
}

/**
 * Reconstructs a full DayRecord from the ultra-compact micro payload
 */
export function reconstructDayFromMicro(micro: MicroDayPayload): DayRecord {
  const dayId = `day_${Date.now()}`;
  const orders: DeliveryOrder[] = (micro.o || []).map((tuple, idx) => {
    const lat = tuple[4];
    const lng = tuple[5];
    const hasCoords =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lng);

    return {
      id: `ord_${idx + 1}_${Date.now()}`,
      customerName: tuple[0] || '',
      phone: tuple[1] || '',
      address: tuple[2] || '',
      locationText: tuple[2] || '',
      mapUrl: '',
      coordinates: hasCoords ? { lat, lng } : null,
      locationStatus: hasCoords ? 'الموقع صحيح' : 'يحتاج إلى مراجعة',
      locationConfirmedByUser: true,
      orderDetails: tuple[6] || '',
      totalPrice: tuple[3] || '',
      rawMessage: '',
      deliveryStatus: 'قيد الانتظار',
      excludedFromRoute: false,
      createdAt: new Date().toISOString(),
    };
  });

  const startPoint: StartPoint | null =
    micro.s &&
    typeof micro.s[0] === 'number' &&
    typeof micro.s[1] === 'number'
      ? {
          coordinates: { lat: micro.s[0], lng: micro.s[1] },
          label: 'نقطة بداية التوصيل',
          source: 'manual',
          confirmedAt: new Date().toISOString(),
        }
      : null;

  return {
    id: dayId,
    title: micro.t || 'مسار توصيل مشترك',
    dateKey: micro.k || new Date().toISOString().split('T')[0],
    courierName: micro.c,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rawInputText: '',
    isArchived: false,
    startPoint,
    calculatedRoute: null,
    orders,
  };
}

/**
 * Compresses an object into a compact URL-safe string using browser gzip
 */
export async function compressDataToUrlSafe(data: unknown): Promise<string> {
  const jsonStr = JSON.stringify(data);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([new TextEncoder().encode(jsonStr)]).stream();
      const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
      const buffer = await new Response(compressedStream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return 'z_' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      console.warn('Compression error, falling back to base64:', e);
    }
  }
  return 'b_' + toBase64Utf8(jsonStr);
}

/**
 * Decompresses a URL-safe string back into an object
 */
export async function decompressDataFromUrlSafe<T = any>(encoded: string): Promise<T | null> {
  try {
    if (encoded.startsWith('z_')) {
      const rawB64 = encoded.slice(2);
      let standardB64 = rawB64.replace(/-/g, '+').replace(/_/g, '/');
      while (standardB64.length % 4 !== 0) standardB64 += '=';
      const binary = atob(standardB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const stream = new Blob([bytes]).stream();
      const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(decompressedStream).text();
      return JSON.parse(text) as T;
    } else if (encoded.startsWith('b_')) {
      const jsonStr = fromBase64Utf8(encoded.slice(2));
      return JSON.parse(jsonStr) as T;
    } else {
      const jsonStr = fromBase64Utf8(encoded);
      return JSON.parse(jsonStr) as T;
    }
  } catch (err) {
    console.error('Decompression error:', err);
    return null;
  }
}

/**
 * Generates an ultra-compact client-side URL that works on Cloudflare Pages (messigo.pages.dev)
 * without any backend server. Length is ~150-250 characters.
 */
export async function generateClientCompactRouteUrl(day: DayRecord): Promise<string> {
  const micro = createMicroDayPayload(day);
  const compressed = await compressDataToUrlSafe(micro);
  const origin = window.location.origin.replace(/\/+$/, '');
  return `${origin}/?d=${compressed}`;
}

/**
 * Asynchronously generates an ultra-short route URL:
 * 1. Tries server storage (/api/routes/share) -> generates ~30 chars (?r=xyz)
 * 2. On static hosting like Cloudflare Pages (messigo.pages.dev), uses gzip micro-payload -> generates ~200 chars (?d=...)
 * NEVER generates the old 4,000-character string!
 */
export async function generateShortRouteUrl(day: DayRecord): Promise<string> {
  try {
    const payload = createCompactSharePayload(day);
    const res = await fetch('/api/routes/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: payload }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.shortId) {
        const origin = window.location.origin.replace(/\/+$/, '');
        return `${origin}/?r=${data.shortId}`;
      }
    }
  } catch {
    // Expected on static hosting like Cloudflare Pages (messigo.pages.dev)
  }

  // Client-side ultra-compact compressed link (works 100% on Cloudflare Pages without server!)
  return generateClientCompactRouteUrl(day);
}

/**
 * Fetches a shared route by its short ID from the server
 */
export async function fetchSharedRoute(shortId: string): Promise<DayRecord | null> {
  try {
    const res = await fetch(`/api/routes/${encodeURIComponent(shortId)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.success && json?.data && Array.isArray(json.data.orders)) {
      const data = json.data;
      return {
        id: data.id || `shared_${Date.now()}`,
        title: data.title || 'مسار توصيل مشترك',
        dateKey: data.dateKey || new Date().toISOString().split('T')[0],
        courierName: data.courierName,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
        rawInputText: '',
        isArchived: false,
        startPoint: data.startPoint || null,
        calculatedRoute: data.calculatedRoute || null,
        orders: data.orders,
      };
    }
  } catch (err) {
    console.error('Failed to fetch shared route from server:', err);
  }
  return null;
}

/**
 * Fallback generator for compact direct URL (sync fallback)
 */
export function generateShareableRouteUrl(day: DayRecord): string {
  const micro = createMicroDayPayload(day);
  const jsonStr = JSON.stringify(micro);
  const encoded = toBase64Utf8(jsonStr);
  const origin = window.location.origin.replace(/\/+$/, '');
  return `${origin}/?d=b_${encoded}`;
}

/**
 * Decodes a share URL hash or query param into a DayRecord
 */
export function decodeShareableRoute(hashOrSearch: string): DayRecord | null {
  try {
    let encodedData = '';

    if (hashOrSearch.includes('d=')) {
      const match = hashOrSearch.match(/[#&?]d=([a-zA-Z0-9_\-~]+)/);
      if (match && match[1]) encodedData = match[1];
    } else if (hashOrSearch.includes('share_route=')) {
      const match = hashOrSearch.match(/[#&?]share_route=([^&]+)/);
      if (match && match[1]) encodedData = match[1];
    }

    if (!encodedData) return null;

    let parsed: any = null;
    if (encodedData.startsWith('b_')) {
      parsed = JSON.parse(fromBase64Utf8(encodedData.slice(2)));
    } else if (!encodedData.startsWith('z_')) {
      parsed = JSON.parse(fromBase64Utf8(encodedData));
    }

    if (parsed) {
      if (parsed.o && Array.isArray(parsed.o)) {
        return reconstructDayFromMicro(parsed);
      }
      if (parsed.orders && Array.isArray(parsed.orders)) {
        return {
          id: parsed.id || `day_${Date.now()}`,
          title: parsed.title || 'مسار توصيل مشترك',
          dateKey: parsed.dateKey || new Date().toISOString().split('T')[0],
          courierName: parsed.courierName,
          createdAt: parsed.createdAt || new Date().toISOString(),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          rawInputText: '',
          isArchived: false,
          startPoint: parsed.startPoint || null,
          calculatedRoute: parsed.calculatedRoute || null,
          orders: parsed.orders,
        };
      }
    }
  } catch (err) {
    console.error('Failed to decode share route:', err);
  }
  return null;
}

/**
 * Universal async resolver for shared routes from URL (handles server short code, client gzip, and legacy)
 */
export async function decodeSharedRouteFromLocation(): Promise<DayRecord | null> {
  const urlParams = new URLSearchParams(window.location.search);

  // 1. Check for server short code: ?r=... or /r/... or #r=...
  let shortCode = urlParams.get('r');
  if (!shortCode && window.location.hash) {
    const m = window.location.hash.match(/[#&?]r=([a-zA-Z0-9_-]+)/);
    if (m && m[1]) shortCode = m[1];
  }
  if (!shortCode && window.location.pathname.startsWith('/r/')) {
    const m = window.location.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) shortCode = m[1];
  }
  if (shortCode) {
    const day = await fetchSharedRoute(shortCode);
    if (day) return day;
  }

  // 2. Check for compressed client payload: ?d=... or #d=...
  let compressedData = urlParams.get('d');
  if (!compressedData && window.location.hash) {
    const m = window.location.hash.match(/[#&?]d=([a-zA-Z0-9_\-~]+)/);
    if (m && m[1]) compressedData = m[1];
  }
  if (compressedData) {
    const micro = await decompressDataFromUrlSafe<MicroDayPayload>(compressedData);
    if (micro && Array.isArray(micro.o)) {
      return reconstructDayFromMicro(micro);
    }
  }

  // 3. Check for legacy share_route=...
  const rawHashOrSearch = window.location.hash || window.location.search;
  if (rawHashOrSearch.includes('share_route=')) {
    return decodeShareableRoute(rawHashOrSearch);
  }

  return null;
}

/**
 * Builds formatted Arabic WhatsApp message with courier details and direct link
 */
export function buildWhatsappShareText(day: DayRecord, shareUrl: string): string {
  const totalOrders = day.orders.length;
  const totalPrice = day.orders.reduce((sum, o) => {
    return sum + parsePriceToNumber(o.totalPrice);
  }, 0);

  const priceText =
    totalPrice > 0 ? `${totalPrice.toLocaleString('ar-EG')} ج.م` : 'غير محدد';

  const courierLine = day.courierName?.trim()
    ? `🛵 *المندوب:* ${day.courierName.trim()}\n`
    : '';

  const cleanUrl = (shareUrl || '').trim();

  return (
    `🚚 *خط سير توصيل الأوردرات*\n` +
    `📦 *اسم الأوردر:* ${day.title}\n` +
    courierLine +
    `📅 *التاريخ:* ${day.dateKey}\n` +
    `📋 *عدد الشحنات:* ${totalOrders} أوردر\n` +
    `💰 *إجمالي المطلوب تحصيله:* ${priceText}\n\n` +
    `📍 *رابط مسار التوصيل واللوكيشنز للمندوب:*\n\n` +
    `${cleanUrl}\n`
  );
}
