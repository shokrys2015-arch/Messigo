import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  FileText,
  MapPin,
  Phone,
  PlusCircle,
  Printer,
  Route,
  Trash2,
} from 'lucide-react';
import { DayRecord, DeliveryOrder } from '../types/messigo';
import { formatDistanceArabic } from '../services/routingService';

interface DaysHistoryViewProps {
  days: DayRecord[];
  activeDayId: string;
  selectedViewingDayId: string;
  onSelectDayToView: (dayId: string) => void;
  onRequestStartNewDay: () => void;
  onDeleteOrderFromDay: (dayId: string, orderId: string, customerName: string) => void;
  onRenameDay: (dayId: string, currentTitle: string) => void;
  onExportDayPdf: (day: DayRecord) => void;
}

export const DaysHistoryView: React.FC<DaysHistoryViewProps> = ({
  days,
  activeDayId,
  selectedViewingDayId,
  onSelectDayToView,
  onRequestStartNewDay,
  onDeleteOrderFromDay,
  onRenameDay,
  onExportDayPdf,
}) => {
  const [expandedDayIds, setExpandedDayIds] = useState<Set<string>>(new Set());

  const toggleExpandDay = (dayId: string) => {
    setExpandedDayIds((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">سجل الأوردرات والرحلات السابقة</h2>
          <p className="text-sm text-slate-600 mt-1">
            يحتفظ Messigo بسجل مستقل لكل أوردر ورحلة مع تفاصيل العملاء، والقدرة على تعديل الأسماء وحذف أي أوردر أو تصدير تقرير PDF.
          </p>
        </div>

        <button
          type="button"
          onClick={onRequestStartNewDay}
          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
        >
          <PlusCircle className="w-4 h-4" />
          <span>عمل أوردر جديد</span>
        </button>
      </div>

      <div className="space-y-4">
        {days.map((day) => {
          const isCurrentActive = day.id === activeDayId;
          const isCurrentlyViewing = day.id === selectedViewingDayId;
          const isExpanded = expandedDayIds.has(day.id);
          const totalOrders = day.orders.length;
          const deliveredOrders = day.orders.filter(
            (o) => o.deliveryStatus === 'تم التسليم'
          ).length;
          const routeDistance = day.calculatedRoute
            ? formatDistanceArabic(day.calculatedRoute.totalDistanceMeters)
            : 'لم يُحسب مسار';

          return (
            <div
              key={day.id}
              className={`bg-white border rounded-2xl overflow-hidden transition-colors ${
                isCurrentlyViewing
                  ? 'border-sky-500 ring-2 ring-sky-500/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-[260px]">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Calendar className="w-3.5 h-3.5 text-sky-600" />
                    <span className="font-mono tabular-nums">{day.dateKey}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        isCurrentActive
                          ? 'text-emerald-700 font-bold'
                          : 'text-slate-600 font-medium'
                      }
                    >
                      {isCurrentActive ? 'الأوردر الحالي النشط' : 'سجل أوردرات محفوظ'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{day.title}</h3>
                    <button
                      type="button"
                      onClick={() => onRenameDay(day.id, day.title)}
                      className="p-1 rounded-md text-slate-400 hover:text-sky-700 hover:bg-sky-50 transition-colors"
                      title="تعديل اسم هذا الأوردر / الرحلة"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 pt-1">
                    <span>
                      إجمالي الأوردرات:{' '}
                      <strong className="font-mono tabular-nums text-slate-900">
                        {totalOrders}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      تم التسليم:{' '}
                      <strong className="font-mono tabular-nums text-emerald-700">
                        {deliveredOrders}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Route className="w-3.5 h-3.5 text-sky-600" />
                      <span>المسافة المحسوبة: </span>
                      <strong className="font-mono tabular-nums text-slate-900">
                        {routeDistance}
                      </strong>
                    </span>
                    {day.startPoint && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span>نقطة البداية: {day.startPoint.label}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onExportDayPdf(day)}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                    title="تصدير بيان الرحلة بصيغة PDF للطباعة"
                  >
                    <Printer className="w-4 h-4 text-sky-600" />
                    <span>تصدير PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleExpandDay(day.id)}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4 text-slate-500" />
                        <span>إخفاء الأوردرات</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                        <span>عرض الأوردرات ({totalOrders})</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectDayToView(day.id)}
                    className={`min-h-[42px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs ${
                      isCurrentlyViewing
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {isCurrentlyViewing ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>مفتوح حاليًا</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 text-sky-400" />
                        <span>فتح واستعراض</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Expandable Order List inside this Day */}
              {isExpanded && (
                <div className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 px-1">
                    <span>قائمة أوردرات هذا السجل ({day.orders.length} أوردر):</span>
                    <span className="text-[11px] text-slate-500 font-normal">
                      يمكنك مسح أي أوردر ملغى أو غير مطلوب مباشرةً
                    </span>
                  </div>

                  {day.orders.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded-xl">
                      لا توجد أوردرات مسجلة في هذا السجل بعد.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.orders.map((order, idx) => {
                        const isDelivered = order.deliveryStatus === 'تم التسليم';
                        return (
                          <div
                            key={order.id}
                            className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-wrap items-start justify-between gap-3 shadow-xs hover:border-slate-300 transition-colors"
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                                {idx + 1}
                              </span>
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-slate-900 text-sm">
                                    {order.customerName || 'بدون اسم'}
                                  </span>
                                  {order.phone && (
                                    <span
                                      className="font-mono text-xs text-slate-500 flex items-center gap-1"
                                      dir="ltr"
                                    >
                                      <Phone className="w-3 h-3 text-sky-600" />
                                      {order.phone}
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      isDelivered
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {order.deliveryStatus}
                                  </span>
                                </div>

                                <div className="text-xs text-slate-600 leading-relaxed">
                                  {order.address || order.locationText || 'بدون عنوان نصي'}
                                </div>

                                {order.orderDetails && (
                                  <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1">
                                    {order.orderDetails}
                                  </div>
                                )}

                                {order.totalPrice && (
                                  <div className="text-xs font-bold text-slate-900">
                                    المطلوب:{' '}
                                    <span className="font-mono tabular-nums text-sky-700">
                                      {order.totalPrice}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onDeleteOrderFromDay(
                                    day.id,
                                    order.id,
                                    order.customerName || `الأوردر رقم ${idx + 1}`
                                  )
                                }
                                className="min-h-[36px] px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                title="مسح هذا الأوردر من اليوم"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>مسح الأوردر</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
