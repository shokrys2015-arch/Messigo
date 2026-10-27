import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { DayRecord, MessigoBackupFile } from '../types/messigo';
import { validateBackupJson } from '../services/storageService';

interface BackupViewProps {
  days: DayRecord[];
  activeDayId: string;
  onExportBackup: () => void;
  onConfirmImportBackup: (backup: MessigoBackupFile, mode: 'merge' | 'replace') => Promise<void>;
}

export const BackupView: React.FC<BackupViewProps> = ({
  days,
  onExportBackup,
  onConfirmImportBackup,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<MessigoBackupFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const totalOrdersAcrossDays = days.reduce((sum, d) => sum + d.orders.length, 0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validated = validateBackupJson(parsed);
      setPendingBackup(validated);
    } catch (err) {
      setPendingBackup(null);
      if (err instanceof Error) {
        setImportError(err.message);
      } else {
        setImportError('تعذر قراءة ملف النسخة الاحتياطية. تأكد من اختيار ملف JSON صالح من Messigo.');
      }
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleExecuteImport = async (mode: 'merge' | 'replace') => {
    if (!pendingBackup) return;
    setIsImporting(true);
    setImportError(null);
    try {
      await onConfirmImportBackup(pendingBackup, mode);
      setImportSuccess(
        mode === 'replace'
          ? 'تم استبدال البيانات واستعادة النسخة الاحتياطية بنجاح.'
          : 'تم دمج بيانات النسخة الاحتياطية مع بياناتك الحالية بنجاح.'
      );
      setPendingBackup(null);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء استعادة النسخة الاحتياطية.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Export & Import Controls */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">حفظ البيانات والنسخ الاحتياطي</h2>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            يتم حفظ جميع الأوردرات والإحداثيات والمسارات تلقائيًا في قاعدة بيانات المتصفح المحلية (IndexedDB). يمكنك تصدير نسخة احتياطية كاملة إلى جهازك في أي وقت.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <div>
            <div className="text-xs text-slate-500">إجمالي الأيام المحفوظة</div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
              {days.length}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">إجمالي الأوردرات المسجلة</div>
            <div className="text-2xl font-extrabold font-mono tabular-nums text-sky-600 mt-1">
              {totalOrdersAcrossDays}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onExportBackup}
            className="min-h-[48px] px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>تصدير نسخة احتياطية</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[48px] px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-800 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4 text-sky-600" />
            <span>استيراد نسخة احتياطية</span>
          </button>
        </div>

        {/* Pending Backup Confirmation Box */}
        {pendingBackup && (
          <div className="p-5 bg-amber-50 border border-amber-300 rounded-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-amber-950">
                تأكيد استيراد ملف النسخة الاحتياطية
              </h3>
              <p className="text-xs text-amber-900 mt-1 leading-relaxed">
                تم التحقق من سلامة الملف بنجاح. يحتوي الملف على{' '}
                <strong className="font-mono tabular-nums">{pendingBackup.days.length}</strong> يوم
                عمل و{' '}
                <strong className="font-mono tabular-nums">
                  {pendingBackup.days.reduce((s, d) => s + d.orders.length, 0)}
                </strong>{' '}
                أوردر. كيف ترغب في استعادة البيانات؟
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isImporting}
                onClick={() => handleExecuteImport('merge')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-bold transition-colors whitespace-nowrap shrink-0"
              >
                دمج مع البيانات الحالية (موصى به)
              </button>

              <button
                type="button"
                disabled={isImporting}
                onClick={() => handleExecuteImport('replace')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold transition-colors whitespace-nowrap shrink-0"
              >
                استبدال كافة البيانات الحالية
              </button>

              <button
                type="button"
                disabled={isImporting}
                onClick={() => setPendingBackup(null)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-amber-300 text-amber-900 text-xs font-medium hover:bg-amber-100 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {importError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{importError}</span>
          </div>
        )}

        {importSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-900 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{importSuccess}</span>
          </div>
        )}
      </div>

      {/* Important Local Storage & Privacy Notes (Section 12 & 14) */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-sky-600 shrink-0" />
          <h3 className="text-base font-bold text-slate-900">معلومات التخزين المحلي والخصوصية</h3>
        </div>

        <ul className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
          <li className="flex items-start gap-2.5">
            <HardDrive className="w-4 h-4 text-sky-600 shrink-0 mt-1" />
            <span>
              <strong>التخزين محلي على جهازك:</strong> البيانات في هذه النسخة محفوظة محليًا داخل متصفحك (IndexedDB)، ولا تتم مزامنتها تلقائيًا بين الأجهزة أو المستخدمين.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-1" />
            <span>
              <strong>استقلالية الأجهزة ومسح المتصفح:</strong> إذا فتح شخص آخر رابط التطبيق على جهاز مختلف فستكون لديه بيانات محلية مستقلة. وإذا قمت بمسح بيانات التصفح في المتصفح فقد تفقد بياناتك المحلية؛ لذا ننصحك بتصدير نسخة احتياطية بانتظام.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-1" />
            <span>
              <strong>حماية خصوصية العملاء:</strong> عند حساب خط السير، يرسل Messigo إحداثيات خطوط الطول والعرض فقط إلى خدمة التوجيه (OSRM)، ولا يرسل أرقام تليفونات العملاء أو تفاصيل المنتجات أو الأسعار.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
};
