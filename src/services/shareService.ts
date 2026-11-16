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
 * Creates an ultra-compact payload containing only active delivery info.
 * Preserves optimized route order if a route was calculated and omits excluded orders.
 */
export function createMicroDayPayload(day: DayRecord): MicroDayPayload {
  const activeOrders = day.orders.filter((ord) => !ord.excludedFromRoute);
  let orderedSourceOrders = activeOrders;

  if (day.calculatedRoute && day.calculatedRoute.orderedOrderIds.length > 0) {
    const orderMap = new Map(activeOrders.map((ord) => [ord.id, ord]));
    const inRoute: DeliveryOrder[] = [];
    const seenIds = new Set<string>();

    for (const id of day.calculatedRoute.orderedOrderIds) {
      const found = orderMap.get(id);
      if (found) {
        inRoute.push(found);
        seenIds.add(id);
      }
    }
    const remaining = activeOrders.filter((ord) => !seenIds.has(ord.id));
    orderedSourceOrders = [...inRoute, ...remaining];
  }

  const o: MicroDayPayload['o'] = orderedSourceOrders.map((ord) => [
    (ord.customerName?.trim() || '').slice(0, 35),
    (ord.phone?.trim() || '').slice(0, 20),
    (ord.address?.trim() || ord.locationText?.trim() || '').slice(0, 60),
    (ord.totalPrice?.trim() || '').slice(0, 20),
    ord.coordinates?.lat ? Number(ord.coordinates.lat.toFixed(5)) : null,
    ord.coordinates?.lng ? Number(ord.coordinates.lng.toFixed(5)) : null,
    (ord.orderDetails?.trim() || '').slice(0, 40),
  ]);

  const s: [number, number] | undefined = day.startPoint?.coordinates
    ? [
        Number(day.startPoint.coordinates.lat.toFixed(5)),
        Number(day.startPoint.coordinates.lng.toFixed(5)),
      ]
    : undefined;

  return {
    t: (day.title?.trim() || 'مسار توصيل').slice(0, 50),
    k: day.dateKey || new Date().toISOString().split('T')[0],
    c: day.courierName?.trim() ? day.courierName.trim().slice(0, 35) : undefined,
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

  const routableOrders = orders.filter((o) => o.coordinates !== null);

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
      : routableOrders.length > 0 && routableOrders[0].coordinates
      ? {
          coordinates: {
            lat: routableOrders[0].coordinates.lat,
            lng: routableOrders[0].coordinates.lng,
          },
          label: 'نقطة بداية التوصيل',
          source: 'manual',
          confirmedAt: new Date().toISOString(),
        }
      : null;

  // Reconstruct immediate calculatedRoute if orders exist
  let calculatedRoute: CalculatedRoute | null = null;

  if (startPoint && routableOrders.length > 0) {
    const legs = routableOrders.map((ord, idx) => ({
      orderId: ord.id,
      visitNumber: idx + 1,
      distanceMeters: 0,
      durationSeconds: 0,
      cumulativeDistanceMeters: 0,
      cumulativeDurationSeconds: 0,
    }));

    const geometry: [number, number][] = [
      [startPoint.coordinates.lat, startPoint.coordinates.lng],
      ...routableOrders.map(
        (o) => [o.coordinates!.lat, o.coordinates!.lng] as [number, number]
      ),
    ];

    calculatedRoute = {
      calculatedAt: new Date().toISOString(),
      startPoint,
      orderedOrderIds: routableOrders.map((o) => o.id),
      legs,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      geometry,
      algorithmUsed: 'exact-open-tsp',
      algorithmNote: 'تم استلام ترتيب خط السير المشترك وجاري تحديث رسم الطريق الفعلي.',
      excludedOrderSummary: [],
    };
  }

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
    calculatedRoute,
    orders,
  };
}

/**
 * Converts standard base64 into 100% pure alphanumeric [A-Za-z0-9]
 * (Zero underscores '_', zero hyphens '-', zero symbols) so WhatsApp NEVER
 * breaks the link or treats underscores as italic markdown.
 */
function base64ToPureAlphanumeric(b64: string): string {
  return b64
    .replace(/=+$/, '')
    .replace(/0/g, '00')
    .replace(/\+/g, '01')
    .replace(/\//g, '02');
}

function pureAlphanumericToBase64(alpha: string): string {
  let b64 = alpha.replace(/0([012])/g, (_, d) =>
    d === '0' ? '0' : d === '1' ? '+' : '/'
  );
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  return b64;
}

/**
 * Compresses an object into a 100% alphanumeric string using browser gzip
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
      return 'z' + base64ToPureAlphanumeric(btoa(binary));
    } catch (e) {
      console.warn('Compression error, falling back to base64:', e);
    }
  }
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return 'b' + base64ToPureAlphanumeric(btoa(binary));
}

/**
 * Decompresses a URL-safe string back into an object (supports both new pure-alphanumeric and legacy z_/b_ formats)
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
    } else if (encoded.startsWith('z')) {
      const standardB64 = pureAlphanumericToBase64(encoded.slice(1));
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
    } else if (encoded.startsWith('b')) {
      const standardB64 = pureAlphanumericToBase64(encoded.slice(1));
      const binary = atob(standardB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
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
 * and across all devices/accounts without relying on volatile server memory.
 */
export async function generateClientCompactRouteUrl(day: DayRecord): Promise<string> {
  const micro = createMicroDayPayload(day);
  const compressed = await compressDataToUrlSafe(micro);
  const origin = window.location.origin.replace(/\/+$/, '');
  return `${origin}/?d=${compressed}`;
}

/**
 * Asynchronously generates a self-contained ultra-short route URL (?d=z...)
 * Uses 100% pure alphanumeric characters so WhatsApp never breaks or truncates the link.
 */
export async function generateShortRouteUrl(day: DayRecord): Promise<string> {
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
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const encoded = 'b' + base64ToPureAlphanumeric(btoa(binary));
  const origin = window.location.origin.replace(/\/+$/, '');
  return `${origin}/?d=${encoded}`;
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
    } else if (encodedData.startsWith('b')) {
      const standardB64 = pureAlphanumericToBase64(encodedData.slice(1));
      const binary = atob(standardB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } else if (!encodedData.startsWith('z')) {
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
 * Builds formatted Arabic WhatsApp message with courier details and direct link.
 * Avoids markdown symbols (* or _) so WhatsApp's parser never interferes with the link.
 */
export function buildWhatsappShareText(day: DayRecord, shareUrl: string): string {
  const activeOrders = day.orders.filter((o) => !o.excludedFromRoute);
  const totalOrders = activeOrders.length;
  const totalPrice = activeOrders.reduce((sum, o) => {
    return sum + parsePriceToNumber(o.totalPrice);
  }, 0);

  const priceText =
    totalPrice > 0 ? `${totalPrice.toLocaleString('ar-EG')} ج.م` : 'غير محدد';

  const courierLine = day.courierName?.trim()
    ? `🛵 المندوب: ${day.courierName.trim()}\n`
    : '';

  const cleanUrl = (shareUrl || '').trim();

  return (
    `🚚 خط سير توصيل الأوردرات\n` +
    `📦 اسم الأوردر: ${day.title}\n` +
    courierLine +
    `📅 التاريخ: ${day.dateKey}\n` +
    `📋 عدد الشحنات: ${totalOrders} أوردر\n` +
    `💰 إجمالي المطلوب تحصيله: ${priceText}\n\n` +
    `📍 افتح رابط مسار التوصيل للمندوب:\n` +
    `${cleanUrl}`
  );
}
