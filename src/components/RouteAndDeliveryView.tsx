import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  History,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  RotateCcw,
  Route,
  UserCheck,
} from 'lucide-react';
import { CalculatedRoute, DeliveryOrder } from '../types/messigo';
import {
  buildGoogleMapsDirectionUrl,
  formatDistanceArabic,
  formatDurationArabic,
} from '../services/routingService';
import { calculateDistanceMetersBetweenCoords } from '../services/geocodingService';

interface RouteAndDeliveryViewProps {
  orders: DeliveryOrder[];
  route: CalculatedRoute | null;
  isHistoricalDay?: boolean;
  historicalDayTitle?: string;
  onMarkDelivered: (orderId: string, delivered: boolean) => void;
  onRequestRecalculateRoute: () => void;
  onGoToReview: () => void;
  onReturnToActiveDay?: () => void;
}

export const RouteAndDeliveryView: React.FC<RouteAndDeliveryViewProps> = ({
  orders,
  route,
  isHistoricalDay = false,
  historicalDayTitle,
  onMarkDelivered,
  onRequestRecalculateRoute,
  onGoToReview,
  onReturnToActiveDay,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Build ordered list of orders matching route.orderedOrderIds
  const orderedVisitItems = useMemo(() => {
    if (!route) return [];
    const orderById = new Map<string, DeliveryOrder>(orders.map((o) => [o.id, o]));
    const legById = new Map(route.legs.map((l) => [l.orderId, l]));

    return route.orderedOrderIds
      .map((id, idx) => {
        const order = orderById.get(id);
        if (!order) return null;
        return {
          visitNumber: idx + 1,
          order,
          leg: legById.get(id) || null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [route, orders]);

  const deliveredCount = orderedVisitItems.filter(
    (item) => item.order.deliveryStatus === 'تم التسليم'
  ).length;
  const remainingCount = orderedVisitItems.length - deliveredCount;

  // Current Order = First undelivered order in sequence
  const currentActiveIndex = orderedVisitItems.findIndex(
    (item) => item.order.deliveryStatus !== 'تم التسليم'
  );
  const currentDeliveryItem =
    currentActiveIndex !== -1 ? orderedVisitItems[currentActiveIndex] : null;
  const nextDeliveryItem =
    currentActiveIndex !== -1 && currentActiveIndex + 1 < orderedVisitItems.length
      ? orderedVisitItems[currentActiveIndex + 1]
      : null;

  // Render Leaflet map with Start Point, Road Polyline, and Numbered Customer Markers
  useEffect(() => {
    if (!route || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [route.startPoint.coordinates.lat, route.startPoint.coordinates.lng],
      zoom: 13,
      minZoom: 6,
      maxBounds: [
        [21.5, 24.2],
        [32.1, 37.3],
      ],
      maxBoundsViscosity: 0.9,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;
    markersMapRef.current.clear();

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      markersMapRef.current.clear();
    };
  }, [route?.calculatedAt]);

  // Update markers & polyline whenever route or delivery statuses or selection changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !route) return;

    // Clear existing layers except tile layer
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        map.removeLayer(layer);
      }
    });
    markersMapRef.current.clear();

    const boundsPoints: [number, number][] = [];

    // 1. Draw Road Polyline
    if (route.geometry && route.geometry.length > 1) {
      L.polyline(route.geometry, {
        color: '#0284c7',
        weight: 5,
        opacity: 0.85,
        lineJoin: 'round',
      }).addTo(map);
      route.geometry.forEach((pt) => boundsPoints.push(pt));
    }

    // 2. Draw Start Point Marker
    const startCoords: [number, number] = [
      route.startPoint.coordinates.lat,
      route.startPoint.coordinates.lng,
    ];
    boundsPoints.push(startCoords);

    const startIcon = L.divIcon({
      className: 'messigo-pin',
      html: `<div style="width:44px;height:36px;border-radius:10px;background:#0f172a;border:2.5px solid #ffffff;box-shadow:0 6px 16px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;color:#38bdf8;font-weight:800;font-size:12px;">البداية</div>`,
      iconSize: [44, 36],
      iconAnchor: [22, 18],
    });

    L.marker(startCoords, { icon: startIcon, zIndexOffset: 900 })
      .bindPopup(
        `<div style="font-family:'IBM Plex Sans Arabic',sans-serif;text-align:right;min-width:170px;">
          <div style="font-weight:700;color:#0f172a;font-size:13px;">🚩 نقطة بداية التوصيل</div>
          <div style="color:#475569;font-size:12px;margin-top:2px;">${route.startPoint.label}</div>
        </div>`
      )
      .addTo(map);

    // 3. Draw Numbered Customer Markers (with automatic side-by-side offset when 2+ stops share the same coordinates!)
    orderedVisitItems.forEach((item, idx) => {
      const { order, visitNumber, leg } = item;
      if (!order.coordinates) return;

      // Check how many earlier stops in the sequence share the exact same (or <20m) location
      let sameSpotPriorCount = 0;
      let sameSpotTotalCount = 0;
      for (let j = 0; j < orderedVisitItems.length; j++) {
        const otherCoords = orderedVisitItems[j].order.coordinates;
        if (!otherCoords) continue;
        if (calculateDistanceMetersBetweenCoords(order.coordinates, otherCoords) <= 20) {
          sameSpotTotalCount++;
          if (j < idx) sameSpotPriorCount++;
        }
      }

      // Apply a slight visual offset if multiple orders share the exact same coordinates so no number is hidden!
      let displayLat = order.coordinates.lat;
      let displayLng = order.coordinates.lng;
      if (sameSpotTotalCount > 1) {
        const angle = (2 * Math.PI * sameSpotPriorCount) / sameSpotTotalCount;
        const offsetDeg = 0.00035; // ~35m visual separation when zoomed, and distinct icon offset
        displayLat += Math.sin(angle) * offsetDeg;
        displayLng += Math.cos(angle) * offsetDeg;
      }

      const pos: [number, number] = [displayLat, displayLng];
      boundsPoints.push(pos);

      const isDelivered = order.deliveryStatus === 'تم التسليم';
      const isCurrent = currentDeliveryItem?.order.id === order.id;
      const isSelected = selectedOrderId === order.id;

      const bgColor = isDelivered
        ? '#16a34a' // Green for delivered
        : isCurrent
        ? '#d97706' // Amber for current stop
        : '#0284c7'; // Sky blue for upcoming stops

      const ringStyle =
        isSelected || isCurrent
          ? 'box-shadow: 0 0 0 4px rgba(2,132,199,0.3), 0 6px 16px rgba(15,23,42,0.3); transform: scale(1.1);'
          : 'box-shadow: 0 4px 12px rgba(15,23,42,0.25);';

      // Pixel anchor offset when multiple markers share the same coordinates so they appear side-by-side even at wide zoom!
      const pixelOffsetX =
        sameSpotTotalCount > 1
          ? Math.round((sameSpotPriorCount - (sameSpotTotalCount - 1) / 2) * 28)
          : 0;

      const markerIcon = L.divIcon({
        className: 'messigo-pin',
        html: `<div style="width:34px;height:34px;border-radius:9999px;background:${bgColor};border:2.5px solid #ffffff;${ringStyle}display:flex;align-items:center;justify-content:center;color:#ffffff;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:13px;transition:transform 0.15s ease;">
          ${isDelivered ? `✓${visitNumber}` : visitNumber}
        </div>`,
        iconSize: [34, 34],
        iconAnchor: [17 - pixelOffsetX, 17],
      });

      const gmapsLink = buildGoogleMapsDirectionUrl(order.coordinates, order.mapUrl);

      const popupHtml = `
        <div style="font-family:'IBM Plex Sans Arabic',sans-serif;text-align:right;min-width:210px;">
          <div style="font-size:11px;color:#64748b;margin-bottom:2px;">
            زيارة رقم <strong>${visitNumber}</strong> · ${
        isDelivered
          ? '<span style="color:#16a34a;font-weight:700;">تم التسليم</span>'
          : 'قيد الانتظار'
      }
          </div>
          <div style="font-weight:700;color:#0f172a;font-size:14px;">${
            order.customerName || 'عميل'
          }</div>
          <div style="color:#334155;font-size:12px;margin-top:3px;">${order.address || ''}</div>
          ${
            order.phone
              ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#0284c7;margin-top:3px;" dir="ltr">${order.phone}</div>`
              : ''
          }
          ${
            leg
              ? `<div style="font-size:11px;color:#475569;margin-top:4px;padding-top:4px;border-top:1px solid #e2e8f0;">
                  مسافة الطريق من النقطة السابقة: <strong>${formatDistanceArabic(
                    leg.distanceMeters
                  )}</strong> (${formatDurationArabic(leg.durationSeconds)})
                </div>`
              : ''
          }
          ${
            gmapsLink
              ? `<div style="margin-top:8px;">
                  <a href="${gmapsLink}" target="_blank" rel="noreferrer" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:5px 10px;border-radius:8px;font-size:11px;font-weight:600;">افتح في خرائط جوجل</a>
                </div>`
              : ''
          }
        </div>
      `;

      const marker = L.marker(pos, {
        icon: markerIcon,
        zIndexOffset: isCurrent ? 800 : isSelected ? 700 : 500 - visitNumber,
      })
        .bindPopup(popupHtml)
        .addTo(map);

      marker.on('click', () => {
        setSelectedOrderId(order.id);
        const cardEl = cardRefs.current.get(order.id);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      markersMapRef.current.set(order.id, marker);
    });

    if (boundsPoints.length > 0 && !selectedOrderId) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [45, 45], maxZoom: 16 });
    }
  }, [route, orderedVisitItems, currentDeliveryItem?.order.id, selectedOrderId]);

  const handleFocusOrderOnMap = (order: DeliveryOrder) => {
    setSelectedOrderId(order.id);
    const map = mapInstanceRef.current;
    const marker = markersMapRef.current.get(order.id);
    if (map && order.coordinates) {
      map.setView([order.coordinates.lat, order.coordinates.lng], 16, { animate: true });
      if (marker) {
        marker.openPopup();
      }
    }
  };

  if (!route) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
          <Route className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">لم يتم حساب خط السير لهذا اليوم بعد</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          انتقل إلى شاشة «مراجعة الأوردرات» للتأكد من صحة مواقع العملاء وتحديد نقطة البداية ثم اضغط على «حساب أفضل خط سير».
        </p>
        <button
          type="button"
          onClick={onGoToReview}
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold inline-flex items-center gap-2 transition-colors"
        >
          <MapPin className="w-4 h-4" />
          <span>الانتقال إلى مراجعة الأوردرات وحساب المسار</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Historical Day Read-Only Banner */}
      {isHistoricalDay && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <History className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-950">
                أنت تستعرض سجلًا محفوظًا من يوم سابق: {historicalDayTitle}
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                هذه البيانات والخريطة تمثل المسار والترتيب المحفوظ لذلك اليوم، وليس مسارًا جديدًا تم حسابه في الوقت الحالي.
              </p>
            </div>
          </div>
          {onReturnToActiveDay && (
            <button
              type="button"
              onClick={onReturnToActiveDay}
              className="min-h-[40px] px-4 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0"
            >
              العودة إلى اليوم الحالي النشط
            </button>
          )}
        </div>
      )}

      {/* Route Summary Metrics Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              ملخص خط السير المحسّن على شبكة الطرق
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{route.algorithmNote}</p>
          </div>

          {!isHistoricalDay && (
            <button
              type="button"
              onClick={onRequestRecalculateRoute}
              className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-600" />
              <span>إعادة حساب المسار</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 bg-sky-50/60 border border-sky-200/80 rounded-xl">
            <div className="text-xs text-sky-900">إجمالي مسافة الطريق الفعلية</div>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-sky-700 mt-1">
              {formatDistanceArabic(route.totalDistanceMeters)}
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
            <div className="text-xs text-slate-600">الوقت المتوقع للقيادة</div>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
              {formatDurationArabic(route.totalDurationSeconds)}
            </div>
          </div>

          <div className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl">
            <div className="text-xs text-emerald-900">تم تسليمها</div>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
              {deliveredCount}{' '}
              <span className="text-xs font-normal">من {orderedVisitItems.length}</span>
            </div>
          </div>

          <div className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl">
            <div className="text-xs text-amber-900">الأوردرات المتبقية</div>
            <div className="text-lg sm:text-xl font-extrabold font-mono tabular-nums text-amber-700 mt-1">
              {remainingCount}
            </div>
          </div>
        </div>
      </div>

      {/* Section 10: «التوصيل الحالي» */}
      <div className="bg-white border border-sky-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Navigation className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-bold text-slate-900">التوصيل الحالي</h2>
          </div>
          <span className="text-xs text-slate-500">
            لا يتغير ترتيب المسار تلقائيًا أثناء التسليم للحفاظ على استقرار خط السير
          </span>
        </div>

        {currentDeliveryItem ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Current Customer Card */}
            <div className="lg:col-span-8 p-4 bg-sky-50/50 border border-sky-200 rounded-xl flex flex-col justify-between space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-sky-800 mb-1.5">
                  <span className="font-bold">
                    العميل الحالي (الزيارة رقم {currentDeliveryItem.visitNumber})
                  </span>
                  {currentDeliveryItem.leg && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        المسافة من النقطة السابقة:{' '}
                        <strong className="font-mono tabular-nums">
                          {formatDistanceArabic(currentDeliveryItem.leg.distanceMeters)}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        الوقت المتوقع:{' '}
                        <strong className="font-mono tabular-nums">
                          {formatDurationArabic(currentDeliveryItem.leg.durationSeconds)}
                        </strong>
                      </span>
                    </>
                  )}
                </div>

                <h3 className="text-xl font-extrabold text-slate-900">
                  {currentDeliveryItem.order.customerName || 'عميل بدون اسم'}
                </h3>
                <p className="text-sm text-slate-700 mt-1">
                  {currentDeliveryItem.order.address || 'بدون عنوان نصي'}
                </p>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-600">
                  {currentDeliveryItem.order.phone && (
                    <a
                      href={`tel:${currentDeliveryItem.order.phone}`}
                      dir="ltr"
                      className="inline-flex items-center gap-1.5 font-mono tabular-nums font-bold text-sky-700 hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>{currentDeliveryItem.order.phone}</span>
                    </a>
                  )}
                  {currentDeliveryItem.order.orderDetails && (
                    <span>الطلب: {currentDeliveryItem.order.orderDetails}</span>
                  )}
                  {currentDeliveryItem.order.totalPrice && (
                    <span className="font-bold text-slate-900">
                      الإجمالي: {currentDeliveryItem.order.totalPrice}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {buildGoogleMapsDirectionUrl(
                  currentDeliveryItem.order.coordinates,
                  currentDeliveryItem.order.mapUrl
                ) && (
                  <a
                    href={buildGoogleMapsDirectionUrl(
                      currentDeliveryItem.order.coordinates,
                      currentDeliveryItem.order.mapUrl
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-4 h-4 text-sky-400" />
                    <span>فتح الاتجاهات في خرائط جوجل</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => onMarkDelivered(currentDeliveryItem.order.id, true)}
                  className="min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تم التسليم والانتقال للتالي</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleFocusOrderOnMap(currentDeliveryItem.order)}
                  className="min-h-[46px] px-3.5 py-2 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 text-sky-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  عرض على الخريطة
                </button>
              </div>
            </div>

            {/* Next Customer in Sequence */}
            <div className="lg:col-span-4 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-between">
              {nextDeliveryItem ? (
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-1">
                    العميل التالي في الترتيب (الزيارة رقم {nextDeliveryItem.visitNumber})
                  </div>
                  <h4 className="text-base font-bold text-slate-900">
                    {nextDeliveryItem.order.customerName || 'عميل بدون اسم'}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    {nextDeliveryItem.order.address || 'بدون عنوان نصي'}
                  </p>
                  {nextDeliveryItem.order.phone && (
                    <div className="text-xs font-mono tabular-nums text-slate-700 mt-2" dir="ltr">
                      {nextDeliveryItem.order.phone}
                    </div>
                  )}
                  {nextDeliveryItem.leg && (
                    <div className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-200/80">
                      المسافة من العميل الحالي:{' '}
                      <strong className="font-mono tabular-nums text-slate-800">
                        {formatDistanceArabic(nextDeliveryItem.leg.distanceMeters)}
                      </strong>{' '}
                      ({formatDurationArabic(nextDeliveryItem.leg.durationSeconds)})
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-600 my-auto text-center py-4">
                  هذا هو آخر عميل متبقٍ في خط السير الحالي.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-1">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-2">
              <UserCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-emerald-950">
              اكتمل تسليم جميع أوردرات المسار بنجاح!
            </h3>
            <p className="text-xs text-emerald-800">
              تم تسجيل تسليم كافة العملاء ({orderedVisitItems.length} أوردر) وحفظ الحالات تلقائيًا.
            </p>
          </div>
        )}
      </div>

      {/* Interactive Map & Legend */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
          <h3 className="text-sm font-bold text-slate-900">
            خريطة خط السير التفاعلية (تنتهي عند آخر عميل دون العودة لنقطة البداية)
          </h3>

          {/* Map Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-slate-900 inline-block" />
              <span>نقطة البداية</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-600 inline-block" />
              <span>العميل الحالي</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-sky-600 inline-block" />
              <span>عميل قادم بالترتيب</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" />
              <span>تم التسليم</span>
            </span>
          </div>
        </div>

        <div ref={mapContainerRef} className="w-full h-[380px] sm:h-[460px] bg-slate-100" />
      </div>

      {/* Ordered Delivery Customer List Below Map */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-slate-900">
            قائمة العملاء بالترتيب الفعلي للتوصيل ({orderedVisitItems.length})
          </h3>
          <span className="text-xs text-slate-500">
            اضغط على أي عميل لعرض موقعه على الخريطة
          </span>
        </div>

        <div className="space-y-3">
          {orderedVisitItems.map(({ visitNumber, order, leg }) => {
            const isDelivered = order.deliveryStatus === 'تم التسليم';
            const isCurrent = currentDeliveryItem?.order.id === order.id;
            const isSelected = selectedOrderId === order.id;
            const gmapsUrl = buildGoogleMapsDirectionUrl(order.coordinates, order.mapUrl);

            return (
              <div
                key={order.id}
                ref={(el) => {
                  cardRefs.current.set(order.id, el);
                }}
                onClick={() => handleFocusOrderOnMap(order)}
                className={`bg-white border rounded-2xl p-4 sm:p-5 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-sky-500 ring-2 ring-sky-500/20'
                    : isCurrent
                    ? 'border-amber-400 bg-amber-50/15'
                    : isDelivered
                    ? 'border-emerald-200 bg-emerald-50/10'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl font-mono tabular-nums font-extrabold text-sm flex items-center justify-center shrink-0 text-white ${
                        isDelivered
                          ? 'bg-emerald-600'
                          : isCurrent
                          ? 'bg-amber-600'
                          : 'bg-sky-600'
                      }`}
                    >
                      {visitNumber}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                        <span>الزيارة رقم {visitNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            isDelivered
                              ? 'text-emerald-700 font-bold'
                              : isCurrent
                              ? 'text-amber-700 font-bold'
                              : 'text-slate-600 font-medium'
                          }
                        >
                          {isDelivered
                            ? 'تم التسليم'
                            : isCurrent
                            ? 'الأوردر الحالي'
                            : 'قيد الانتظار'}
                        </span>
                        {order.totalPrice && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-slate-800">
                              الإجمالي: {order.totalPrice}
                            </span>
                          </>
                        )}
                      </div>

                      <h4 className="text-base sm:text-lg font-bold text-slate-900">
                        {order.customerName || 'عميل بدون اسم'}
                      </h4>

                      <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                        {order.address || 'بدون عنوان نصي'}
                      </p>

                      {order.orderDetails && (
                        <p className="text-xs text-slate-500 mt-1">
                          التفاصيل: {order.orderDetails}
                        </p>
                      )}

                      {leg && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-2.5 pt-2 border-t border-slate-100">
                          <span>
                            مسافة الطريق من النقطة السابقة:{' '}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatDistanceArabic(leg.distanceMeters)}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            وقت القيادة:{' '}
                            <strong className="font-mono tabular-nums text-slate-900">
                              {formatDurationArabic(leg.durationSeconds)}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500">
                            المسافة التراكمية من البداية:{' '}
                            <span className="font-mono tabular-nums">
                              {formatDistanceArabic(leg.cumulativeDistanceMeters)}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-2 mr-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {order.phone && (
                      <a
                        href={`tel:${order.phone}`}
                        dir="ltr"
                        className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-mono tabular-nums font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5 text-sky-600" />
                        <span>{order.phone}</span>
                      </a>
                    )}

                    {gmapsUrl && (
                      <a
                        href={gmapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>افتح في خرائط جوجل</span>
                      </a>
                    )}

                    {isDelivered ? (
                      <button
                        type="button"
                        onClick={() => onMarkDelivered(order.id, false)}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>تم التسليم (إلغاء)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onMarkDelivered(order.id, true)}
                        className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Check className="w-4 h-4" />
                        <span>تم التسليم</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
