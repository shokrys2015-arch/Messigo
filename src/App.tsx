/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Database,
  Edit2,
  FileText,
  History,
  MessageSquarePlus,
  Plus,
  Printer,
  Route,
  User,
  X,
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
  createBlankDayRecord,
  deleteDayRecordFromDb,
  formatArabicDateTitle,
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
import { RoutePdfModal } from './components/RoutePdfModal';
import { ShareRouteModal } from './components/ShareRouteModal';
import { decodeShareableRoute, fetchSharedRoute } from './services/shareService';

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

  // PDF Export Modal State
  const [pdfModalState, setPdfModalState] = useState<{
    isOpen: boolean;
    day: DayRecord | null;
  }>({ isOpen: false, day: null });

  // Share Route Modal State
  const [shareModalState, setShareModalState] = useState<{
    isOpen: boolean;
    day: DayRecord | null;
  }>({ isOpen: false, day: null });

  // Create New Order / Batch Modal State
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [newOrderTitleInput, setNewOrderTitleInput] = useState('');
  const [newOrderCourierInput, setNewOrderCourierInput] = useState('');

  // Rename Day / Batch Modal State
  const [renameModalState, setRenameModalState] = useState<{
    isOpen: boolean;
    dayId: string;
    title: string;
  }>({ isOpen: false, dayId: '', title: '' });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Load initial data from IndexedDB and handle shared delivery route deep link
  useEffect(() => {
    let mounted = true;
    loadAllDaysAndActiveId()
      .then(async ({ days: loadedDays, activeDayId: loadedActiveId }) => {
        if (!mounted) return;

        let allDays = loadedDays;
        let activeId = loadedActiveId;
        let viewingId = loadedActiveId;
        let shouldOpenRouteTab = false;

        // Check if opened with a short route link (?r=... or #r=... or /r/...)
        const urlParams = new URLSearchParams(window.location.search);
        let shortRouteId = urlParams.get('r');
        if (!shortRouteId && window.location.hash) {
          const hashMatch = window.location.hash.match(/[#&?]r=([a-zA-Z0-9_-]+)/);
          if (hashMatch && hashMatch[1]) {
            shortRouteId = hashMatch[1];
          }
        }
        if (!shortRouteId && window.location.pathname.startsWith('/r/')) {
          const pathMatch = window.location.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)/);
          if (pathMatch && pathMatch[1]) {
            shortRouteId = pathMatch[1];
          }
        }

        if (shortRouteId) {
          try {
            const fetchedDay = await fetchSharedRoute(shortRouteId);
            if (fetchedDay) {
              const exists = allDays.some((d) => d.id === fetchedDay.id);
              allDays = exists
                ? allDays.map((d) => (d.id === fetchedDay.id ? fetchedDay : d))
                : [fetchedDay, ...allDays];

              await saveDayRecord(fetchedDay);
              activeId = fetchedDay.id;
              viewingId = fetchedDay.id;
              shouldOpenRouteTab = true;

              try {
                window.history.replaceState(null, '', '/');
              } catch {
                // ignore
              }

              setTimeout(() => {
                showToast(
                  `🚚 تم فتح مسار التوصيل: "${fetchedDay.title}" للمندوب: ${
                    fetchedDay.courierName || 'المندوب'
                  } بنجاح`
                );
              }, 300);
            }
          } catch (err) {
            console.error('Failed to load shared route from short ID:', err);
          }
        } else {
          // Check if opened with legacy shared route link (#share_route=... or ?share_route=...)
          const rawHashOrSearch = window.location.hash || window.location.search;
          if (rawHashOrSearch.includes('share_route=')) {
            const sharedDay = decodeShareableRoute(rawHashOrSearch);
            if (sharedDay) {
              const exists = allDays.some((d) => d.id === sharedDay.id);
              allDays = exists
                ? allDays.map((d) => (d.id === sharedDay.id ? sharedDay : d))
                : [sharedDay, ...allDays];

              await saveDayRecord(sharedDay);
              activeId = sharedDay.id;
              viewingId = sharedDay.id;
              shouldOpenRouteTab = true;

              try {
                window.history.replaceState(null, '', window.location.pathname);
              } catch {
                // ignore
              }

              setTimeout(() => {
                showToast(
                  `🚚 تم فتح مسار التوصيل: "${sharedDay.title}" للمندوب: ${
                    sharedDay.courierName || 'المندوب'
                  } بنجاح`
                );
              }, 300);
            }
          }
        }

        setDays(allDays);
        setActiveDayId(activeId);
        setViewingDayId(viewingId);
        if (shouldOpenRouteTab) {
          setActiveTab('route');
        }
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

  // Listen to hashchange or popstate if user clicks a shared link while app is already open
  useEffect(() => {
    const handleUrlChange = async () => {
      // Check for short code first (?r=... or #r=... or /r/...)
      const searchParams = new URLSearchParams(window.location.search);
      let shortCode = searchParams.get('r');
      if (!shortCode && window.location.hash) {
        const match = window.location.hash.match(/[#&?]r=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shortCode = match[1];
        }
      }
      if (!shortCode && window.location.pathname.startsWith('/r/')) {
        const match = window.location.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shortCode = match[1];
        }
      }

      if (shortCode) {
        try {
          const fetchedDay = await fetchSharedRoute(shortCode);
          if (fetchedDay) {
            setDays((prev) => {
              const exists = prev.some((d) => d.id === fetchedDay.id);
              return exists
                ? prev.map((d) => (d.id === fetchedDay.id ? fetchedDay : d))
                : [fetchedDay, ...prev];
            });
            await saveDayRecord(fetchedDay);
            setActiveDayId(fetchedDay.id);
            setViewingDayId(fetchedDay.id);
            setActiveTab('route');
            showToast(
              `🚚 تم فتح مسار التوصيل: "${fetchedDay.title}" للمندوب: ${
                fetchedDay.courierName || 'المندوب'
              }`
            );
            try {
              window.history.replaceState(null, '', '/');
            } catch {
              // ignore
            }
            return;
          }
        } catch (err) {
          console.error('Failed to resolve short route URL on navigation:', err);
        }
      }

      // Legacy hash fallback
      const hash = window.location.hash;
      if (hash.includes('share_route=')) {
        const sharedDay = decodeShareableRoute(hash);
        if (sharedDay) {
          setDays((prev) => {
            const exists = prev.some((d) => d.id === sharedDay.id);
            return exists
              ? prev.map((d) => (d.id === sharedDay.id ? sharedDay : d))
              : [sharedDay, ...prev];
          });
          await saveDayRecord(sharedDay);
          setActiveDayId(sharedDay.id);
          setViewingDayId(sharedDay.id);
          setActiveTab('route');
          showToast(
            `🚚 تم فتح مسار التوصيل: "${sharedDay.title}" للمندوب: ${
              sharedDay.courierName || 'المندوب'
            }`
          );
          try {
            window.history.replaceState(null, '', window.location.pathname);
          } catch {
            // ignore
          }
        }
      }
    };

    window.addEventListener('hashchange', handleUrlChange);
    window.addEventListener('popstate', handleUrlChange);
    return () => {
      window.removeEventListener('hashchange', handleUrlChange);
      window.removeEventListener('popstate', handleUrlChange);
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

  // 11. PDF Export Modal Trigger
  const handleOpenPdfExport = (targetDay?: DayRecord) => {
    const dayToExport = targetDay || currentDay;
    if (!dayToExport) return;
    setPdfModalState({ isOpen: true, day: dayToExport });
  };

  // 12. Create New Order / Batch (عمل أوردر جديد)
  const handleOpenNewOrderModal = () => {
    const suggestedTitle = `أوردرات ${formatArabicDateTitle(new Date())}`;
    setNewOrderTitleInput(suggestedTitle);
    setNewOrderCourierInput('');
    setIsNewOrderModalOpen(true);
  };

  const handleConfirmCreateNewOrder = async () => {
    const activeDay = days.find((d) => d.id === activeDayId) || currentDay;
    if (!activeDay) return;

    const chosenTitle = newOrderTitleInput.trim() || undefined;
    const chosenCourier = newOrderCourierInput.trim() || undefined;
    const { archivedDay, newDay } = await startNewDayInDb(activeDay, chosenTitle, chosenCourier);
    setDays((prev) => [
      newDay,
      ...prev.map((d) => (d.id === archivedDay.id ? archivedDay : d)),
    ]);
    setActiveDayId(newDay.id);
    setViewingDayId(newDay.id);
    setIsNewOrderModalOpen(false);
    setActiveTab('input');
    showToast(`تم إنشاء «${newDay.title}» وبدء قائمة أوردرات جديدة.`);
  };

  // 13. Rename Day / Order Batch
  const handleOpenRenameModal = (dayId: string, currentTitle: string) => {
    setRenameModalState({
      isOpen: true,
      dayId,
      title: currentTitle,
    });
  };

  const handleConfirmRename = async () => {
    if (!renameModalState.dayId || !renameModalState.title.trim()) return;
    const targetDay = days.find((d) => d.id === renameModalState.dayId);
    if (!targetDay) return;

    const updatedDay: DayRecord = {
      ...targetDay,
      title: renameModalState.title.trim(),
    };
    await updateDayRecord(updatedDay);
    setRenameModalState({ isOpen: false, dayId: '', title: '' });
    showToast('تم تعديل مسمى الأوردر بنجاح.');
  };

  // 14. Update Courier Name for a Day Record
  const handleUpdateCourierName = async (dayId: string, courierName: string) => {
    const targetDay = days.find((d) => d.id === dayId);
    if (!targetDay) return;

    const updatedDay: DayRecord = {
      ...targetDay,
      courierName: courierName.trim() || undefined,
    };
    await updateDayRecord(updatedDay);
    showToast(courierName.trim() ? `تم حفظ اسم المندوب: ${courierName.trim()}` : 'تم إزالة اسم المندوب.');
  };

  // 15. Delete Entire Day Record (حذف السجل بالكامل)
  const handleDeleteEntireDay = (dayId: string, dayTitle: string) => {
    setConfirmModalState({
      isOpen: true,
      title: 'تأكيد حذف السجل بالكامل',
      message: `هل أنت متأكد من مسح سجل «${dayTitle}» بالكامل بما يحتويه من أوردرات وبيانات؟ لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'نعم، احذف السجل بالكامل',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        await deleteDayRecordFromDb(dayId);

        const remainingDays = days.filter((d) => d.id !== dayId);
        if (remainingDays.length === 0) {
          const brandNewDay = createBlankDayRecord();
          await saveDayRecord(brandNewDay);
          setDays([brandNewDay]);
          setActiveDayId(brandNewDay.id);
          setViewingDayId(brandNewDay.id);
        } else {
          setDays(remainingDays);
          if (activeDayId === dayId) {
            setActiveDayId(remainingDays[0].id);
          }
          if (viewingDayId === dayId) {
            setViewingDayId(remainingDays[0].id);
          }
        }
        showToast(`تم حذف سجل «${dayTitle}» بالكامل.`);
      },
    });
  };

  // 16. Delete single order from historical or active day
  const handleDeleteOrderFromDay = (
    dayId: string,
    orderId: string,
    customerName: string
  ) => {
    setConfirmModalState({
      isOpen: true,
      title: 'تأكيد حذف الأوردر',
      message: `هل أنت متأكد من حذف أوردر العميل «${
        customerName || 'بدون اسم'
      }» من سجل هذا اليوم؟ لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'نعم، احذف الأوردر',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        const targetDay = days.find((d) => d.id === dayId);
        if (!targetDay) return;

        const remainingOrders = recalculateOrdersLocationStatus(
          targetDay.orders.filter((o) => o.id !== orderId)
        );
        const updatedDay: DayRecord = {
          ...targetDay,
          orders: remainingOrders,
        };
        await updateDayRecord(updatedDay);
        showToast('تم حذف الأوردر من سجل اليوم بنجاح.');
      },
    });
  };

  // 15. Export Backup JSON
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
            سجل الأوردرات ({days.length})
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
            onClick={handleOpenNewOrderModal}
            className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-2xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>عمل أوردر جديد</span>
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
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900 text-sm sm:text-base">{currentDay.title}</span>
              <button
                type="button"
                onClick={() => handleOpenRenameModal(currentDay.id, currentDay.title)}
                title="تعديل اسم الأوردر"
                className="p-1 text-slate-400 hover:text-sky-600 rounded hover:bg-slate-100 transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{currentDay.dateKey}</span>

            {/* Courier Name Tab/Badge in Context Subheader */}
            <span aria-hidden="true">·</span>
            {currentDay.courierName?.trim() ? (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md font-bold">
                <User className="w-3 h-3 text-amber-700" />
                <span>المندوب: {currentDay.courierName.trim()}</span>
                <button
                  type="button"
                  onClick={() => {
                    const val = window.prompt('تعديل اسم المندوب لهذا الأوردر:', currentDay.courierName || '');
                    if (val !== null) handleUpdateCourierName(currentDay.id, val);
                  }}
                  className="p-0.5 hover:text-amber-950 transition-colors"
                  title="تعديل اسم المندوب"
                >
                  <Edit2 className="w-2.5 h-2.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const val = window.prompt('أدخل اسم المندوب لهذا الأوردر:');
                  if (val !== null && val.trim()) handleUpdateCourierName(currentDay.id, val.trim());
                }}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-amber-800 hover:bg-amber-50 border border-dashed border-slate-300 rounded px-2 py-0.5 transition-colors"
                title="إضافة اسم المندوب لهذا الأوردر"
              >
                <User className="w-3 h-3" />
                <span>+ إضافة اسم المندوب</span>
              </button>
            )}

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

          <div className="flex items-center gap-2">
            {isViewingHistoricalDay && (
              <button
                type="button"
                onClick={() => {
                  setViewingDayId(activeDayId);
                  showToast('تمت العودة إلى اليوم الحالي النشط.');
                }}
                className="text-sky-700 font-bold hover:underline ml-2"
              >
                العودة إلى اليوم الحالي النشط ←
              </button>
            )}
          </div>
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
            onShareRoute={() => setShareModalState({ isOpen: true, day: currentDay })}
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
            onRequestStartNewDay={handleOpenNewOrderModal}
            onDeleteOrderFromDay={handleDeleteOrderFromDay}
            onDeleteEntireDay={handleDeleteEntireDay}
            onRenameDay={handleOpenRenameModal}
            onUpdateCourierName={handleUpdateCourierName}
            onExportDayPdf={(day) => handleOpenPdfExport(day)}
            onShareDay={(day) => setShareModalState({ isOpen: true, day })}
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
          <span className="text-[10px] mt-0.5 whitespace-nowrap">الأوردرات</span>
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

      {/* PDF Export Manifesto Modal */}
      <RoutePdfModal
        isOpen={pdfModalState.isOpen}
        onClose={() => setPdfModalState({ isOpen: false, day: null })}
        dayTitle={pdfModalState.day?.title || currentDay.title}
        dateKey={pdfModalState.day?.dateKey || currentDay.dateKey}
        courierName={pdfModalState.day?.courierName || currentDay.courierName}
        orders={pdfModalState.day?.orders || currentDay.orders}
        route={pdfModalState.day?.calculatedRoute || currentDay.calculatedRoute || null}
        onCopySuccess={(msg) => showToast(msg)}
      />

      {/* Share Delivery Route Modal (مشاركة مسار التوصيل مع المندوب) */}
      <ShareRouteModal
        isOpen={shareModalState.isOpen}
        onClose={() => setShareModalState({ isOpen: false, day: null })}
        day={shareModalState.day || currentDay}
        onOpenRouteView={(dayId) => {
          setViewingDayId(dayId);
          setActiveTab('route');
        }}
        onCopySuccess={(msg) => showToast(msg)}
      />

      {/* Create New Order / Batch Modal */}
      {isNewOrderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-sky-700">
                <Plus className="w-5 h-5" />
                <h3 className="font-extrabold text-base text-slate-900">عمل أوردر جديد</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewOrderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              سيتم حفظ جميع أوردرات اليوم الحالي بأمان في «سجل الأوردرات»، وبدء أوردر جديد يحمل تاريخ اليوم تلقائيًا مع إمكانية تعيين اسم المندوب.
            </p>

            {/* Order Title (Auto day/date with ability to edit) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                اسم الأوردر / الدفعة (تلقائي بالتاريخ):
              </label>
              <input
                type="text"
                value={newOrderTitleInput}
                onChange={(e) => setNewOrderTitleInput(e.target.value)}
                placeholder="أوردرات اليوم..."
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500 font-medium text-slate-800"
              />
            </div>

            {/* Courier Name Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-amber-600" />
                <span>اسم المندوب (اختياري):</span>
              </label>
              <input
                type="text"
                value={newOrderCourierInput}
                onChange={(e) => setNewOrderCourierInput(e.target.value)}
                placeholder="مثال: أحمد مصطفى أو الكابتن محمد"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500 font-medium text-slate-800"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmCreateNewOrder();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsNewOrderModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateNewOrder}
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-colors shadow-2xs"
              >
                إنشاء وبدء الأوردر
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-sky-700">
                <Edit2 className="w-5 h-5" />
                <h3 className="font-extrabold text-base text-slate-900">تعديل مسمى الأوردر</h3>
              </div>
              <button
                type="button"
                onClick={() => setRenameModalState({ isOpen: false, dayId: '', title: '' })}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                المسمى الجديد:
              </label>
              <input
                type="text"
                value={renameModalState.title}
                onChange={(e) =>
                  setRenameModalState((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="أدخل مسمى الأوردر الجديد..."
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium text-slate-800"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmRename();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRenameModalState({ isOpen: false, dayId: '', title: '' })}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmRename}
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-colors shadow-2xs"
              >
                حفظ التعديل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
