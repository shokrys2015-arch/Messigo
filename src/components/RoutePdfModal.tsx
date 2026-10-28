import React, { useRef } from 'react';
import {
  Printer,
  X,
  Share2,
  Calendar,
  MapPin,
  Route,
  Clock,
  Coins,
  CheckCircle2,
  Copy,
  User,
} from 'lucide-react';
import { CalculatedRoute, DeliveryOrder } from '../types/messigo';
import { formatDistanceArabic, formatDurationArabic } from '../services/routingService';

interface RoutePdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  dayTitle: string;
  dateKey: string;
  courierName?: string;
  orders: DeliveryOrder[];
  route: CalculatedRoute | null;
  onCopySuccess?: (msg: string) => void;
}

export function parsePriceToNumber(priceStr: string | undefined): number {
  if (!priceStr) return 0;
  // Convert Eastern Arabic numerals (٠-٩) to Western (0-9)
  const normalized = priceStr
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[^\d.]/g, '');
  const val = parseFloat(normalized);
  return Number.isFinite(val) ? val : 0;
}

export const RoutePdfModal: React.FC<RoutePdfModalProps> = ({
  isOpen,
  onClose,
  dayTitle,
  dateKey,
  courierName,
  orders,
  route,
  onCopySuccess,
}) => {
  const printAreaRef = useRef<HTMLDivElement | null>(null);

  if (!isOpen) return null;

  // Ordered list of stops matching the calculated route sequence (or original order if no route yet)
  const orderedStops = route
    ? route.orderedOrderIds
        .map((id, idx) => {
          const order = orders.find((o) => o.id === id);
          if (!order) return null;
          const leg = route.legs.find((l) => l.orderId === id) || null;
          return { visitNumber: idx + 1, order, leg };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : orders.map((order, idx) => ({ visitNumber: idx + 1, order, leg: null }));

  const deliveredCount = orders.filter((o) => o.deliveryStatus === 'تم التسليم').length;
  const remainingCount = orders.length - deliveredCount;

  // Calculate total monetary collection from prices with Arabic numeral support
  const totalAmountNumber = orders.reduce((sum, o) => {
    return sum + parsePriceToNumber(o.totalPrice);
  }, 0);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyWhatsappManifest = () => {
    let manifestText = `📋 *بيان توزيع أوردرات: ${dayTitle}*\n`;
    manifestText += `📅 التاريخ: ${dateKey}\n`;
    if (courierName?.trim()) {
      manifestText += `🛵 اسم المندوب: ${courierName.trim()}\n`;
    }
    if (route) {
      manifestText += `📍 نقطة البداية: ${route.startPoint.label}\n`;
      manifestText += `🚗 إجمالي المسافة: ${formatDistanceArabic(route.totalDistanceMeters)} | الوقت: ${formatDurationArabic(route.totalDurationSeconds)}\n`;
    }
    manifestText += `📦 عدد الأوردرات: ${orders.length} | إجمالي التحصيل: ${totalAmountNumber > 0 ? `${totalAmountNumber.toLocaleString('ar-EG')} ج.م` : 'غير محدد'}\n`;
    manifestText += `────────────────────\n\n`;

    orderedStops.forEach(({ visitNumber, order, leg }) => {
      manifestText += `*محطة (${visitNumber})*: ${order.customerName || 'بدون اسم'}\n`;
      if (order.phone) manifestText += `📞 تليفون: ${order.phone}\n`;
      manifestText += `🏠 العنوان: ${order.address || 'بدون عنوان نصي'}\n`;
      if (order.orderDetails) manifestText += `📦 الطلب: ${order.orderDetails}\n`;
      if (order.totalPrice) manifestText += `💰 المبلغ المطلوب: ${order.totalPrice}\n`;
      if (leg) manifestText += `🛣️ المسافة من المحطة السابقة: ${formatDistanceArabic(leg.distanceMeters)}\n`;
      if (order.mapUrl) manifestText += `🗺️ اللوكيشن: ${order.mapUrl}\n`;
      manifestText += `\n`;
    });

    manifestText += `نسخة من تطبيق Messigo لإدارة التوصيل`;

    navigator.clipboard.writeText(manifestText).then(() => {
      if (onCopySuccess) {
        onCopySuccess('تم نسخ بيان التوزيع للمندوب بنجاح بصيغة واتساب.');
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 md:p-6 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full shadow-2xl flex flex-col max-h-[95vh] overflow-hidden print:max-h-none print:shadow-none print:border-none print:rounded-none">
        {/* Modal Control Bar (Hidden when printing) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold text-sm">
              PDF
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                بيان وتفاصيل الأوردرات وخط السير للطباعة والتصدير
              </h3>
              <p className="text-xs text-slate-500">
                يمكنك حفظ البيان كملف PDF رسمي أو طباعته على ورق A4، أو نسخ نسخة للمندوب على واتساب.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyWhatsappManifest}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              title="نسخ البيان بتنسيق واتساب للمندوب"
            >
              <Copy className="w-4 h-4 text-emerald-600" />
              <span>نسخ لواتساب</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[40px] px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / حفظ كـ PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
              aria-label="إغلاق النافذة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Content Container */}
        <div
          ref={printAreaRef}
          className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1 bg-white print:p-6 print:overflow-visible print:text-black"
          dir="rtl"
        >
          {/* Document Header */}
          <div className="border-b-2 border-slate-900 pb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl font-black tracking-tight text-slate-900">
                  MESSIGO
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                  إدارة أوردرات وخطوط سير التوصيل
                </span>
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 mt-1">{dayTitle}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-sky-600" />
                  <span>تاريخ البيان: {dateKey}</span>
                </span>
                {courierName?.trim() && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1 text-slate-900 font-bold bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md print:bg-transparent print:border-none print:p-0">
                      <User className="w-3.5 h-3.5 text-amber-700" />
                      <span>المندوب: {courierName.trim()}</span>
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  توقيت الاستخراج:{' '}
                  {new Date().toLocaleTimeString('ar-EG', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            {route && (
              <div className="text-left text-xs text-slate-600 border border-slate-200 rounded-xl p-3 bg-slate-50 min-w-[200px] print:bg-transparent">
                <div className="font-bold text-slate-900 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-sky-600" />
                  <span>نقطة انطلاق الرحلة:</span>
                </div>
                <div className="mt-0.5 truncate text-slate-800">{route.startPoint.label}</div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5" dir="ltr">
                  {route.startPoint.coordinates.lat.toFixed(4)},{' '}
                  {route.startPoint.coordinates.lng.toFixed(4)}
                </div>
              </div>
            )}
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl print:border-slate-300">
              <div className="text-[11px] font-medium text-slate-500">إجمالي الأوردرات</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {orders.length} أوردر
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl print:border-slate-300">
              <div className="text-[11px] font-medium text-slate-500">إجمالي التحصيل المقدر</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {totalAmountNumber > 0
                  ? `${totalAmountNumber.toLocaleString('ar-EG')} ج.م`
                  : 'حسب الفاتورة'}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl print:border-slate-300">
              <div className="text-[11px] font-medium text-slate-500">مسافة خط السير</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {route ? formatDistanceArabic(route.totalDistanceMeters) : 'غير محسوب'}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl print:border-slate-300">
              <div className="text-[11px] font-medium text-slate-500">زمن القيادة المقدر</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {route ? formatDurationArabic(route.totalDurationSeconds) : 'غير محسوب'}
              </div>
            </div>
          </div>

          {/* Stops Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
              <span>جدول المحطات مرتبة بالتسلسل الفعلي للرحلة ({orderedStops.length} عميل):</span>
              <span className="text-[11px] text-slate-500 font-normal">
                تم التسليم: {deliveredCount} · متبقي: {remainingCount}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-slate-800 print:bg-slate-200">
                    <th className="py-2.5 px-2 font-bold w-10 text-center">#</th>
                    <th className="py-2.5 px-2.5 font-bold w-36">العميل والتواصل</th>
                    <th className="py-2.5 px-2.5 font-bold">العنوان التفصيلي ومكان التسليم</th>
                    <th className="py-2.5 px-2.5 font-bold w-44">الطلب والأصناف</th>
                    <th className="py-2.5 px-2 font-bold w-24 text-center">المطلوب</th>
                    <th className="py-2.5 px-2 font-bold w-24 text-center">المسافة</th>
                    <th className="py-2.5 px-2 font-bold w-24 text-center">توقيع المستلم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {orderedStops.map(({ visitNumber, order, leg }) => {
                    const isDelivered = order.deliveryStatus === 'تم التسليم';
                    return (
                      <tr
                        key={order.id}
                        className={`transition-colors print:border-b print:border-slate-200 ${
                          isDelivered ? 'bg-emerald-50/30' : 'bg-white'
                        }`}
                      >
                        <td className="py-3 px-2 text-center font-bold font-mono tabular-nums text-slate-900 align-top">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-800 text-xs font-bold print:border print:border-slate-400">
                            {visitNumber}
                          </span>
                        </td>

                        <td className="py-3 px-2.5 align-top">
                          <div className="font-bold text-slate-900 text-sm">
                            {order.customerName || 'بدون اسم'}
                          </div>
                          {order.phone ? (
                            <div
                              className="font-mono text-slate-600 text-[11px] mt-0.5 tracking-wide"
                              dir="ltr"
                            >
                              {order.phone}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">بدون هاتف</div>
                          )}
                          <div className="mt-1">
                            <span
                              className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                isDelivered
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {order.deliveryStatus}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-2.5 align-top leading-relaxed text-slate-800">
                          <div className="font-medium">
                            {order.address || order.locationText || 'لم يحدد عنوان نصي'}
                          </div>
                          {order.coordinates && (
                            <div
                              className="font-mono text-[10px] text-slate-400 mt-1"
                              dir="ltr"
                            >
                              📍 {order.coordinates.lat.toFixed(5)},{' '}
                              {order.coordinates.lng.toFixed(5)}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-2.5 align-top text-slate-700 leading-relaxed text-[11px]">
                          {order.orderDetails ? (
                            <div>{order.orderDetails}</div>
                          ) : (
                            <span className="text-slate-400 italic">بدون تفاصيل</span>
                          )}
                        </td>

                        <td className="py-3 px-2 text-center align-top font-bold font-mono tabular-nums text-slate-900">
                          {order.totalPrice ? (
                            <span>{order.totalPrice}</span>
                          ) : (
                            <span className="text-slate-400 font-normal">-</span>
                          )}
                        </td>

                        <td className="py-3 px-2 text-center align-top font-mono tabular-nums text-slate-600 text-[11px]">
                          {leg ? formatDistanceArabic(leg.distanceMeters) : '-'}
                        </td>

                        <td className="py-3 px-2 text-center align-top">
                          <div className="h-8 border border-dashed border-slate-300 rounded bg-slate-50/50 print:bg-white print:border-slate-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-900 bg-slate-100/90 text-slate-900 font-extrabold print:bg-slate-200">
                    <td colSpan={4} className="py-3 px-3 text-right">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">إجمالي المطلوب تحصيله من العملاء:</span>
                        <span className="text-xs text-slate-500 font-normal">
                          (مجموع جميع أوردرات الرحلة - {orders.length} أوردر)
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-sm tabular-nums text-sky-800 font-black border-x border-slate-300">
                      {totalAmountNumber > 0 ? `${totalAmountNumber.toLocaleString('ar-EG')} ج.م` : '0 ج.م'}
                    </td>
                    <td className="py-3 px-2 text-center font-mono text-xs text-slate-700 tabular-nums">
                      {route ? formatDistanceArabic(route.totalDistanceMeters) : '-'}
                    </td>
                    <td className="py-3 px-2 text-center text-[10px] text-slate-400 font-normal">
                      -
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Document Footer Notes */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-3">
            <div>
              تم استخراج هذا التقرير تلقائيًا بواسطة تطبيق <strong>Messigo</strong> لإدارة التوصيل
              وتحسين مسارات الطرق في مصر.
            </div>
            <div className="font-mono text-[11px]">
              عدد الأوردرات: {orders.length} | المحطات: {orderedStops.length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
