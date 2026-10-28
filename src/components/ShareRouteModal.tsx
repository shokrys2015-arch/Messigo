import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  MapPin,
  MessageCircle,
  Navigation,
  Route,
  Share2,
  User,
  X,
} from 'lucide-react';
import { DayRecord } from '../types/messigo';
import {
  buildWhatsappShareText,
  generateShareableRouteUrl,
} from '../services/shareService';
import { parsePriceToNumber } from './RoutePdfModal';
import { formatDistanceArabic } from '../services/routingService';

interface ShareRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: DayRecord | null;
  onOpenRouteView?: (dayId: string) => void;
  onCopySuccess?: (msg: string) => void;
}

export const ShareRouteModal: React.FC<ShareRouteModalProps> = ({
  isOpen,
  onClose,
  day,
  onOpenRouteView,
  onCopySuccess,
}) => {
  const [copied, setCopied] = useState(false);

  // Compute shareable URL and WhatsApp text
  const { shareUrl, whatsappText, totalPrice, deliveredOrders } = useMemo(() => {
    if (!day) {
      return {
        shareUrl: '',
        whatsappText: '',
        totalPrice: 0,
        deliveredOrders: 0,
      };
    }

    const url = generateShareableRouteUrl(day);
    const text = buildWhatsappShareText(day, url);
    const price = day.orders.reduce(
      (sum, o) => sum + parsePriceToNumber(o.totalPrice),
      0
    );
    const delivered = day.orders.filter(
      (o) => o.deliveryStatus === 'تم التسليم'
    ).length;

    return {
      shareUrl: url,
      whatsappText: text,
      totalPrice: price,
      deliveredOrders: delivered,
    };
  }, [day]);

  if (!isOpen || !day) return null;

  const totalOrders = day.orders.length;
  const hasNativeShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('textarea');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      if (onCopySuccess) {
        onCopySuccess('تم نسخ رابط مسار التوصيل بنجاح!');
      }
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Failed to copy share URL:', err);
    }
  };

  const handleOpenWhatsapp = () => {
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: `مسار توصيل: ${day.title}`,
        text: whatsappText,
        url: shareUrl,
      });
    } catch (err) {
      // User cancelled or share failed silently
      console.log('Share dismissed or failed', err);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/70 to-sky-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 id="share-modal-title" className="text-lg font-bold text-slate-900">
                مشاركة مسار التوصيل مع المندوب
              </h3>
              <p className="text-xs text-slate-600">
                رابط مباشر يفتح فوراً مسار التوصيل واللوكيشنز على هاتف المندوب
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Order Summary Card */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  الأوردر المختار
                </span>
                <h4 className="text-base font-bold text-slate-900">{day.title}</h4>
              </div>
              <span className="text-xs font-mono font-medium text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                {day.dateKey}
              </span>
            </div>

            {/* Courier info */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60">
              <span className="text-xs text-slate-600 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-amber-600" />
                <span>المندوب:</span>
                <strong className="text-slate-800">
                  {day.courierName?.trim() || 'لم يُحدد اسم مندوب'}
                </strong>
              </span>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-center">
              <div className="bg-white rounded-xl p-2 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">عدد الشحنات</div>
                <div className="text-base font-bold text-slate-900 font-mono">
                  {totalOrders}
                </div>
              </div>
              <div className="bg-white rounded-xl p-2 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">المطلوب تحصيله</div>
                <div className="text-sm font-bold text-emerald-700 font-mono">
                  {totalPrice > 0 ? `${totalPrice.toLocaleString('ar-EG')} ج.م` : 'غير محدد'}
                </div>
              </div>
              <div className="bg-white rounded-xl p-2 border border-slate-200/80">
                <div className="text-[11px] text-slate-500 font-medium">تم تسليمه</div>
                <div className="text-base font-bold text-sky-700 font-mono">
                  {deliveredOrders}/{totalOrders}
                </div>
              </div>
            </div>

            {day.calculatedRoute && (
              <div className="text-xs text-slate-600 flex items-center gap-1.5 pt-1">
                <Route className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>إجمالي المسافة المحسوبة:</span>
                <strong className="text-slate-800 font-mono">
                  {formatDistanceArabic(day.calculatedRoute.totalDistanceMeters)}
                </strong>
              </div>
            )}
          </div>

          {/* Feature Highlight Note */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5 text-xs text-emerald-900 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>كيف يفتح المندوب الرابط؟</strong>
              <br />
              عند الضغط على الرابط في واتساب، سيفتح للمندوب فوراً تبويب{' '}
              <span className="font-bold underline decoration-emerald-500">
                &quot;مسار التوصيل&quot;
              </span>{' '}
              جاهزاً بالترتيب، ومزوداً بزر ملاحة لكل عميل في Google Maps، وأرقام هواتف
              الاتصال، والمبالغ المطلوبة.
            </div>
          </div>

          {/* Primary Action 1: WhatsApp Share */}
          <button
            type="button"
            onClick={handleOpenWhatsapp}
            className="w-full min-h-[50px] py-3 px-4 rounded-2xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-md shadow-emerald-500/20 hover:shadow-lg transition-all active:scale-[0.99]"
          >
            <MessageCircle className="w-5 h-5 fill-white" />
            <span>إرسال عبر واتساب للمندوب</span>
          </button>

          {/* Primary Action 2: Copy Link */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              رابط المشاركة المباشر
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-600 truncate focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0 shadow-xs ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>تم النسخ!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>نسخ الرابط</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Action 3: Native Share (Mobile) */}
          {hasNativeShare && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="w-full min-h-[42px] py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <Share2 className="w-4 h-4 text-slate-600" />
              <span>مشاركة عبر تطبيقات أخرى (تليجرام، رسائل...)</span>
            </button>
          )}

          {/* Action 4: Open Delivery Route View in Current Session */}
          {onOpenRouteView && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRouteView(day.id);
                }}
                className="w-full min-h-[42px] py-2.5 px-4 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Navigation className="w-4 h-4 text-sky-700" />
                <span>فتح مسار التوصيل الآن في التطبيق</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
