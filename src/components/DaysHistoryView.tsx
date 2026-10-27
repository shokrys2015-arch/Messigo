import React from 'react';
import { Calendar, CheckCircle2, Eye, MapPin, PlusCircle, Route } from 'lucide-react';
import { DayRecord } from '../types/messigo';
import { formatDistanceArabic } from '../services/routingService';

interface DaysHistoryViewProps {
  days: DayRecord[];
  activeDayId: string;
  selectedViewingDayId: string;
  onSelectDayToView: (dayId: string) => void;
  onRequestStartNewDay: () => void;
}

export const DaysHistoryView: React.FC<DaysHistoryViewProps> = ({
  days,
  activeDayId,
  selectedViewingDayId,
  onSelectDayToView,
  onRequestStartNewDay,
}) => {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">إدارة الأيام وسجل المسارات السابقة</h2>
          <p className="text-sm text-slate-600 mt-1">
            يحتفظ Messigo بسجل مستقل لكل يوم عمل مع الأوردرات وحالات التسليم والمسار الذي تم حسابه دون حذف الأيام السابقة.
          </p>
        </div>

        <button
          type="button"
          onClick={onRequestStartNewDay}
          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
        >
          <PlusCircle className="w-4 h-4" />
          <span>ابدأ يوم جديد</span>
        </button>
      </div>

      <div className="space-y-3">
        {days.map((day) => {
          const isCurrentActive = day.id === activeDayId;
          const isCurrentlyViewing = day.id === selectedViewingDayId;
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
              className={`bg-white border rounded-2xl p-5 transition-colors ${
                isCurrentlyViewing
                  ? 'border-sky-500 ring-2 ring-sky-500/15'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1.5">
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
                      {isCurrentActive ? 'اليوم الحالي النشط' : 'سجل يوم سابق محفوظ'}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-slate-900">{day.title}</h3>

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

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onSelectDayToView(day.id)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                      isCurrentlyViewing
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {isCurrentlyViewing ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>مفتوح حاليًا للمراجعة</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 text-sky-400" />
                        <span>فتح واستعراض بيانات ومسار هذا اليوم</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
