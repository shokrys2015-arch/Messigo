import React from 'react';
import {
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  ClipboardPaste,
  CheckCircle2,
} from 'lucide-react';
import {
  EXACT_PROMPT_SAMPLE_MESSAGE,
  MULTI_ORDER_TEST_SAMPLE,
} from '../services/whatsappParser';

interface WhatsappInputViewProps {
  rawText: string;
  onChangeRawText: (text: string) => void;
  onAnalyzeOrders: () => void;
  onClearText: () => void;
  onOpenAddManualOrder: () => void;
  isAnalyzing: boolean;
  analyzingProgress: { current: number; total: number } | null;
  currentOrdersCount: number;
  onGoToReview: () => void;
}

export const WhatsappInputView: React.FC<WhatsappInputViewProps> = ({
  rawText,
  onChangeRawText,
  onAnalyzeOrders,
  onClearText,
  onOpenAddManualOrder,
  isAnalyzing,
  analyzingProgress,
  currentOrdersCount,
  onGoToReview,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Input Column */}
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">إدخال رسائل واتساب</h2>
            <p className="text-sm text-slate-600 mt-1">
              الصق رسائل الأوردرات المنسوخة من واتساب دفعة واحدة ليقوم Messigo باستخراج العملاء والعناوين والمواقع تلقائيًا.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeRawText(EXACT_PROMPT_SAMPLE_MESSAGE)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              إدراج المثال التجريبي
            </button>
            <button
              type="button"
              onClick={() => onChangeRawText(MULTI_ORDER_TEST_SAMPLE)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              إدراج مثال لعدة رسائل
            </button>
          </div>
        </div>

        <div className="relative">
          <textarea
            value={rawText}
            onChange={(e) => onChangeRawText(e.target.value)}
            rows={12}
            placeholder={`الصق رسائل واتساب هنا...\n\nمثال:\nالأستاذ محمود الخطيب\nت: 010000000000\nالنادي الأهلي – فرع مدينة نصر\n٤ تيشيرتات\nالإجمالي: ١٥٠٠ جنيه\nالموقع: النادي الأهلي – فرع مدينة نصر، القاهرة`}
            className="w-full p-4 text-sm sm:text-base text-slate-900 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-sky-600 focus:bg-white leading-relaxed resize-y font-sans"
          />
        </div>

        {/* Analyzing Progress Indicator */}
        {isAnalyzing && (
          <div className="mt-4 p-4 bg-sky-50 border border-sky-200 rounded-xl flex items-center gap-3 text-sky-900">
            <Loader2 className="w-5 h-5 text-sky-600 animate-spin shrink-0" />
            <div className="text-sm font-medium">
              {analyzingProgress
                ? `جاري التحقق من المواقع عبر خدمة الخرائط (${analyzingProgress.current} من ${analyzingProgress.total})...`
                : 'جاري تحليل الرسائل واستخراج بيانات العملاء والمواقع...'}
            </div>
          </div>
        )}

        {/* Primary Action Bar (Required 3 Buttons) */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isAnalyzing || !rawText.trim()}
            onClick={onAnalyzeOrders}
            className="min-h-[48px] px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm sm:text-base font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Sparkles className="w-4 h-4" />
            <span>تحليل الأوردرات</span>
          </button>

          <button
            type="button"
            disabled={isAnalyzing || !rawText.trim()}
            onClick={onClearText}
            className="min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-4 h-4 text-slate-500" />
            <span>مسح النص</span>
          </button>

          <button
            type="button"
            disabled={isAnalyzing}
            onClick={onOpenAddManualOrder}
            className="min-h-[48px] px-4 py-2.5 rounded-xl border border-sky-200 bg-sky-50/70 hover:bg-sky-100 text-sky-800 text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 mr-auto"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أوردر يدويًا</span>
          </button>
        </div>
      </div>

      {/* Side Instructions & Quick Status Column */}
      <div className="lg:col-span-4 space-y-5">
        {currentOrdersCount > 0 && (
          <div className="bg-white border border-sky-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-sm font-bold text-slate-900">الأوردرات المسجلة في يومك الحالي</span>
              <span className="text-xl font-extrabold font-mono tabular-nums text-sky-600">
                {currentOrdersCount}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              عند تحليل رسائل جديدة سيتم إضافتها إلى قائمة أوردرات اليوم الحالي دون فقدان الأوردرات السابقة.
            </p>
            <button
              type="button"
              onClick={onGoToReview}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
              <span>الانتقال إلى مراجعة الأوردرات ({currentOrdersCount})</span>
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <ClipboardPaste className="w-5 h-5 text-sky-600 shrink-0" />
            <h3 className="text-base font-bold text-slate-900">كيف يعمل تحليل الرسائل؟</h3>
          </div>

          <ul className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="font-mono font-bold text-sky-600 tabular-nums">1.</span>
              <span>
                <strong>فصل الرسائل تلقائيًا:</strong> يمكنك لصق رسالة واحدة أو عشرات الرسائل دفعة واحدة؛ يتعرف التطبيق على فواصل الرسائل والتواريخ وأرقام التليفونات.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono font-bold text-sky-600 tabular-nums">2.</span>
              <span>
                <strong>دعم الأرقام العربية والإنجليزية:</strong> يحول التطبيق الأرقام العربية (٠١٢٣...) تلقائيًا ويميز بدقة بين رقم التليفون، السعر الإجمالي، والإحداثيات.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono font-bold text-sky-600 tabular-nums">3.</span>
              <span>
                <strong>التحقق من روابط الخرائط:</strong> يستخرج الإحداثيات المباشرة (`q=lat,lng` أو `@lat,lng`). وإذا كان الرابط بحثًا عن مكان (بدون إحداثيات رقمية)، يبحث عنه عبر خرائط OpenStreetMap ويعرضه لك لتأكيده.
              </span>
            </li>
          </ul>

          <div className="pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
            <span>جميع البيانات تُحفظ محليًا على جهازك تلقائيًا ولا تُرسل أرقام العملاء لأي جهة.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
