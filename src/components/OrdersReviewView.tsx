import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Compass,
  Edit3,
  ExternalLink,
  EyeOff,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Route,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Coordinates, DeliveryOrder, LocationStatus, StartPoint } from '../types/messigo';
import { buildGoogleMapsDirectionUrl, isOrderLocationReadyForRoute } from '../services/routingService';

interface OrdersReviewViewProps {
  orders: DeliveryOrder[];
  startPoint: StartPoint | null;
  onUpdateStartPoint: (point: StartPoint) => void;
  onOpenStartPointMap: () => void;
  onConfirmOrderLocation: (orderId: string) => void;
  onEditOrder: (order: DeliveryOrder) => void;
  onPickOrderLocationOnMap: (order: DeliveryOrder) => void;
  onToggleExcludeOrder: (order: DeliveryOrder) => void;
  onExcludeAllInvalidOrders: () => void;
  onDeleteOrderRequest: (order: DeliveryOrder) => void;
  onOpenAddManualOrder: () => void;
  onCalculateRoute: () => void;
  isCalculatingRoute: boolean;
  routeError: string | null;
}

export const OrdersReviewView: React.FC<OrdersReviewViewProps> = ({
  orders,
  startPoint,
  onUpdateStartPoint,
  onOpenStartPointMap,
  onConfirmOrderLocation,
  onEditOrder,
  onPickOrderLocationOnMap,
  onToggleExcludeOrder,
  onExcludeAllInvalidOrders,
  onDeleteOrderRequest,
  onOpenAddManualOrder,
  onCalculateRoute,
  isCalculatingRoute,
  routeError,
}) => {
  const [filter, setFilter] = useState<'all' | 'valid' | 'needs_fix' | 'excluded'>('all');
  const [gpsPendingCoords, setGpsPendingCoords] = useState<Coordinates | null>(null);
  const [isLoadingGps, setIsLoadingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [expandedRawId, setExpandedRawId] = useState<string | null>(null);

  // Counters required by Section 6
  const totalOrdersCount = orders.length;
  const activeOrders = orders.filter((o) => !o.excludedFromRoute);
  const excludedOrders = orders.filter((o) => o.excludedFromRoute);
  const validOrdersCount = activeOrders.filter((o) => isOrderLocationReadyForRoute(o)).length;
  const needsCorrectionCount = activeOrders.filter((o) => !isOrderLocationReadyForRoute(o)).length;

  const filteredOrders = orders.filter((o) => {
    if (filter === 'valid') return !o.excludedFromRoute && isOrderLocationReadyForRoute(o);
    if (filter === 'needs_fix') return !o.excludedFromRoute && !isOrderLocationReadyForRoute(o);
    if (filter === 'excluded') return o.excludedFromRoute;
    return true;
  });

  const handleRequestBrowserGps = () => {
    if (!navigator.geolocation) {
      setGpsError('خدمة تحديد الموقع الجغرافي غير مدعومة في هذا المتصفح. يرجى اختيار نقطة البداية على الخريطة.');
      return;
    }
    setIsLoadingGps(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLoadingGps(false);
        const coords: Coordinates = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        // Per Section 7: "لا تفترض أن الموقع الحالي هو نقطة البداية الصحيحة دون تأكيد المستخدم"
        setGpsPendingCoords(coords);
      },
      (err) => {
        setIsLoadingGps(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('تم رفض إذن الوصول إلى الموقع الحالي. يمكنك تحديد نقطة البداية يدويًا على الخريطة.');
        } else {
          setGpsError('تعذر تحديد موقعك الحالي تلقائيًا. يرجى تحديد نقطة البداية يدويًا على الخريطة.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleConfirmGpsStartPoint = () => {
    if (!gpsPendingCoords) return;
    onUpdateStartPoint({
      coordinates: gpsPendingCoords,
      label: 'موقعي الحالي المؤكد (GPS)',
      source: 'gps',
      confirmedAt: new Date().toISOString(),
    });
    setGpsPendingCoords(null);
  };

  const getStatusTextStyle = (status: LocationStatus, excluded: boolean): string => {
    if (excluded) return 'text-slate-500';
    switch (status) {
      case 'الموقع صحيح':
        return 'text-emerald-700 font-semibold';
      case 'يوجد أوردر آخر في نفس الموقع':
        return 'text-sky-700 font-semibold';
      case 'يحتاج إلى مراجعة':
        return 'text-amber-700 font-semibold';
      case 'الموقع غير موجود':
      case 'الإحداثيات غير صحيحة':
        return 'text-red-700 font-semibold';
    }
  };

  const canCalculateRoute =
    Boolean(startPoint) &&
    validOrdersCount > 0 &&
    needsCorrectionCount === 0 &&
    !isCalculatingRoute;

  return (
    <div className="space-y-6">
      {/* Summary Metrics Strip & Route Calculation Gate */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Step 1: Starting Point Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-base font-bold text-slate-900">1. نقطة بداية التوصيل</h2>
              <span className="text-xs text-slate-500">لا تُحتسب ضمن عدد العملاء</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              يبدأ المسار من نقطة البداية التي تحددها وينتهي عند آخر عميل دون الرجوع تلقائيًا لنقطة البداية.
            </p>

            {startPoint ? (
              <div className="p-3.5 bg-sky-50/70 border border-sky-200 rounded-xl mb-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-sky-900">{startPoint.label}</span>
                  <span className="text-[11px] text-sky-700">تم التأكيد</span>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-700 mt-1" dir="ltr">
                  {startPoint.coordinates.lat.toFixed(6)}, {startPoint.coordinates.lng.toFixed(6)}
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl mb-4 text-xs text-amber-900 font-medium">
                لم يتم تحديد نقطة بداية التوصيل بعد. اختر إحدى الطريقتين بالأسفل:
              </div>
            )}

            {/* Pending GPS Confirmation Box */}
            {gpsPendingCoords && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl mb-4 space-y-2.5">
                <p className="text-xs font-semibold text-emerald-950">
                  تم قراءة موقع المتصفح الحالي:{' '}
                  <span className="font-mono tabular-nums" dir="ltr">
                    ({gpsPendingCoords.lat.toFixed(5)}, {gpsPendingCoords.lng.toFixed(5)})
                  </span>
                  . هل تؤكد اعتماده كنقطة بداية التوصيل؟
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmGpsStartPoint}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>تأكيد الموقع الحالي كنقطة بداية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGpsPendingCoords(null)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-900 text-xs font-medium hover:bg-emerald-100 transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {gpsError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
                {gpsError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
            <button
              type="button"
              disabled={isLoadingGps}
              onClick={handleRequestBrowserGps}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              {isLoadingGps ? (
                <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />
              ) : (
                <Compass className="w-4 h-4 text-sky-600" />
              )}
              <span>استخدام موقعي الحالي</span>
            </button>

            <button
              type="button"
              onClick={onOpenStartPointMap}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <MapPin className="w-4 h-4 text-sky-400" />
              <span>تحديد نقطة البداية على الخريطة</span>
            </button>
          </div>
        </div>

        {/* Step 2: Order Readiness Summary & Calculate Route CTA */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-base font-bold text-slate-900">2. ملخص جاهزية الأوردرات وحساب المسار</h2>
              <button
                type="button"
                onClick={onOpenAddManualOrder}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة أوردر يدويًا</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-xs text-slate-500">العدد الكلي للأوردرات</div>
                <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
                  {totalOrdersCount}
                </div>
              </div>
              <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl">
                <div className="text-xs text-emerald-800">مواقع صحيحة ومؤكدة</div>
                <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
                  {validOrdersCount}
                </div>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl">
                <div className="text-xs text-amber-900">تحتاج إلى مراجعة/تصحيح</div>
                <div className="text-xl font-extrabold font-mono tabular-nums text-amber-700 mt-1">
                  {needsCorrectionCount}
                </div>
              </div>
              <div className="p-3 bg-slate-100/70 border border-slate-200 rounded-xl">
                <div className="text-xs text-slate-600">مستبعدة صراحةً</div>
                <div className="text-xl font-extrabold font-mono tabular-nums text-slate-700 mt-1">
                  {excludedOrders.length}
                </div>
              </div>
            </div>

            {/* Warning when some orders need correction */}
            {needsCorrectionCount > 0 && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    لا يمكن حساب المسار الشامل قبل مراجعة أو تصحيح الأوردرات غير المؤكدة ({needsCorrectionCount}{' '}
                    أوردر)، أو يمكنك استبعادها صراحةً الآن لحساب المسار لبقية الأوردرات الصحيحة.
                  </span>
                </div>
                {validOrdersCount > 0 && (
                  <button
                    type="button"
                    onClick={onExcludeAllInvalidOrders}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    استبعاد الأوردرات غير الصالحة ({needsCorrectionCount})
                  </button>
                )}
              </div>
            )}

            {/* Clear display of explicitly excluded orders and why */}
            {excludedOrders.length > 0 && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-xs text-slate-700">
                <div className="font-bold text-slate-800 mb-1">
                  الأوردرات المستبعدة من المسار ({excludedOrders.length}):
                </div>
                <ul className="space-y-1">
                  {excludedOrders.map((eo) => (
                    <li key={eo.id} className="flex items-center justify-between gap-2">
                      <span>
                        • <strong>{eo.customerName || 'عميل بدون اسم'}</strong> — السبب:{' '}
                        {eo.exclusionReason || eo.locationStatus}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleExcludeOrder(eo)}
                        className="text-sky-600 hover:underline font-medium shrink-0"
                      >
                        إعادة إدراج
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {routeError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl mb-4 flex items-center justify-between gap-3 text-xs text-red-800">
                <span>{routeError}</span>
                <button
                  type="button"
                  onClick={onCalculateRoute}
                  className="min-h-[36px] px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold whitespace-nowrap shrink-0"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              disabled={!canCalculateRoute}
              onClick={onCalculateRoute}
              className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm sm:text-base font-bold flex items-center justify-center gap-2.5 transition-colors shadow-xs"
            >
              {isCalculatingRoute ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري حساب أفضل خط سير على شبكة الطرق الفعلية...</span>
                </>
              ) : (
                <>
                  <Route className="w-5 h-5" />
                  <span>
                    {!startPoint
                      ? 'حدد نقطة البداية أولًا لحساب المسار'
                      : needsCorrectionCount > 0
                      ? `راجع أو استبعد الأوردرات المعلقة (${needsCorrectionCount}) قبل حساب المسار`
                      : validOrdersCount === 0
                      ? 'لا توجد أوردرات صالحة لحساب المسار'
                      : `حساب أفضل خط سير لـ (${validOrdersCount}) أوردر على الطرق`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Filter Control Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الكل ({totalOrdersCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('valid')}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filter === 'valid'
                ? 'bg-white text-emerald-800 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            المواقع الصحيحة ({validOrdersCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('needs_fix')}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filter === 'needs_fix'
                ? 'bg-white text-amber-800 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            تحتاج لمراجعة أو تصحيح ({needsCorrectionCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('excluded')}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filter === 'excluded'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            المستبعدة ({excludedOrders.length})
          </button>
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
          <p className="text-base font-bold text-slate-800">لا توجد أوردرات في هذا التصنيف حاليًا</p>
          <p className="text-xs text-slate-500">
            يمكنك لصق رسائل واتساب من شاشة الإدخال أو إضافة أوردر جديد يدويًا.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order, idx) => {
            const googleMapsUrl = buildGoogleMapsDirectionUrl(order.coordinates, order.mapUrl);
            const isReady = isOrderLocationReadyForRoute(order);

            return (
              <div
                key={order.id}
                className={`bg-white border rounded-2xl p-5 transition-colors ${
                  order.excludedFromRoute
                    ? 'border-slate-200 bg-slate-50/70 opacity-80'
                    : isReady
                    ? 'border-slate-200'
                    : 'border-amber-300 bg-amber-50/10'
                }`}
              >
                {/* Header Row: Name + Unboxed Status Text */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                      <span className="font-mono tabular-nums font-semibold text-slate-700">
                        أوردر #{idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={getStatusTextStyle(order.locationStatus, order.excludedFromRoute)}>
                        {order.excludedFromRoute
                          ? `مستبعد من المسار (${order.exclusionReason || order.locationStatus})`
                          : order.locationStatus}
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

                    <h3 className="text-lg font-bold text-slate-900">
                      {order.customerName || 'عميل بدون اسم مستخرج'}
                    </h3>
                  </div>

                  {/* Quick Confirm Button when geocoded coordinates await user confirmation */}
                  {!order.excludedFromRoute &&
                    order.coordinates &&
                    !order.locationConfirmedByUser && (
                      <button
                        type="button"
                        onClick={() => onConfirmOrderLocation(order.id)}
                        className="min-h-[40px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 shadow-2xs"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>تأكيد صحة الموقع على الخريطة</span>
                      </button>
                    )}
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3 text-sm">
                  <div className="space-y-1.5">
                    <div className="text-xs text-slate-500">
                      رقم التليفون:{' '}
                      {order.phone ? (
                        <a
                          href={`tel:${order.phone}`}
                          dir="ltr"
                          className="font-mono tabular-nums font-semibold text-sky-700 hover:underline"
                        >
                          {order.phone}
                        </a>
                      ) : (
                        <span className="text-amber-700">غير متوفر</span>
                      )}
                    </div>

                    <div className="text-xs text-slate-500">
                      العنوان:{' '}
                      <span className="font-medium text-slate-900">
                        {order.address || 'لم يتم تحديد عنوان نصي'}
                      </span>
                    </div>

                    {order.orderDetails && (
                      <div className="text-xs text-slate-500">
                        تفاصيل الطلب:{' '}
                        <span className="font-medium text-slate-800">{order.orderDetails}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs text-slate-500">
                      الموقع / الإحداثيات:{' '}
                      {order.coordinates ? (
                        <span className="font-mono tabular-nums font-semibold text-slate-900" dir="ltr">
                          {order.coordinates.lat.toFixed(6)}, {order.coordinates.lng.toFixed(6)}
                        </span>
                      ) : (
                        <span className="text-red-600 font-medium">لا توجد إحداثيات محددة</span>
                      )}
                    </div>

                    {order.geocodedDisplayName && (
                      <div className="text-xs text-slate-600">
                        الموقع المكتشف من الخريطة:{' '}
                        <span className="text-slate-800 font-medium">{order.geocodedDisplayName}</span>
                      </div>
                    )}

                    {order.reviewNote && !order.locationConfirmedByUser && (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5">
                        {order.reviewNote}
                      </div>
                    )}

                    {order.hasDuplicateLocation && order.duplicateWithNames && (
                      <div className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>
                          تنبيه: يوجد أوردر آخر في نفس الموقع ({order.duplicateWithNames.join('، ')}) — تم الاحتفاظ بجميع الأوردرات.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expandable Original Message */}
                {expandedRawId === order.id && (
                  <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 whitespace-pre-line">
                    <div className="font-bold text-slate-500 mb-1">نص رسالة واتساب الأصلي:</div>
                    {order.rawMessage}
                  </div>
                )}

                {/* Action Bar */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPickOrderLocationOnMap(order)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>
                        {order.coordinates && !order.locationConfirmedByUser
                          ? 'مراجعة وتأكيد على الخريطة'
                          : 'تحديد الموقع يدويًا على الخريطة'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditOrder(order)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                      <span>تعديل البيانات</span>
                    </button>

                    {googleMapsUrl && (
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-sky-600" />
                        <span>فتح في خرائط جوجل</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRawId(expandedRawId === order.id ? null : order.id)
                      }
                      className="min-h-[40px] px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      {expandedRawId === order.id ? 'إخفاء النص الأصلي' : 'عرض النص الأصلي'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleExcludeOrder(order)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      {order.excludedFromRoute ? (
                        <>
                          <Navigation className="w-3.5 h-3.5 text-sky-600" />
                          <span>إدراج في المسار</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>استبعاد من المسار</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteOrderRequest(order)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
