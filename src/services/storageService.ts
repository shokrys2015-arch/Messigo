import { openDB, IDBPDatabase } from 'idb';
import { DayRecord, MessigoBackupFile } from '../types/messigo';
import { isValidCoordinates } from './whatsappParser';

const DB_NAME = 'messigo_delivery_db';
const DB_VERSION = 1;
const DAYS_STORE = 'days';
const META_STORE = 'meta';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DAYS_STORE)) {
          db.createObjectStore(DAYS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export function formatArabicDateTitle(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

export function createBlankDayRecord(customTitle?: string): DayRecord {
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  return {
    id: `day_${now.getTime()}_${Math.random().toString(36).substring(2, 7)}`,
    dateKey,
    title: customTitle || `أوردرات ${formatArabicDateTitle(now)}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    rawInputText: '',
    orders: [],
    startPoint: null,
    calculatedRoute: null,
    isArchived: false,
  };
}

export async function loadAllDaysAndActiveId(): Promise<{
  days: DayRecord[];
  activeDayId: string;
}> {
  const db = await getDb();
  const allDays: DayRecord[] = await db.getAll(DAYS_STORE);
  let activeDayId: string | undefined = await db.get(META_STORE, 'activeDayId');

  if (allDays.length === 0) {
    const initialDay = createBlankDayRecord();
    await db.put(DAYS_STORE, initialDay);
    await db.put(META_STORE, initialDay.id, 'activeDayId');
    return { days: [initialDay], activeDayId: initialDay.id };
  }

  // Sort newest first
  allDays.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!activeDayId || !allDays.some((d) => d.id === activeDayId)) {
    activeDayId = allDays[0].id;
    await db.put(META_STORE, activeDayId, 'activeDayId');
  }

  return { days: allDays, activeDayId };
}

export async function saveDayRecord(day: DayRecord): Promise<void> {
  const db = await getDb();
  const updated: DayRecord = {
    ...day,
    updatedAt: new Date().toISOString(),
  };
  await db.put(DAYS_STORE, updated);
}

export async function setActiveDayIdInDb(dayId: string): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, dayId, 'activeDayId');
}

export async function startNewDayInDb(
  currentDay: DayRecord,
  newDayTitle?: string
): Promise<{ archivedDay: DayRecord; newDay: DayRecord }> {
  const db = await getDb();
  const archivedDay: DayRecord = {
    ...currentDay,
    isArchived: true,
    updatedAt: new Date().toISOString(),
  };
  const newDay = createBlankDayRecord(newDayTitle);

  const tx = db.transaction([DAYS_STORE, META_STORE], 'readwrite');
  await tx.objectStore(DAYS_STORE).put(archivedDay);
  await tx.objectStore(DAYS_STORE).put(newDay);
  await tx.objectStore(META_STORE).put(newDay.id, 'activeDayId');
  await tx.done;

  return { archivedDay, newDay };
}

/**
 * Validates an imported JSON backup file thoroughly before allowing restore.
 */
export function validateBackupJson(rawJson: unknown): MessigoBackupFile {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح (ليس كائن JSON صحيح).');
  }

  const candidate = rawJson as Partial<MessigoBackupFile>;
  if (candidate.app !== 'Messigo' || !Array.isArray(candidate.days)) {
    throw new Error('هذا الملف لا يبدو كنسخة احتياطية صالحة من تطبيق Messigo.');
  }

  if (candidate.days.length === 0) {
    throw new Error('ملف النسخة الاحتياطية فارغ ولا يحتوي على أي سجلات أيام.');
  }

  for (const day of candidate.days) {
    if (!day || typeof day.id !== 'string' || !Array.isArray(day.orders)) {
      throw new Error('توجد بيانات يوم تالفة أو غير مكتملة داخل ملف النسخة الاحتياطية.');
    }
    for (const order of day.orders) {
      if (!order || typeof order.id !== 'string') {
        throw new Error('توجد بيانات أوردر غير صالحة داخل ملف النسخة الاحتياطية.');
      }
      if (order.coordinates !== null && order.coordinates !== undefined) {
        if (
          typeof order.coordinates.lat !== 'number' ||
          typeof order.coordinates.lng !== 'number' ||
          !isValidCoordinates(order.coordinates.lat, order.coordinates.lng)
        ) {
          throw new Error(
            `الأوردر الخاص بالعميل "${order.customerName || order.id}" يحتوي على إحداثيات غير صالحة في الملف المستورد.`
          );
        }
      }
    }
  }

  return {
    app: 'Messigo',
    version: candidate.version || 1,
    exportedAt: candidate.exportedAt || new Date().toISOString(),
    activeDayId: candidate.activeDayId || candidate.days[0].id,
    days: candidate.days,
  };
}

export async function restoreBackupToDb(
  backup: MessigoBackupFile,
  mode: 'replace' | 'merge'
): Promise<{ days: DayRecord[]; activeDayId: string }> {
  const db = await getDb();
  const tx = db.transaction([DAYS_STORE, META_STORE], 'readwrite');
  const daysStore = tx.objectStore(DAYS_STORE);
  const metaStore = tx.objectStore(META_STORE);

  if (mode === 'replace') {
    await daysStore.clear();
    for (const day of backup.days) {
      await daysStore.put(day);
    }
    await metaStore.put(backup.activeDayId, 'activeDayId');
  } else {
    // Merge mode: preserve existing days and merge orders/days by ID
    const existingDays: DayRecord[] = await daysStore.getAll();
    const existingMap = new Map(existingDays.map((d) => [d.id, d]));

    for (const importedDay of backup.days) {
      const existing = existingMap.get(importedDay.id);
      if (!existing) {
        await daysStore.put(importedDay);
      } else {
        // Merge orders inside the same day without losing any order
        const orderMap = new Map(existing.orders.map((o) => [o.id, o]));
        for (const impOrder of importedDay.orders) {
          orderMap.set(impOrder.id, impOrder);
        }
        const mergedDay: DayRecord = {
          ...existing,
          ...importedDay,
          orders: Array.from(orderMap.values()),
          updatedAt: new Date().toISOString(),
        };
        await daysStore.put(mergedDay);
      }
    }
  }

  await tx.done;
  return loadAllDaysAndActiveId();
}
