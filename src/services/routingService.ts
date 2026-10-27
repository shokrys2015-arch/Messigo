import {
  CalculatedRoute,
  Coordinates,
  DeliveryOrder,
  RouteLegInfo,
  StartPoint,
} from '../types/messigo';
import { isValidCoordinates } from './whatsappParser';

const OSRM_BASE_URL = 'https://router.project-osrm.org';
export const MAX_OSRM_PUBLIC_STOPS = 45;

/**
 * Checks if an order has a valid, user-confirmed location suitable for route optimization.
 */
export function isOrderLocationReadyForRoute(order: DeliveryOrder): boolean {
  if (order.excludedFromRoute) return false;
  if (!order.coordinates) return false;
  if (!isValidCoordinates(order.coordinates.lat, order.coordinates.lng)) return false;
  if (!order.locationConfirmedByUser) return false;
  return (
    order.locationStatus === 'الموقع صحيح' ||
    order.locationStatus === 'يوجد أوردر آخر في نفس الموقع'
  );
}

/**
 * Solves the Open-Path Traveling Salesperson Problem (Open TSP) on a directed road distance matrix.
 * - Starts at index 0 (the user's StartPoint).
 * - Visits all customer nodes (1..N) exactly once.
 * - Ends at whichever customer yields the minimum total road driving distance (does NOT return to index 0).
 *
 * Uses Exact Held-Karp Dynamic Programming for N <= 11 stops, and Multi-Start Nearest Neighbor + 2-Opt
 * Open-Path refinement for N > 11 stops.
 */
export function solveOpenTspOnRoadMatrix(distanceMatrix: number[][]): {
  visitNodeIndices: number[]; // Permutation of [1..N]
  algorithmUsed: 'exact-open-tsp' | 'heuristic-2opt-open-tsp';
} {
  const totalNodes = distanceMatrix.length; // 1 start node (index 0) + N order nodes (1..N)
  const nOrders = totalNodes - 1;

  if (nOrders <= 0) {
    return { visitNodeIndices: [], algorithmUsed: 'exact-open-tsp' };
  }
  if (nOrders === 1) {
    return { visitNodeIndices: [1], algorithmUsed: 'exact-open-tsp' };
  }

  // Exact Held-Karp Dynamic Programming for N <= 11
  if (nOrders <= 11) {
    const fullMask = (1 << nOrders) - 1;
    // dp[mask * nOrders + lastIdx] where lastIdx in 0..(nOrders-1) corresponds to node (lastIdx + 1)
    const dp = new Float64Array((fullMask + 1) * nOrders).fill(Infinity);
    const parent = new Int32Array((fullMask + 1) * nOrders).fill(-1);

    // Base cases: from StartPoint (node 0) to each first customer (i + 1)
    for (let i = 0; i < nOrders; i++) {
      const mask = 1 << i;
      dp[mask * nOrders + i] = distanceMatrix[0][i + 1];
    }

    for (let mask = 1; mask <= fullMask; mask++) {
      for (let last = 0; last < nOrders; last++) {
        if ((mask & (1 << last)) === 0) continue;
        const currentCost = dp[mask * nOrders + last];
        if (!Number.isFinite(currentCost)) continue;

        for (let next = 0; next < nOrders; next++) {
          if ((mask & (1 << next)) !== 0) continue;
          const nextMask = mask | (1 << next);
          const candidateCost = currentCost + distanceMatrix[last + 1][next + 1];
          const nextIdx = nextMask * nOrders + next;
          if (candidateCost < dp[nextIdx]) {
            dp[nextIdx] = candidateCost;
            parent[nextIdx] = last;
          }
        }
      }
    }

    // Find the best final customer (no return to 0!)
    let bestCost = Infinity;
    let bestLast = 0;
    for (let last = 0; last < nOrders; last++) {
      const cost = dp[fullMask * nOrders + last];
      if (cost < bestCost) {
        bestCost = cost;
        bestLast = last;
      }
    }

    // Reconstruct path
    const path: number[] = [];
    let currMask = fullMask;
    let currLast = bestLast;
    while (currLast !== -1) {
      path.push(currLast + 1);
      const prev = parent[currMask * nOrders + currLast];
      currMask &= ~(1 << currLast);
      currLast = prev;
    }
    path.reverse();

    return {
      visitNodeIndices: path,
      algorithmUsed: 'exact-open-tsp',
    };
  }

  // Heuristic for N > 11: Greedy Nearest Neighbor from StartPoint + 2-Opt Open-Path Local Search
  const computeRouteCost = (seq: number[]): number => {
    let cost = distanceMatrix[0][seq[0]];
    for (let i = 0; i < seq.length - 1; i++) {
      cost += distanceMatrix[seq[i]][seq[i + 1]];
    }
    return cost;
  };

  // Build initial Nearest-Neighbor sequence from node 0
  const unvisited = new Set<number>();
  for (let i = 1; i <= nOrders; i++) unvisited.add(i);

  const initialSeq: number[] = [];
  let currentNode = 0;
  while (unvisited.size > 0) {
    let bestNext = -1;
    let bestDist = Infinity;
    for (const candidate of unvisited) {
      const d = distanceMatrix[currentNode][candidate];
      if (d < bestDist) {
        bestDist = d;
        bestNext = candidate;
      }
    }
    if (bestNext === -1) {
      bestNext = unvisited.values().next().value!;
    }
    initialSeq.push(bestNext);
    unvisited.delete(bestNext);
    currentNode = bestNext;
  }

  // Refine with 2-Opt Open-Path local search (handles asymmetric road matrices properly)
  let bestSeq = [...initialSeq];
  let bestTotalCost = computeRouteCost(bestSeq);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < 400) {
    improved = false;
    iterations++;
    for (let i = 0; i < nOrders - 1; i++) {
      for (let k = i + 1; k < nOrders; k++) {
        const candidateSeq = [
          ...bestSeq.slice(0, i),
          ...bestSeq.slice(i, k + 1).reverse(),
          ...bestSeq.slice(k + 1),
        ];
        const candidateCost = computeRouteCost(candidateSeq);
        if (candidateCost + 0.1 < bestTotalCost) {
          bestSeq = candidateSeq;
          bestTotalCost = candidateCost;
          improved = true;
        }
      }
    }
  }

  return {
    visitNodeIndices: bestSeq,
    algorithmUsed: 'heuristic-2opt-open-tsp',
  };
}

/**
 * Calculates the optimized delivery route on real road networks using OSRM.
 * - Sends ONLY numeric coordinates (lng, lat) to OSRM — never sends customer names, phones, or prices.
 * - Starts at StartPoint and visits all included orders once without returning to StartPoint.
 */
export async function calculateOptimizedRoadRoute(
  startPoint: StartPoint,
  allOrders: DeliveryOrder[]
): Promise<CalculatedRoute> {
  if (!startPoint || !isValidCoordinates(startPoint.coordinates.lat, startPoint.coordinates.lng)) {
    throw new Error('يرجى تحديد نقطة بداية التوصيل بشكل صحيح قبل حساب المسار.');
  }

  const includedOrders = allOrders.filter((o) => !o.excludedFromRoute);
  const excludedOrders = allOrders.filter((o) => o.excludedFromRoute);

  if (includedOrders.length === 0) {
    throw new Error('لا توجد أوردرات مدرجة في المسار لحساب خط السير.');
  }

  // Verify every included order has confirmed valid coordinates
  const unconfirmedOrInvalid = includedOrders.filter((o) => !isOrderLocationReadyForRoute(o));
  if (unconfirmedOrInvalid.length > 0) {
    throw new Error(
      `يوجد ${unconfirmedOrInvalid.length} أوردر غير مؤكد الموقع أو بإحداثيات غير صالحة. يرجى مراجعتها وتصحيحها أو استبعادها صراحةً قبل حساب المسار.`
    );
  }

  if (includedOrders.length > MAX_OSRM_PUBLIC_STOPS) {
    throw new Error(
      `عدد الأوردرات الحالية (${includedOrders.length}) يتجاوز الحد الأقصى المسموح به في خدمة التوجيه المجانية (${MAX_OSRM_PUBLIC_STOPS} نقطة في المسار الواحد). يرجى تقليل العدد أو استبعاد بعض الأوردرات.`
    );
  }

  // Node 0 = StartPoint, Nodes 1..N = includedOrders
  const allCoords: Coordinates[] = [
    startPoint.coordinates,
    ...includedOrders.map((o) => o.coordinates!),
  ];

  const coordString = allCoords
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(';');

  // 1. Fetch Road Distance Matrix from OSRM Table API
  const tableUrl = `${OSRM_BASE_URL}/table/v1/driving/${coordString}?annotations=distance,duration`;
  let tableData: {
    code?: string;
    distances?: (number | null)[][];
    durations?: (number | null)[][];
    message?: string;
  };

  try {
    const res = await fetch(tableUrl);
    if (res.status === 429) {
      throw new Error(
        'تم تجاوز حد الطلبات المؤقت لخدمة التوجيه المجانية (OSRM). يرجى الانتظار بضع ثوانٍ ثم إعادة المحاولة.'
      );
    }
    if (!res.ok) {
      throw new Error(`تعذر الاتصال بخدمة حساب المسافات على الطرق (كود الحالة: ${res.status}).`);
    }
    tableData = await res.json();
  } catch (err) {
    if (err instanceof Error && err.message.includes('خدمة')) {
      throw err;
    }
    throw new Error(
      'تعذر الاتصال بخدمة التوجيه على الطرق (OSRM). تأكد من اتصالك بالإنترنت ثم اضغط على «إعادة المحاولة».'
    );
  }

  if (tableData.code !== 'Ok' || !tableData.distances || !tableData.durations) {
    throw new Error(
      'لم تتمكن خدمة التوجيه من حساب مسافات الطرق بين بعض النقاط المحددة. تأكد من أن جميع المواقع تقع بالقرب من طرق قابلة للقيادة.'
    );
  }

  // Sanitize matrix and verify reachability on roads
  const n = allCoords.length;
  const distanceMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(Infinity));
  const durationMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = tableData.distances[i]?.[j];
      const t = tableData.durations[i]?.[j];
      if (d === null || d === undefined || !Number.isFinite(d)) {
        throw new Error(
          'تعذر إيجاد طريق قيادة يربط بين إحدى النقاط وبقية المسار. يرجى مراجعة مواقع الأوردرات على الخريطة.'
        );
      }
      distanceMatrix[i][j] = d;
      durationMatrix[i][j] = t !== null && t !== undefined && Number.isFinite(t) ? t : 0;
    }
  }

  // 2. Optimize Open-Path TSP order using actual road distances
  const { visitNodeIndices, algorithmUsed } = solveOpenTspOnRoadMatrix(distanceMatrix);

  const orderedOrders = visitNodeIndices.map((nodeIdx) => includedOrders[nodeIdx - 1]);
  const orderedCoords: Coordinates[] = [
    startPoint.coordinates,
    ...orderedOrders.map((o) => o.coordinates!),
  ];

  // 3. Fetch Full Road Geometry & Exact Leg Distances/Durations from OSRM Route API
  const orderedCoordString = orderedCoords
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(';');

  const routeUrl = `${OSRM_BASE_URL}/route/v1/driving/${orderedCoordString}?overview=full&geometries=geojson&steps=false`;
  let routeData: {
    code?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs: Array<{ distance: number; duration: number }>;
    }>;
  };

  try {
    const routeRes = await fetch(routeUrl);
    if (!routeRes.ok) {
      throw new Error(`فشل جلب مسار الطريق المرسوم (كود الحالة: ${routeRes.status}).`);
    }
    routeData = await routeRes.json();
  } catch {
    throw new Error(
      'تم حساب ترتيب العملاء ولكن تعذر جلب رسم الطريق من خدمة التوجيه. يرجى إعادة المحاولة.'
    );
  }

  const primaryRoute = routeData.routes?.[0];
  if (routeData.code !== 'Ok' || !primaryRoute || !primaryRoute.geometry?.coordinates) {
    throw new Error('لم ترجع خدمة التوجيه بيانات هندسية صالحة لرسم المسار على الخريطة.');
  }

  // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
  const geometryLatLng: [number, number][] = primaryRoute.geometry.coordinates.map(
    ([lng, lat]) => [lat, lng]
  );

  // Build leg-by-leg metrics
  let cumulativeDistance = 0;
  let cumulativeDuration = 0;
  const legs: RouteLegInfo[] = orderedOrders.map((order, idx) => {
    const osrmLeg = primaryRoute.legs?.[idx];
    const prevNodeIdx = idx === 0 ? 0 : visitNodeIndices[idx - 1];
    const currNodeIdx = visitNodeIndices[idx];

    const legDistance =
      osrmLeg && Number.isFinite(osrmLeg.distance)
        ? osrmLeg.distance
        : distanceMatrix[prevNodeIdx][currNodeIdx];
    const legDuration =
      osrmLeg && Number.isFinite(osrmLeg.duration)
        ? osrmLeg.duration
        : durationMatrix[prevNodeIdx][currNodeIdx];

    cumulativeDistance += legDistance;
    cumulativeDuration += legDuration;

    return {
      orderId: order.id,
      visitNumber: idx + 1,
      distanceMeters: Math.round(legDistance),
      durationSeconds: Math.round(legDuration),
      cumulativeDistanceMeters: Math.round(cumulativeDistance),
      cumulativeDurationSeconds: Math.round(cumulativeDuration),
    };
  });

  const algorithmNote =
    algorithmUsed === 'exact-open-tsp'
      ? 'تم حساب المسار المحسّن بأقل مسافة قيادة فعلية على شبكة الطرق (OSRM) باستخدام خوارزمية البرمجة الديناميكية الشاملة دون العودة لنقطة البداية.'
      : 'تم حساب مسار محسّن عبر شبكة الطرق الفعلية (OSRM) باستخدام خوارزمية التقريب المتقدم (Nearest-Neighbor + 2-Opt) دون العودة لنقطة البداية. النتيجة تمثل مسارًا محسّنًا عمليًا وليست بالضرورة الحل الرياضي الوحيد.';

  return {
    calculatedAt: new Date().toISOString(),
    startPoint,
    orderedOrderIds: orderedOrders.map((o) => o.id),
    legs,
    totalDistanceMeters: Math.round(primaryRoute.distance ?? cumulativeDistance),
    totalDurationSeconds: Math.round(primaryRoute.duration ?? cumulativeDuration),
    geometry: geometryLatLng,
    algorithmUsed,
    algorithmNote,
    excludedOrderSummary: excludedOrders.map((o) => ({
      orderId: o.id,
      customerName: o.customerName || 'عميل بدون اسم',
      reason: o.exclusionReason || `تم استبعاده من المسار (${o.locationStatus})`,
    })),
  };
}

/**
 * Formats distance in meters into clear Arabic kilometers/meters text.
 */
export function formatDistanceArabic(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'غير متاح';
  if (meters < 1000) {
    return `${Math.round(meters)} متر`;
  }
  return `${(meters / 1000).toFixed(2)} كم`;
}

/**
 * Formats duration in seconds into clear Arabic hours/minutes text.
 */
export function formatDurationArabic(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'غير متاح';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} دقيقة`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) {
    return `${hours} ساعة`;
  }
  return `${hours} ساعة و ${mins} دقيقة`;
}

/**
 * Builds an accurate Google Maps navigation/place link for an order or coordinates:
 * - If the customer sent an explicit Google Maps link (`fallbackUrl`) and the user hasn't manually overridden coordinates, or for direct place opening, respects `fallbackUrl`.
 * - If confirmed coordinates exist, builds a direct Google Maps driving directions URL.
 * - Otherwise builds a Google Maps search URL using the textual address in Egypt.
 */
export function buildGoogleMapsDirectionUrl(
  coordinates: Coordinates | null,
  fallbackUrl?: string,
  addressQuery?: string,
  preferOriginalUrlOrAddress = false
): string {
  if (preferOriginalUrlOrAddress) {
    if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) {
      return fallbackUrl;
    }
    if (addressQuery && addressQuery.trim().length > 1) {
      const q = /مصر/i.test(addressQuery) ? addressQuery.trim() : `${addressQuery.trim()}، مصر`;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    }
  }

  if (coordinates && isValidCoordinates(coordinates.lat, coordinates.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coordinates.lat},${coordinates.lng}&travelmode=driving`;
  }
  if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) {
    return fallbackUrl;
  }
  if (addressQuery && addressQuery.trim().length > 1) {
    const q = /مصر/i.test(addressQuery) ? addressQuery.trim() : `${addressQuery.trim()}، مصر`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  return '';
}

/**
 * Builds a Google Maps Search URL by textual address inside Egypt so the user can open any address directly in Google Maps.
 */
export function buildGoogleMapsAddressSearchUrl(addressQuery: string): string {
  const clean = addressQuery.trim();
  if (!clean) return 'https://www.google.com/maps';
  const q = /مصر/i.test(clean) ? clean : `${clean}، مصر`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
