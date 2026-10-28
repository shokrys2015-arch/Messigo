import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  Filter,
  MapPin,
  Phone,
  PlusCircle,
  Printer,
  Route,
  Search,
  Share2,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { DayRecord, DeliveryOrder } from '../types/messigo';
import { formatDistanceArabic } from '../services/routingService';
import { parsePriceToNumber } from './RoutePdfModal';

interface DaysHistoryViewProps {
  days: DayRecord[];
  activeDayId: string;
  selectedViewingDayId: string;
  onSelectDayToView: (dayId: string) => void;
  onRequestStartNewDay: () => void;
  onDeleteOrderFromDay: (dayId: string, orderId: string, customerName: string) => void;
  onDeleteEntireDay: (dayId: string, dayTitle: string) => void;
  onRenameDay: (dayId: string, currentTitle: string) => void;
  onUpdateCourierName: (dayId: string, courierName: string) => void;
  onExportDayPdf: (day: DayRecord) => void;
  onShareDay?: (day: DayRecord) => void;
}

export const DaysHistoryView: React.FC<DaysHistoryViewProps> = ({
  days,
  activeDayId,
  selectedViewingDayId,
  onSelectDayToView,
  onRequestStartNewDay,
  onDeleteOrderFromDay,
  onDeleteEntireDay,
  onRenameDay,
  onUpdateCourierName,
  onExportDayPdf,
  onShareDay,
}) => {
  const [expandedDayIds, setExpandedDayIds] = useState<Set<string>>(new Set());

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [selectedCourierFilter, setSelectedCourierFilter] = useState<string>('all');

  // Inline Courier Name editing state
  const [editingCourierDayId, setEditingCourierDayId] = useState<string | null>(null);
  const [courierInputVal, setCourierInputVal] = useState('');

  const toggleExpandDay = (dayId: string) => {
    setExpandedDayIds((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  // Distinct dates and couriers list for drop-downs
  const availableDates = useMemo(() => {
    const dates = Array.from(new Set(days.map((d) => d.dateKey))).filter(Boolean);
    return dates.sort().reverse();
  }, [days]);

  const availableCouriers = useMemo(() => {
    const couriers = Array.from(
      new Set(
        days
          .map((d) => d.courierName?.trim())
          .filter((name): name is string => Boolean(name && name.length > 0))
      )
    );
    return couriers.sort();
  }, [days]);

  // Filtered days based on Search Query, Date, and Courier
  const filteredDays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return days.filter((day) => {
      // 1. Date filter
      if (selectedDateFilter !== 'all' && day.dateKey !== selectedDateFilter) {
        return false;
      }

      // 2. Courier filter
      if (selectedCourierFilter !== 'all') {
        if (selectedCourierFilter === '__unassigned__') {
          if (day.courierName && day.courierName.trim().length > 0) return false;
        } else {
          if (day.courierName?.trim() !== selectedCourierFilter) return false;
        }
      }

      // 3. Search query across all data
      if (!q) return true;

      const titleMatch = day.title?.toLowerCase().includes(q);
      const dateMatch = day.dateKey?.toLowerCase().includes(q);
      const courierMatch = day.courierName?.toLowerCase().includes(q);

      // Check if any order inside matches
      const orderMatch = day.orders.some((o) => {
        return (
          o.customerName?.toLowerCase().includes(q) ||
          o.phone?.toLowerCase().includes(q) ||
          o.address?.toLowerCase().includes(q) ||
          o.locationText?.toLowerCase().includes(q) ||
          o.orderDetails?.toLowerCase().includes(q) ||
          o.totalPrice?.toLowerCase().includes(q)
        );
      });

      return Boolean(titleMatch || dateMatch || courierMatch || orderMatch);
    });
  }, [days, searchQuery, selectedDateFilter, selectedCourierFilter]);

  const isFilterActive =
    Boolean(searchQuery.trim()) ||
    selectedDateFilter !== 'all' ||
    selectedCourierFilter !== 'all';

  const handleStartEditCourier = (dayId: string, currentName?: string) => {
    setEditingCourierDayId(dayId);
    setCourierInputVal(currentName || '');
  };

  const handleSaveCourier = (dayId: string) => {
    onUpdateCourierName(dayId, courierInputVal.trim());
    setEditingCourierDayId(null);
  };

  const handleCancelEditCourier = () => {
    setEditingCourierDayId(null);
    setCourierInputVal('');
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedDateFilter('all');
    setSelectedCourierFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">سجل الأوردرات</h2>
          <p className="text-sm text-slate-600 mt-1">
            إدارة وحفظ جميع أوردراتك السابقة، تعيين أسماء المناديب، البحث الشامل بالتاريخ واسم المندوب، وتصدير بيان الـ PDF الرسمي وحذف السجلات.
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

      {/* Dedicated Search & Filter Bar Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Search className="w-4 h-4 text-sky-600" />
            <span>بحث وتصفية في سجل الأوردرات</span>
          </div>
          {isFilterActive && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-xs text-sky-700 hover:text-sky-800 font-semibold flex items-center gap-1 hover:underline"
            >
              <X className="w-3.5 h-3.5" />
              <span>إلغاء التصفية</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* General Text Search */}
          <div className="md:col-span-6 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم العميل، التليفون، العنوان، الأصناف، أو الأوردر..."
              className="w-full pl-9 pr-4 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:bg-white text-slate-900 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                title="مسح البحث"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Dedicated Date Filter */}
          <div className="md:col-span-3">
            <div className="relative">
              <select
                value={selectedDateFilter}
                onChange={(e) => setSelectedDateFilter(e.target.value)}
                className="w-full pl-3 pr-8 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:bg-white text-slate-800 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">📅 كل التواريخ ({days.length})</option>
                {availableDates.map((dateStr) => {
                  const count = days.filter((d) => d.dateKey === dateStr).length;
                  return (
                    <option key={dateStr} value={dateStr}>
                      {dateStr} ({count} سجل)
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <Calendar className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Dedicated Courier Filter */}
          <div className="md:col-span-3">
            <div className="relative">
              <select
                value={selectedCourierFilter}
                onChange={(e) => setSelectedCourierFilter(e.target.value)}
                className="w-full pl-3 pr-8 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:bg-white text-slate-800 transition-colors appearance-none cursor-pointer"
              >
                <option value="all">🛵 كل المناديب</option>
                {availableCouriers.map((courier) => {
                  const count = days.filter((d) => d.courierName?.trim() === courier).length;
                  return (
                    <option key={courier} value={courier}>
                      {courier} ({count} سجل)
                    </option>
                  );
                })}
                <option value="__unassigned__">بدون مندوب محدد</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>

        {/* Results Count Banner */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <span>
            يتم عرض <strong>{filteredDays.length}</strong> من أصل {days.length} سجل أوردرات
          </span>
          {isFilterActive && (
            <span className="text-sky-700 font-medium">
              التصفية نشطة ({searchQuery ? `البحث: "${searchQuery}"` : ''}
              {selectedDateFilter !== 'all' ? ` · التاريخ: ${selectedDateFilter}` : ''}
              {selectedCourierFilter !== 'all' ? ` · المندوب: ${selectedCourierFilter === '__unassigned__' ? 'بدون مندوب' : selectedCourierFilter}` : ''})
            </span>
          )}
        </div>
      </div>

      {/* Days & Orders List */}
      <div className="space-y-4">
        {filteredDays.length === 0 ? (
          <div className="p-8 text-center bg-white border border-slate-200 rounded-2xl space-y-3">
            <p className="text-slate-600 text-sm">
              {isFilterActive
                ? 'لا توجد سجلات تطابق شروط البحث أو التصفية الحالية.'
                : 'لا توجد سجلات أوردرات محفوظة حتى الآن.'}
            </p>
            {isFilterActive && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-4 py-2 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-xl text-xs font-bold transition-colors"
              >
                مسح شروط البحث وإظهار الكل
              </button>
            )}
          </div>
        ) : (
          filteredDays.map((day) => {
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

            // Calculate total price for this day's orders
            const dayTotalPrice = day.orders.reduce((sum, o) => {
              return sum + parsePriceToNumber(o.totalPrice);
            }, 0);

            const isEditingThisCourier = editingCourierDayId === day.id;

            return (
              <div
                key={day.id}
                className={`bg-white border rounded-2xl overflow-hidden transition-colors shadow-xs ${
                  isCurrentlyViewing
                    ? 'border-sky-500 ring-2 ring-sky-500/15'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="p-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-[280px]">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-sky-600" />
                      <span className="font-mono tabular-nums">{day.dateKey}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          isCurrentActive
                            ? 'text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200'
                            : 'text-slate-600 font-medium'
                        }
                      >
                        {isCurrentActive ? 'الأوردر الحالي النشط' : 'سجل أوردرات محفوظ'}
                      </span>
                    </div>

                    {/* Order Title + Rename */}
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{day.title}</h3>
                      <button
                        type="button"
                        onClick={() => onRenameDay(day.id, day.title)}
                        className="p-1 rounded-md text-slate-400 hover:text-sky-700 hover:bg-sky-50 transition-colors"
                        title="تعديل اسم هذا الأوردر"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Dedicated Courier Name Field / Tab Under Order Title */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {isEditingThisCourier ? (
                        <div className="flex items-center gap-1.5 bg-amber-50/80 p-1.5 rounded-xl border border-amber-300">
                          <User className="w-4 h-4 text-amber-700 shrink-0 ml-1" />
                          <input
                            type="text"
                            value={courierInputVal}
                            onChange={(e) => setCourierInputVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveCourier(day.id);
                              if (e.key === 'Escape') handleCancelEditCourier();
                            }}
                            placeholder="اكتب اسم المندوب..."
                            autoFocus
                            className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-sky-500 w-44"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCourier(day.id)}
                            className="p-1 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                            title="حفظ اسم المندوب"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditCourier}
                            className="p-1 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors"
                            title="إلغاء"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {day.courierName?.trim() ? (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg text-xs font-bold">
                              <User className="w-3.5 h-3.5 text-amber-700" />
                              <span>اسم المندوب: {day.courierName.trim()}</span>
                              <button
                                type="button"
                                onClick={() => handleStartEditCourier(day.id, day.courierName)}
                                className="p-0.5 hover:text-amber-950 hover:bg-amber-100 rounded mr-1 transition-colors"
                                title="تعديل اسم المندوب"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEditCourier(day.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200 border border-dashed border-slate-300 rounded-lg transition-colors"
                              title="إضافة اسم المندوب لهذا الأوردر"
                            >
                              <User className="w-3.5 h-3.5" />
                              <span>+ إضافة اسم المندوب</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Quick Stats: Orders, Delivered, Price, Route */}
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
                      <span>
                        إجمالي التحصيل:{' '}
                        <strong className="font-mono tabular-nums text-sky-800 font-bold">
                          {dayTotalPrice > 0 ? `${dayTotalPrice.toLocaleString('ar-EG')} ج.م` : 'غير محدد'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Route className="w-3.5 h-3.5 text-sky-600" />
                        <span>المسافة: </span>
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

                  {/* Actions Column */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Share Delivery Route Button */}
                    {onShareDay && (
                      <button
                        type="button"
                        onClick={() => onShareDay(day)}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                        title="مشاركة مسار التوصيل مع المندوب عبر واتساب أو رابط مباشر"
                      >
                        <Share2 className="w-4 h-4 text-emerald-700" />
                        <span>مشاركة</span>
                      </button>
                    )}

                    {/* PDF Export Button (Dedicated in سجل الأوردرات) */}
                    <button
                      type="button"
                      onClick={() => onExportDayPdf(day)}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                      title="تصدير بيان الأوردرات والرحلة بصيغة PDF للطباعة وحفظه"
                    >
                      <Printer className="w-4 h-4 text-sky-700" />
                      <span>تصدير PDF</span>
                    </button>

                    {/* Expand/Collapse Orders list */}
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

                    {/* Open & View */}
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

                    {/* Delete Entire Day / Batch */}
                    <button
                      type="button"
                      onClick={() => onDeleteEntireDay(day.id, day.title)}
                      className="min-h-[42px] px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                      title="حذف هذا اليوم / الأوردر بالكامل مع جميع أوردراته"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">حذف السجل بالكامل</span>
                    </button>
                  </div>
                </div>

                {/* Expandable Order List inside this Day */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 px-1">
                      <span>قائمة أوردرات هذا السجل ({day.orders.length} أوردر):</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        يمكنك مسح أي أوردر فردي ملغى أو غير مطلوب مباشرةً
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
          })
        )}
      </div>
    </div>
  );
};
