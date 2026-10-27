import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Check, Compass, MapPin, Search, X } from 'lucide-react';
import { Coordinates } from '../types/messigo';
import { GeocodingSearchResult, searchPlaceNominatim } from '../services/geocodingService';
import { isValidCoordinates, normalizeDigits } from '../services/whatsappParser';

interface InteractiveMapModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  initialCoordinates: Coordinates | null;
  initialSearchQuery?: string;
  onConfirm: (coords: Coordinates, label?: string) => void;
  onClose: () => void;
}

// Default Cairo center if no coordinates are set yet
const DEFAULT_CAIRO_CENTER: Coordinates = { lat: 30.0444, lng: 31.2357 };

export const InteractiveMapModal: React.FC<InteractiveMapModalProps> = ({
  isOpen,
  title,
  subtitle,
  initialCoordinates,
  initialSearchQuery = '',
  onConfirm,
  onClose,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<Coordinates | null>(initialCoordinates);
  const [selectedLabel, setSelectedLabel] = useState<string>(initialSearchQuery);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [searchResults, setSearchResults] = useState<GeocodingSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [manualLat, setManualLat] = useState<string>(
    initialCoordinates ? String(initialCoordinates.lat) : ''
  );
  const [manualLng, setManualLng] = useState<string>(
    initialCoordinates ? String(initialCoordinates.lng) : ''
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedCoords(initialCoordinates);
      setSelectedLabel(initialSearchQuery || '');
      setSearchQuery(initialSearchQuery || '');
      setManualLat(initialCoordinates ? String(initialCoordinates.lat) : '');
      setManualLng(initialCoordinates ? String(initialCoordinates.lng) : '');
      setSearchResults([]);
      setErrorMsg(null);
    }
  }, [isOpen, initialCoordinates, initialSearchQuery]);

  const createPinIcon = () =>
    L.divIcon({
      className: 'messigo-pin',
      html: `<div style="width:36px;height:36px;border-radius:9999px;background:#0284c7;border:3px solid #ffffff;box-shadow:0 6px 16px rgba(2,132,199,0.45);display:flex;align-items:center;justify-content:center;color:#ffffff;font-weight:700;font-size:16px;">📍</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // Initialize Leaflet map
    const startCenter =
      initialCoordinates && isValidCoordinates(initialCoordinates.lat, initialCoordinates.lng)
        ? initialCoordinates
        : DEFAULT_CAIRO_CENTER;

    const map = L.map(mapContainerRef.current, {
      center: [startCenter.lat, startCenter.lng],
      zoom: initialCoordinates ? 15 : 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    if (initialCoordinates && isValidCoordinates(initialCoordinates.lat, initialCoordinates.lng)) {
      markerRef.current = L.marker([initialCoordinates.lat, initialCoordinates.lng], {
        icon: createPinIcon(),
        draggable: true,
      }).addTo(map);

      markerRef.current.on('dragend', () => {
        const pos = markerRef.current?.getLatLng();
        if (pos) {
          const rounded = {
            lat: Number(pos.lat.toFixed(6)),
            lng: Number(pos.lng.toFixed(6)),
          };
          setSelectedCoords(rounded);
          setManualLat(String(rounded.lat));
          setManualLng(String(rounded.lng));
          setErrorMsg(null);
        }
      });
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      const clicked: Coordinates = {
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6)),
      };
      setSelectedCoords(clicked);
      setManualLat(String(clicked.lat));
      setManualLng(String(clicked.lng));
      setErrorMsg(null);

      if (markerRef.current) {
        markerRef.current.setLatLng([clicked.lat, clicked.lng]);
      } else {
        markerRef.current = L.marker([clicked.lat, clicked.lng], {
          icon: createPinIcon(),
          draggable: true,
        }).addTo(map);

        markerRef.current.on('dragend', () => {
          const pos = markerRef.current?.getLatLng();
          if (pos) {
            const rounded = {
              lat: Number(pos.lat.toFixed(6)),
              lng: Number(pos.lng.toFixed(6)),
            };
            setSelectedCoords(rounded);
            setManualLat(String(rounded.lat));
            setManualLng(String(rounded.lng));
          }
        });
      }
    });

    mapInstanceRef.current = map;

    // Ensure proper Leaflet sizing inside modal
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  }, [isOpen]);

  const moveMapToCoordinates = (coords: Coordinates, label?: string) => {
    setSelectedCoords(coords);
    setManualLat(String(coords.lat));
    setManualLng(String(coords.lng));
    if (label) setSelectedLabel(label);
    setErrorMsg(null);

    const map = mapInstanceRef.current;
    if (map) {
      map.setView([coords.lat, coords.lng], 16);
      if (markerRef.current) {
        markerRef.current.setLatLng([coords.lat, coords.lng]);
      } else {
        markerRef.current = L.marker([coords.lat, coords.lng], {
          icon: createPinIcon(),
          draggable: true,
        }).addTo(map);
      }
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setErrorMsg(null);
    const results = await searchPlaceNominatim(searchQuery);
    setIsSearching(false);
    setSearchResults(results);
    if (results.length === 0) {
      setErrorMsg('لم يتم العثور على نتائج مطابقة في البحث. يمكنك الضغط مباشرةً على المكان المطلوب في الخريطة.');
    } else {
      moveMapToCoordinates({ lat: results[0].lat, lng: results[0].lng }, results[0].displayName);
    }
  };

  const handleApplyManualCoords = () => {
    const lat = parseFloat(normalizeDigits(manualLat));
    const lng = parseFloat(normalizeDigits(manualLng));
    if (!isValidCoordinates(lat, lng)) {
      setErrorMsg('الإحداثيات المدخلة غير صحيحة. يجب أن يكون خط العرض بين -90 و 90 وخط الطول بين -180 و 180.');
      return;
    }
    moveMapToCoordinates({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  };

  const handleUseBrowserGps = () => {
    if (!navigator.geolocation) {
      setErrorMsg('خدمة تحديد الموقع غير مدعومة في هذا المتصفح.');
      return;
    }
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        moveMapToCoordinates(coords, 'موقعي الحالي (GPS)');
      },
      () => {
        setErrorMsg('تعذر الحصول على الموقع الحالي من المتصفح. يمكنك الضغط على الخريطة لتحديده يدويًا.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSave = () => {
    if (!selectedCoords || !isValidCoordinates(selectedCoords.lat, selectedCoords.lng)) {
      setErrorMsg('يرجى الضغط على الخريطة لاختيار موقع صالح أولًا.');
      return;
    }
    onConfirm(selectedCoords, selectedLabel || searchQuery || undefined);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-600 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors"
            aria-label="إغلاق الخريطة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Controls */}
        <div className="p-4 border-b border-slate-200 space-y-3 overflow-y-auto">
          <form onSubmit={handleSearch} className="flex flex-wrap sm:flex-nowrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن عنوان أو معلم (مثال: النادي الأهلي مدينة نصر)..."
                className="w-full min-h-[44px] pl-3 pr-10 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-sky-600 focus:bg-white"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {isSearching ? 'جاري البحث...' : 'بحث في الخريطة'}
            </button>
            <button
              type="button"
              onClick={handleUseBrowserGps}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Compass className="w-4 h-4 text-sky-600" />
              <span>موقعي الحالي</span>
            </button>
          </form>

          {/* Search Results List */}
          {searchResults.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 max-h-32 overflow-y-auto space-y-1">
              <p className="text-xs font-medium text-slate-500 px-2">نتائج البحث (اضغط للاختيار):</p>
              {searchResults.map((res, idx) => (
                <button
                  key={`${res.lat}-${res.lng}-${idx}`}
                  type="button"
                  onClick={() => moveMapToCoordinates({ lat: res.lat, lng: res.lng }, res.displayName)}
                  className="w-full text-right px-2.5 py-1.5 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-900 rounded-lg transition-colors flex items-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span className="truncate">{res.displayName}</span>
                </button>
              ))}
            </div>
          )}

          {/* Direct Coordinate Entry */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-medium text-slate-600">إدخال الإحداثيات يدويًا:</span>
            <input
              type="text"
              dir="ltr"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="خط العرض (Lat) مثال: 30.0712"
              className="w-40 min-h-[38px] px-2.5 py-1 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
            <input
              type="text"
              dir="ltr"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              placeholder="خط الطول (Lng) مثال: 31.3521"
              className="w-40 min-h-[38px] px-2.5 py-1 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
            <button
              type="button"
              onClick={handleApplyManualCoords}
              className="min-h-[38px] px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              تطبيق الإحداثيات
            </button>
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Map Viewport */}
        <div className="relative flex-1 min-h-[300px] sm:min-h-[360px] bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-[320px] sm:h-[360px]" />
          <div className="absolute bottom-3 right-3 z-[400] bg-white/95 backdrop-blur-xs border border-slate-200 rounded-xl px-3 py-2 shadow-sm text-xs text-slate-700 pointer-events-none">
            اضغط في أي مكان على الخريطة أو اسحب العلامة الزرقاء لتحديد الموقع بدقة
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-600">
            {selectedCoords ? (
              <span>
                الإحداثيات المختارة:{' '}
                <strong className="font-mono tabular-nums text-slate-900" dir="ltr">
                  {selectedCoords.lat.toFixed(6)}, {selectedCoords.lng.toFixed(6)}
                </strong>
              </span>
            ) : (
              <span className="text-amber-700 font-medium">لم يتم اختيار نقطة على الخريطة بعد</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Check className="w-4 h-4" />
              <span>تأكيد واعتماد الموقع</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
