export type LocationStatus =
  | 'الموقع صحيح'
  | 'الموقع غير موجود'
  | 'الإحداثيات غير صحيحة'
  | 'يحتاج إلى مراجعة'
  | 'يوجد أوردر آخر في نفس الموقع';

export type DeliveryStatus = 'قيد الانتظار' | 'تم التسليم';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DeliveryOrder {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  locationText: string;
  mapUrl: string;
  searchQueryFromUrl?: string;
  coordinates: Coordinates | null;
  geocodedDisplayName?: string;
  locationConfirmedByUser: boolean;
  locationStatus: LocationStatus;
  reviewNote?: string;
  hasDuplicateLocation?: boolean;
  duplicateWithNames?: string[];
  orderDetails: string;
  totalPrice: string;
  rawMessage: string;
  deliveryStatus: DeliveryStatus;
  deliveredAt?: string;
  excludedFromRoute: boolean;
  exclusionReason?: string;
  createdAt: string;
}

export interface StartPoint {
  coordinates: Coordinates;
  label: string;
  source: 'gps' | 'manual';
  confirmedAt: string;
}

export interface RouteLegInfo {
  orderId: string;
  visitNumber: number;
  distanceMeters: number; // Road distance from previous stop
  durationSeconds: number; // Estimated road driving time from previous stop
  cumulativeDistanceMeters: number;
  cumulativeDurationSeconds: number;
}

export interface CalculatedRoute {
  calculatedAt: string;
  startPoint: StartPoint;
  orderedOrderIds: string[];
  legs: RouteLegInfo[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  geometry: [number, number][]; // Array of [lat, lng] road coordinates
  algorithmUsed: 'exact-open-tsp' | 'heuristic-2opt-open-tsp';
  algorithmNote: string;
  excludedOrderSummary: Array<{
    orderId: string;
    customerName: string;
    reason: string;
  }>;
}

export interface DayRecord {
  id: string;
  dateKey: string; // YYYY-MM-DD
  title: string;
  courierName?: string; // اسم المندوب
  createdAt: string;
  updatedAt: string;
  rawInputText: string;
  orders: DeliveryOrder[];
  startPoint: StartPoint | null;
  calculatedRoute: CalculatedRoute | null;
  isArchived: boolean;
}

export interface MessigoBackupFile {
  app: 'Messigo';
  version: number;
  exportedAt: string;
  activeDayId: string;
  days: DayRecord[];
}
