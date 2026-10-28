import { CalculatedRoute, DayRecord, DeliveryOrder } from '../types/messigo';
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
 * Builds the full direct URL that can be shared via WhatsApp or copied.
 * Uses window.location.origin + pathname + #share_route=...
 */
export function generateShareableRouteUrl(day: DayRecord): string {
  const payload = createCompactSharePayload(day);
  const jsonStr = JSON.stringify(payload);
  const encoded = toBase64Utf8(jsonStr);

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}#share_route=${encoded}`;
}

/**
 * Decodes a share URL hash or query param into a DayRecord
 */
export function decodeShareableRoute(hashOrSearch: string): DayRecord | null {
  try {
    let encodedData = '';

    // Check hash: #share_route=...
    if (hashOrSearch.includes('share_route=')) {
      const match = hashOrSearch.match(/share_route=([^&]+)/);
      if (match && match[1]) {
        encodedData = match[1];
      }
    }

    if (!encodedData) return null;

    const jsonStr = fromBase64Utf8(encodedData);
    const parsed = JSON.parse(jsonStr);

    if (parsed && Array.isArray(parsed.orders)) {
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
  } catch (err) {
    console.error('Failed to decode share route:', err);
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

  return (
    `🚚 *خط سير توصيل الأوردرات*\n` +
    `📦 *اسم الأوردر:* ${day.title}\n` +
    courierLine +
    `📅 *التاريخ:* ${day.dateKey}\n` +
    `📋 *عدد الشحنات:* ${totalOrders} أوردر\n` +
    `💰 *إجمالي المطلوب تحصيله:* ${priceText}\n\n` +
    `📍 *افتح مسار التوصيل واللوكيشنز مباشرة في البرنامج:*\n` +
    `${shareUrl}`
  );
}
