import React, { useEffect, useState } from 'react';
import { Check, Link2, MapPin, X } from 'lucide-react';
import { Coordinates, DeliveryOrder, LocationStatus } from '../types/messigo';
import { isValidCoordinates, normalizeDigits, parseMapUrl } from '../services/whatsappParser';

interface OrderFormModalProps {
  isOpen: boolean;
  initialOrder: DeliveryOrder | null; // null = adding new manual order
  onSave: (order: DeliveryOrder) => void;
  onClose: () => void;
  onOpenMapPicker: (currentCoords: Coordinates | null, query: string, callback: (coords: Coordinates, label?: string) => void) => void;
}

export const OrderFormModal: React.FC<OrderFormModalProps> = ({
  isOpen,
  initialOrder,
  onSave,
  onClose,
  onOpenMapPicker,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [locationText, setLocationText] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [latStr, setLatStr] = useState('');
  const [lngStr, setLngStr] = useState('');
  const [orderDetails, setOrderDetails] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [excludedFromRoute, setExcludedFromRoute] = useState(false);
  const [exclusionReason, setExclusionReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    if (initialOrder) {
      setCustomerName(initialOrder.customerName);
      setPhone(initialOrder.phone);
      setAddress(initialOrder.address);
      setLocationText(initialOrder.locationText);
      setMapUrl(initialOrder.mapUrl);
      setLatStr(initialOrder.coordinates ? String(initialOrder.coordinates.lat) : '');
      setLngStr(initialOrder.coordinates ? String(initialOrder.coordinates.lng) : '');
      setOrderDetails(initialOrder.orderDetails);
      setTotalPrice(initialOrder.totalPrice);
      setExcludedFromRoute(initialOrder.excludedFromRoute);
      setExclusionReason(initialOrder.exclusionReason || '');
    } else {
      setCustomerName('');
      setPhone('');
      setAddress('');
      setLocationText('');
      setMapUrl('');
      setLatStr('');
      setLngStr('');
      setOrderDetails('');
      setTotalPrice('');
      setExcludedFromRoute(false);
      setExclusionReason('');
    }
  }, [isOpen, initialOrder]);

  if (!isOpen) return null;

  const handleExtractFromUrl = () => {
    if (!mapUrl.trim()) return;
    const parsed = parseMapUrl(mapUrl);
    if (parsed.coordinates) {
      setLatStr(String(parsed.coordinates.lat));
      setLngStr(String(parsed.coordinates.lng));
      setErrorMsg(null);
    } else if (parsed.hasInvalidCoordinates) {
      setErrorMsg('الرابط يحتوي على إحداثيات غير صالحة خارج النطاق الجغرافي.');
    } else if (parsed.searchQuery) {
      if (!locationText) setLocationText(parsed.searchQuery);
      setErrorMsg(
        'الرابط عبارة عن بحث نصي ولا يحتوي على إحداثيات رقمية مباشرة. اضغط على «تحديد على الخريطة» للتحقق من الموقع وتأكيده.'
      );
    } else {
      setErrorMsg('لم يتم العثور على إحداثيات رقمية مباشرة داخل هذا الرابط. يمكنك تحديد الموقع على الخريطة.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!customerName.trim() && !address.trim()) {
      setErrorMsg('يرجى إدخال اسم العميل أو العنوان على الأقل لحفظ الأوردر.');
      return;
    }

    let coordinates: Coordinates | null = null;
    let locationStatus: LocationStatus = 'الموقع غير موجود';
    let locationConfirmedByUser = false;
    let reviewNote: string | undefined;

    const cleanLat = normalizeDigits(latStr.trim());
    const cleanLng = normalizeDigits(lngStr.trim());

    if (cleanLat || cleanLng) {
      const lat = parseFloat(cleanLat);
      const lng = parseFloat(cleanLng);
      if (!isValidCoordinates(lat, lng)) {
        locationStatus = 'الإحداثيات غير صحيحة';
        reviewNote = 'الإحداثيات المدخلة غير صحيحة.';
      } else {
        coordinates = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
        locationStatus = 'الموقع صحيح';
        locationConfirmedByUser = true;
      }
    } else if (mapUrl.trim()) {
      const parsed = parseMapUrl(mapUrl.trim());
      if (parsed.coordinates) {
        coordinates = parsed.coordinates;
        locationStatus = 'الموقع صحيح';
        locationConfirmedByUser = true;
      } else if (parsed.hasInvalidCoordinates) {
        locationStatus = 'الإحداثيات غير صحيحة';
      } else {
        locationStatus = 'يحتاج إلى مراجعة';
        reviewNote = 'يحتاج الموقع إلى تحديد أو تأكيد على الخريطة.';
      }
    } else if (address.trim() || locationText.trim()) {
      locationStatus = 'يحتاج إلى مراجعة';
      reviewNote = 'لم يتم تحديد إحداثيات الموقع بعد؛ يرجى تحديده على الخريطة.';
    }

    const savedOrder: DeliveryOrder = {
      id: initialOrder?.id || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      customerName: customerName.trim() || 'عميل بدون اسم',
      phone: normalizeDigits(phone.trim()),
      address: address.trim(),
      locationText: locationText.trim() || address.trim(),
      mapUrl: mapUrl.trim(),
      coordinates,
      locationConfirmedByUser,
      locationStatus,
      reviewNote,
      orderDetails: orderDetails.trim(),
      totalPrice: totalPrice.trim(),
      rawMessage:
        initialOrder?.rawMessage ||
        `${customerName}\nت: ${phone}\n${address}\n${orderDetails}\nالإجمالي: ${totalPrice}`.trim(),
      deliveryStatus: initialOrder?.deliveryStatus || 'قيد الانتظار',
      deliveredAt: initialOrder?.deliveredAt,
      excludedFromRoute,
      exclusionReason: excludedFromRoute
        ? exclusionReason.trim() || 'تم استبعاده يدويًا بواسطة المستخدم'
        : undefined,
      createdAt: initialOrder?.createdAt || new Date().toISOString(),
    };

    onSave(savedOrder);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full overflow-hidden shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900">
            {initialOrder ? 'تعديل بيانات الأوردر' : 'إضافة أوردر جديد يدويًا'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم العميل
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="مثال: محمود الخطيب"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                رقم التليفون
              </label>
              <input
                type="text"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01000000000"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums text-right bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              عنوان التوصيل بالتفصيل
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="مثال: النادي الأهلي – فرع مدينة نصر"
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                تفاصيل الطلب
              </label>
              <input
                type="text"
                value={orderDetails}
                onChange={(e) => setOrderDetails(e.target.value)}
                placeholder="مثال: ٤ تيشيرتات"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                الإجمالي / السعر
              </label>
              <input
                type="text"
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="مثال: ١٥٠٠ جنيه"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Location & Coordinates Box */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">بيانات الموقع الجغرافي والإحداثيات</span>
              <button
                type="button"
                onClick={() => {
                  const currCoords =
                    latStr && lngStr && isValidCoordinates(parseFloat(latStr), parseFloat(lngStr))
                      ? { lat: parseFloat(latStr), lng: parseFloat(lngStr) }
                      : null;
                  onOpenMapPicker(
                    currCoords,
                    locationText || address,
                    (pickedCoords, pickedLabel) => {
                      setLatStr(String(pickedCoords.lat));
                      setLngStr(String(pickedCoords.lng));
                      if (pickedLabel && !locationText) {
                        setLocationText(pickedLabel);
                      }
                      setErrorMsg(null);
                    }
                  );
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>تحديد الموقع يدويًا على الخريطة</span>
              </button>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                dir="ltr"
                value={mapUrl}
                onChange={(e) => setMapUrl(e.target.value)}
                placeholder="رابط خرائط جوجل (اختياري)..."
                className="flex-1 min-h-[40px] px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
              <button
                type="button"
                onClick={handleExtractFromUrl}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Link2 className="w-3.5 h-3.5 text-sky-600" />
                <span>استخراج من الرابط</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  خط العرض (Latitude)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={latStr}
                  onChange={(e) => setLatStr(e.target.value)}
                  placeholder="30.0712"
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  خط الطول (Longitude)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={lngStr}
                  onChange={(e) => setLngStr(e.target.value)}
                  placeholder="31.3521"
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                />
              </div>
            </div>
          </div>

          {/* Explicit Exclusion Option */}
          <div className="pt-2 border-t border-slate-200 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludedFromRoute}
                onChange={(e) => setExcludedFromRoute(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
              />
              <span className="text-sm font-medium text-slate-700">
                استبعاد هذا الأوردر من حساب المسار الحالي
              </span>
            </label>
            {excludedFromRoute && (
              <input
                type="text"
                value={exclusionReason}
                onChange={(e) => setExclusionReason(e.target.value)}
                placeholder="سبب الاستبعاد (مثال: العميل طلب التأجيل للغد أو الموقع غير متاح)..."
                className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-amber-50/60 border border-amber-200 rounded-lg focus:outline-none focus:border-amber-500"
              />
            )}
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Check className="w-4 h-4" />
              <span>حفظ بيانات الأوردر</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
