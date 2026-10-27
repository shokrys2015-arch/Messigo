/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Database,
  History,
  MessageSquarePlus,
  Route,
} from 'lucide-react';
import {
  Coordinates,
  DayRecord,
  DeliveryOrder,
  MessigoBackupFile,
  StartPoint,
} from './types/messigo';
import {
  parseSingleOrderMessage,
  splitBulkWhatsappMessages,
} from './services/whatsappParser';
import {
  recalculateOrdersLocationStatus,
  resolvePendingOrderLocations,
} from './services/geocodingService';
import {
  calculateOptimizedRoadRoute,
  isOrderLocationReadyForRoute,
} from './services/routingService';
import {
  loadAllDaysAndActiveId,
  restoreBackupToDb,
  saveDayRecord,
  startNewDayInDb,
} from './services/storageService';
import { WhatsappInputView } from './components/WhatsappInputView';
import { OrdersReviewView } from './components/OrdersReviewView';
import { RouteAndDeliveryView } from './components/RouteAndDeliveryView';
import { DaysHistoryView } from './components/DaysHistoryView';
import { BackupView } from './components/BackupView';
import { InteractiveMapModal } from './components/InteractiveMapModal';
import { OrderFormModal } from './components/OrderFormModal';
import { ConfirmModal } from './components/ConfirmModal';

type ActiveTab = 'input' | 'review' | 'route' | 'history' | 'backup';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('input');
  const [days, setDays] = useState<DayRecord[]>([]);
  const [activeDayId, setActiveDayId] = useState<string>('');
  const [viewingDayId, setViewingDayId] = useState<string>('');
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  // Parsing & Geocoding state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingProgress, setAnalyzingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Route calculation state
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Toast feedback banner
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals state
  const [orderFormModalState, setOrderFormModalState] = useState<{
    isOpen: boolean;
    order: DeliveryOrder | null;
  }>({ isOpen: false, order: null });

  const [mapModalState, setMapModalState] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    initialCoordinates: Coordinates | null;
    initialSearchQuery?: string;
    onConfirm: (coords: Coordinates, label?: string) => void;
  }>({
    isOpen: false,
    title: '',
    initialCoordinates: null,
    onConfirm: () => {},
  });

  const [confirmModalState, setConfirmModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'primary' | 'warning';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'تأكيد',
    variant: 'primary',
    onConfirm: () => {},
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Load initial data from IndexedDB
  useEffect(() => {
    let mounted = true;
    loadAllDaysAndActiveId()
      .then(({ days: loadedDays, activeDayId: loadedActiveId }) => {
        if (!mounted) return;
        setDays(loadedDays);
        setActiveDayId(loadedActiveId);
        setViewingDayId(loadedActiveId);
        setIsDbLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load IndexedDB:', err);
        setIsDbLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Currently viewed day record (either active today or an inspected historical day)
  const currentDay: DayRecord | undefined = useMemo(() => {
    return days.find((d) => d.id === viewingDayId) || days.find((d) => d.id === activeDayId);
  }, [days, viewingDayId, activeDayId]);

  const isViewingHistoricalDay = Boolean(
    currentDay && activeDayId && currentDay.id !== activeDayId
  );

  // Helper to update a DayRecord in state and persist to IndexedDB
  const updateDayRecord = async (updatedDay: DayRecord) => {
    setDays((prev) => prev.map((d) => (d.id === updatedDay.id ? updatedDay : d)));
    await saveDayRecord(updatedDay);
  };

  // 1. Handle WhatsApp Bulk Message Analysis
  const handleAnalyzeOrders = async () => {
    if (!currentDay || !currentDay.rawInputText.trim()) return;
    setIsAnalyzing(true);
    setAnalyzingProgress(null);
    setRouteError(null);

    try {
      const blocks = splitBulkWhatsappMessages(currentDay.rawInputText);
      const parsedOrders = blocks.map((b) =>
        parseSingleOrderMessage(b.text, b.uncertainSplit)
      );

      // Resolve any place search queries / textual addresses via OpenStreetMap Nominatim
      const resolvedOrders = await resolvePendingOrderLocations(
        parsedOrders,
        (current, total) => {
          setAnalyzingProgress({ current, total });
        }
      );

      const combinedOrders = recalculateOrdersLocationStatus([
        ...currentDay.orders,
        ...resolvedOrders,
      ]);

      const updatedDay: DayRecord = {
        ...currentDay,
        rawInputText: '',
        orders: combinedOrders,
      };

      await updateDayRecord(updatedDay);
      setIsAnalyzing(false);
      setAnalyzingProgress(null);
      setActiveTab('review');
      showToast(`تم تحليل وإضافة ${resolvedOrders.length} أوردر بنجاح. يرجى مراجعة المواقع قبل حساب المسار.`);
    } catch (err) {
      setIsAnalyzing(false);
      setAnalyzingProgress(null);
      showToast(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تحليل الرسائل.'
      );
    }
  };

  // 2. Confirm a geocoded order's location
  const handleConfirmOrderLocation = async (orderId: string) => {
    if (!currentDay) return;
    const updatedOrders = recalculateOrdersLocationStatus(
      currentDay.orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              locationConfirmedByUser: true,
              locationStatus: 'الموقع صحيح',
              reviewNote: undefined,
            }
          : o
      )
    );
    await updateDayRecord({ ...currentDay, orders: updatedOrders });
    showToast('تم تأكيد صحة موقع العميل.');
  };

  // 3. Save manual or edited order
  const handleSaveOrderFromModal = async (savedOrder: DeliveryOrder) => {
    if (!currentDay) return;
    const exists = currentDay.orders.some((o) => o.id === savedOrder.id);
    const nextOrders = exists
      ? currentDay.orders.map((o) => (o.id === savedOrder.id ? savedOrder : o))
      : [...currentDay.orders, savedOrder];

    const recalculated = recalculateOrdersLocationStatus(nextOrders);
    await updateDayRecord({ ...currentDay, orders: recalculated });
    setOrderFormModalState({ isOpen: false, order: null });
    showToast(exists ? 'تم حفظ تعديلات الأوردر.' : 'تمت إضافة الأوردر الجديد بنجاح.');
  };

  // 4. Pick order location manually on interactive Leaflet map
  const handlePickOrderLocationOnMap = (order: DeliveryOrder) => {
    setMapModalState({
      isOpen: true,
      title: `تحديد موقع العميل: ${order.customerName || 'بدون اسم'}`,
      subtitle: order.address || order.locationText || 'اضغط على الخريطة لتحديد الموقع الصحيح',
      initialCoordinates: order.coordinates,
      initialSearchQuery: order.searchQueryFromUrl || order.locationText || order.address,
      onConfirm: async (coords, label) => {
        if (!currentDay) return;
        const nextOrders = recalculateOrdersLocationStatus(
          currentDay.orders.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  coordinates: coords,
                  geocodedDisplayName: label || o.geocodedDisplayName,
                  locationConfirmedByUser: true,
                  locationStatus: 'الموقع صحيح',
                  reviewNote: undefined,
                }
              : o
          )
        );
        await updateDayRecord({ ...currentDay, orders: nextOrders });
        setMapModalState((prev) => ({ ...prev, isOpen: false }));
        showToast('تم تحديد وتأكيد موقع العميل على الخريطة.');
      },
    });
  };

  // 5. Toggle order exclusion from route
  const handleToggleExcludeOrder = async (order: DeliveryOrder) => {
    if (!currentDay) return;
    const willExclude = !order.excludedFromRoute;
    const nextOrders = recalculateOrdersLocationStatus(
      currentDay.orders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              excludedFromRoute: willExclude,
              exclusionReason: willExclude
                ? `تم استبعاده بواسطة المستخدم (${o.locationStatus})`
                : undefined,
            }
          : o
      )
    );
    await updateDayRecord({ ...currentDay, orders: nextOrders });
  };

  // 6. Explicitly exclude all unconfirmed/invalid orders so user can calculate route for valid ones
  const handleExcludeAllInvalidOrders = async () => {
    if (!currentDay) return;
    const nextOrders = recalculateOrdersLocationStatus(
      currentDay.orders.map((o) => {
        if (o.excludedFromRoute || isOrderLocationReadyForRoute(o)) {
          return o;
        }
        return {
          ...o,
          excludedFromRoute: true,
          exclusionReason: `مستبعد لعدم اكتمال أو تأكيد الموقع (${o.locationStatus})`,
        };
      })
    );
    await updateDayRecord({ ...currentDay, orders: nextOrders });
    showToast('تم استبعاد الأوردرات غير المؤكدة؛ يمكنك الآن حساب المسار للأوردرات الصحيحة.');
  };

  // 7. Delete order after confirmation
  const handleDeleteOrderRequest = (order: DeliveryOrder) => {
    setConfirmModalState({
      isOpen: true,
      title: 'تأكيد حذف الأوردر',
      message: `هل أنت متأكد من حذف أوردر العميل "${
        order.customerName || 'بدون اسم'
      }"؟ لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'نعم، احذف الأوردر',
      variant: 'danger',
      onConfirm: async () => {
        if (!currentDay) return;
        const remaining = recalculateOrdersLocationStatus(
          currentDay.orders.filter((o) => o.id !== order.id)
        );
        await updateDayRecord({ ...currentDay, orders: remaining });
        setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        showToast('تم حذف الأوردر.');
      },
    });
  };

  // 8. Pick Starting Point on Map
  const handleOpenStartPointMap = () => {
    if (!currentDay) return;
    setMapModalState({
      isOpen: true,
      title: 'تحديد نقطة بداية التوصيل على الخريطة',
      subtitle: 'اضغط على المكان الذي ستبدأ رحلة التوصيل منه (نقطة البداية لا تدخل ضمن عدد العملاء)',
      initialCoordinates: currentDay.startPoint?.coordinates || null,
      initialSearchQuery: '',
      onConfirm: async (coords, label) => {
        const newStartPoint: StartPoint = {
          coordinates: coords,
          label: label ? `نقطة محددة: ${label.slice(0, 45)}` : 'نقطة بداية محددة على الخريطة',
          source: 'manual',
          confirmedAt: new Date().toISOString(),
        };
        await updateDayRecord({ ...currentDay, startPoint: newStartPoint });
        setMapModalState((prev) => ({ ...prev, isOpen: false }));
        showToast('تم اعتماد نقطة بداية التوصيل.');
      },
    });
  };

  // 9. Calculate Optimized Road Route
  const executeRouteCalculation = async () => {
    if (!currentDay || !currentDay.startPoint) return;
    setIsCalculatingRoute(true);
    setRouteError(null);
    try {
      const route = await calculateOptimizedRoadRoute(
        currentDay.startPoint,
        currentDay.orders
      );
      await updateDayRecord({
        ...currentDay,
        calculatedRoute: route,
      });
      setIsCalculatingRoute(false);
      setActiveTab('route');
      showToast('تم حساب أفضل خط سير على شبكة الطرق الفعلية بنجاح!');
    } catch (err) {
      setIsCalculatingRoute(false);
      setRouteError(
        err instanceof Error
          ? err.message
          : 'فشل حساب المسار عبر خدمة التوجيه. يرجى المحاولة مرة أخرى.'
      );
    }
  };

  const handleRequestRecalculateRoute = () => {
    setConfirmModalState({
      isOpen: true,
      title: 'تأكيد إعادة حساب خط السير',
      message:
        'هل ترغب في إعادة حساب خط السير الآن؟ يرجى ملاحظة أن ترتيب زيارة العملاء قد يتغير بناءً على الحساب الجديد.',
      confirmLabel: 'نعم، أعد حساب المسار',
      variant: 'warning',
      onConfirm: () => {
        setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        executeRouteCalculation();
      },
    });
  };

  // 10. Mark Order Delivered & Persist Immediately
  const handleMarkOrderDelivered = async (orderId: string, delivered: boolean) => {
    if (!currentDay) return;
    const nextOrders = currentDay.orders.map((o) =>
      o.id === orderId
        ? {
            ...o,
            deliveryStatus: (delivered ? 'تم التسليم' : 'قيد الانتظار') as DeliveryOrder['deliveryStatus'],
            deliveredAt: delivered ? new Date().toISOString() : undefined,
          }
        : o
    );
    await updateDayRecord({ ...currentDay, orders: nextOrders });
    showToast(delivered ? 'تم تسجيل تسليم الأوردر وحفظ الحالة.' : 'تمت إعادة الأوردر إلى قيد الانتظار.');
  };

  // 11. Start New Day (with Confirmation)
  const handleRequestStartNewDay = () => {
    setConfirmModalState({
      isOpen: true,
      title: 'بدء يوم عمل جديد',
      message:
        'هل تريد بدء يوم جديد؟ سيتم حفظ جميع أوردرات ومسار اليوم الحالي في «سجل الأيام السابقة» دون حذف أي بيانات، وفتح قائمة أوردرات جديدة لليوم الجديد.',
      confirmLabel: 'ابدأ يوم جديد الآن',
      variant: 'primary',
      onConfirm: async () => {
        setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        const activeDay = days.find((d) => d.id === activeDayId) || currentDay;
        if (!activeDay) return;
        const { archivedDay, newDay } = await startNewDayInDb(activeDay);
        setDays((prev) => [
          newDay,
          ...prev.map((d) => (d.id === archivedDay.id ? archivedDay : d)),
        ]);
        setActiveDayId(newDay.id);
        setViewingDayId(newDay.id);
        setActiveTab('input');
        showToast('تم حفظ اليوم السابق وبدء يوم جديد بنجاح.');
      },
    });
  };

  // 12. Export Backup JSON
  const handleExportBackup = () => {
    const payload: MessigoBackupFile = {
      app: 'Messigo',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeDayId,
      days,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `messigo-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('تم تنزيل ملف النسخة الاحتياطية بنجاح.');
  };

  // 13. Import Backup JSON
  const handleConfirmImportBackup = async (
    backup: MessigoBackupFile,
    mode: 'merge' | 'replace'
  ) => {
    const { days: restoredDays, activeDayId: restoredActiveId } =
      await restoreBackupToDb(backup, mode);
    setDays(restoredDays);
    setActiveDayId(restoredActiveId);
    setViewingDayId(restoredActiveId);
    showToast('تمت استعادة البيانات من النسخة الاحتياطية بنجاح.');
  };

  if (!isDbLoaded || !currentDay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-sky-600 text-white font-display font-extrabold text-xl flex items-center justify-center mx-auto">
            M
          </div>
          <p className="text-sm font-medium">جاري تحميل بيانات Messigo المحلية...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 pb-20 md:pb-10">
      {/* Top Bar Contract: 1-row, 3-zone header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark (single element) */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('input');
          }}
          className="text-xl font-extrabold tracking-tight text-sky-700 font-display whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <span className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center text-base font-extrabold">
            M
          </span>
          <span>Messigo</span>
        </a>

        {/* Zone 2: 5 Concise Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('input')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'input'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            إدخال الرسائل
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('review')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'review'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            مراجعة الأوردرات ({currentDay.orders.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('route')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'route'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            المسار والتوصيل
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'history'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            سجل الأيام ({days.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'backup'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            النسخ الاحتياطي
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleRequestStartNewDay}
            className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-2xs"
          >
            ابدأ يوم جديد
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="p-3.5 bg-slate-900 text-white rounded-xl shadow-lg flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white text-xs"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Active Day Context Subheader */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900">{currentDay.title}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{currentDay.dateKey}</span>
            <span aria-hidden="true">·</span>
            <span>
              الأوردرات المسجلة:{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {currentDay.orders.length}
              </strong>
            </span>
            {currentDay.calculatedRoute && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700 font-semibold">تم حساب خط السير</span>
              </>
            )}
          </div>

          {isViewingHistoricalDay && (
            <button
              type="button"
              onClick={() => {
                setViewingDayId(activeDayId);
                showToast('تمت العودة إلى اليوم الحالي النشط.');
              }}
              className="text-sky-700 font-bold hover:underline"
            >
              العودة إلى اليوم الحالي النشط ←
            </button>
          )}
        </div>

        {/* Active Screen View */}
        {activeTab === 'input' && (
          <WhatsappInputView
            rawText={currentDay.rawInputText}
            onChangeRawText={(text) =>
              updateDayRecord({ ...currentDay, rawInputText: text })
            }
            onAnalyzeOrders={handleAnalyzeOrders}
            onClearText={() => updateDayRecord({ ...currentDay, rawInputText: '' })}
            onOpenAddManualOrder={() =>
              setOrderFormModalState({ isOpen: true, order: null })
            }
            isAnalyzing={isAnalyzing}
            analyzingProgress={analyzingProgress}
            currentOrdersCount={currentDay.orders.length}
            onGoToReview={() => setActiveTab('review')}
          />
        )}

        {activeTab === 'review' && (
          <OrdersReviewView
            orders={currentDay.orders}
            startPoint={currentDay.startPoint}
            onUpdateStartPoint={(pt) =>
              updateDayRecord({ ...currentDay, startPoint: pt })
            }
            onOpenStartPointMap={handleOpenStartPointMap}
            onConfirmOrderLocation={handleConfirmOrderLocation}
            onEditOrder={(order) =>
              setOrderFormModalState({ isOpen: true, order })
            }
            onPickOrderLocationOnMap={handlePickOrderLocationOnMap}
            onToggleExcludeOrder={handleToggleExcludeOrder}
            onExcludeAllInvalidOrders={handleExcludeAllInvalidOrders}
            onDeleteOrderRequest={handleDeleteOrderRequest}
            onOpenAddManualOrder={() =>
              setOrderFormModalState({ isOpen: true, order: null })
            }
            onCalculateRoute={executeRouteCalculation}
            isCalculatingRoute={isCalculatingRoute}
            routeError={routeError}
          />
        )}

        {activeTab === 'route' && (
          <RouteAndDeliveryView
            orders={currentDay.orders}
            route={currentDay.calculatedRoute}
            isHistoricalDay={isViewingHistoricalDay}
            historicalDayTitle={currentDay.title}
            onMarkDelivered={handleMarkOrderDelivered}
            onRequestRecalculateRoute={handleRequestRecalculateRoute}
            onGoToReview={() => setActiveTab('review')}
            onReturnToActiveDay={() => setViewingDayId(activeDayId)}
          />
        )}

        {activeTab === 'history' && (
          <DaysHistoryView
            days={days}
            activeDayId={activeDayId}
            selectedViewingDayId={currentDay.id}
            onSelectDayToView={(dayId) => {
              setViewingDayId(dayId);
              const targetDay = days.find((d) => d.id === dayId);
              if (targetDay?.calculatedRoute) {
                setActiveTab('route');
              } else {
                setActiveTab('review');
              }
            }}
            onRequestStartNewDay={handleRequestStartNewDay}
          />
        )}

        {activeTab === 'backup' && (
          <BackupView
            days={days}
            activeDayId={activeDayId}
            onExportBackup={handleExportBackup}
            onConfirmImportBackup={handleConfirmImportBackup}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (Thumb-Zone Ergonomics) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center h-14 px-1">
        <button
          type="button"
          onClick={() => setActiveTab('input')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            activeTab === 'input' ? 'text-sky-600 font-bold' : 'text-slate-500'
          }`}
        >
          <MessageSquarePlus className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 whitespace-nowrap">إدخال</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            activeTab === 'review' ? 'text-sky-600 font-bold' : 'text-slate-500'
          }`}
        >
          <ClipboardList className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 whitespace-nowrap">
            المراجعة ({currentDay.orders.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('route')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            activeTab === 'route' ? 'text-sky-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Route className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 whitespace-nowrap">المسار</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            activeTab === 'history' ? 'text-sky-600 font-bold' : 'text-slate-500'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 whitespace-nowrap">الأيام</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('backup')}
          className={`flex flex-col items-center justify-center h-full transition-colors ${
            activeTab === 'backup' ? 'text-sky-600 font-bold' : 'text-slate-500'
          }`}
        >
          <Database className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 whitespace-nowrap">احتياطي</span>
        </button>
      </nav>

      {/* Modals */}
      <OrderFormModal
        isOpen={orderFormModalState.isOpen}
        initialOrder={orderFormModalState.order}
        onSave={handleSaveOrderFromModal}
        onClose={() => setOrderFormModalState({ isOpen: false, order: null })}
        onOpenMapPicker={(currentCoords, query, callback) => {
          setMapModalState({
            isOpen: true,
            title: 'تحديد موقع الأوردر على الخريطة',
            subtitle: 'ابحث عن المكان أو اضغط مباشرةً على الخريطة لتحديد الإحداثيات',
            initialCoordinates: currentCoords,
            initialSearchQuery: query,
            onConfirm: (coords, label) => {
              callback(coords, label);
              setMapModalState((prev) => ({ ...prev, isOpen: false }));
            },
          });
        }}
      />

      <InteractiveMapModal
        isOpen={mapModalState.isOpen}
        title={mapModalState.title}
        subtitle={mapModalState.subtitle}
        initialCoordinates={mapModalState.initialCoordinates}
        initialSearchQuery={mapModalState.initialSearchQuery}
        onConfirm={mapModalState.onConfirm}
        onClose={() => setMapModalState((prev) => ({ ...prev, isOpen: false }))}
      />

      <ConfirmModal
        isOpen={confirmModalState.isOpen}
        title={confirmModalState.title}
        message={confirmModalState.message}
        confirmLabel={confirmModalState.confirmLabel}
        variant={confirmModalState.variant}
        onConfirm={confirmModalState.onConfirm}
        onCancel={() => setConfirmModalState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
