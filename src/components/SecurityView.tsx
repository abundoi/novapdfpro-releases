import React, { useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { dbService } from '../services/db';
import {
  ShieldAlert,
  Lock,
  FileCheck,
  Download,
  Key,
  ShieldCheck,
  Check,
  AlertTriangle,
  Save,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { pdfBytes, currentFileName, setSecurity, saveCurrentPdf, loadPdfBytes, setStatusMessage } =
    useEditorStore();
  const auditLogs = dbService.getAuditLogs();

  const [activeTab, setActiveTab] = useState<'encrypt' | 'audit'>('encrypt');

  // Encryption state
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [restrictPrinting, setRestrictPrinting] = useState(false);
  const [restrictCopying, setRestrictCopying] = useState(false);
  const [restrictModifying, setRestrictModifying] = useState(false);
  const [appliedSecurity, setAppliedSecurity] = useState(false);
  const [isSavingEncrypted, setIsSavingEncrypted] = useState(false);

  const handleApplySecurity = () => {
    if (!pdfBytes) return;

    setSecurity({
      userPassword: userPassword || undefined,
      ownerPassword: ownerPassword || undefined,
      permissions: {
        printing: restrictPrinting ? 'lowResolution' : 'highResolution',
        copying: !restrictCopying,
        modifying: !restrictModifying,
      },
    });

    dbService.logAudit('SECURITY_ENCRYPT', 'Configured document encryption & permission flags');
    setAppliedSecurity(true);
    setStatusMessage('Security permissions applied to PDF compilation queue');
    setTimeout(() => setAppliedSecurity(false), 3000);
  };

  const handleApplyAndSavePdf = async () => {
    if (!pdfBytes) return;
    handleApplySecurity();
    setIsSavingEncrypted(true);
    try {
      const saved = await saveCurrentPdf();
      if (!saved) return;
      const defaultName = (currentFileName || 'Document.pdf').replace(/\.pdf$/i, '_secured.pdf');
      if (window.electronAPI?.savePdfDialog) {
        const res = await window.electronAPI.savePdfDialog({ defaultName, data: saved });
        if (res?.success && res.filePath) {
          await loadPdfBytes(
            saved,
            res.filePath.split(/[\\/]/).pop() || defaultName,
            res.filePath,
            userPassword || undefined
          );
          setStatusMessage(`Encrypted PDF saved to ${res.filePath}`);
        }
      } else {
        const blob = new Blob([saved as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMessage('Encrypted PDF exported successfully');
      }
    } finally {
      setIsSavingEncrypted(false);
    }
  };

  const handleExportAuditLogs = () => {
    const json = JSON.stringify(auditLogs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NovaPDFPro_Audit_Logs_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 select-none text-slate-100">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-red-400" />
            <span>Document Security &amp; Audit Logs</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure PDF password encryption, permission flags, permanent redactions, and local activity audit logs.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('encrypt')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'encrypt'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Document Encryption</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Tamper-Evident Audit Logs</span>
          </button>
        </div>

        {/* TAB 1: DOCUMENT ENCRYPTION */}
        {activeTab === 'encrypt' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-sm text-slate-200">PDF Password & Permission Security</h3>
              <p className="text-xs text-slate-400">
                Encrypt document with standard 128-bit / 256-bit AES encryption upon save.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">
                  Document Open Password (User Password)
                </label>
                <input
                  type="password"
                  placeholder="Optional password to open document"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 outline-none focus:border-brand-500 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">
                  Permission Password (Owner Password)
                </label>
                <input
                  type="password"
                  placeholder="Password required to change permissions"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 outline-none focus:border-brand-500 font-mono"
                />
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-semibold text-slate-300">Permission Restrictions:</h4>
              <div className="space-y-2">
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restrictPrinting}
                    onChange={(e) => setRestrictPrinting(e.target.checked)}
                    className="accent-brand-500 rounded"
                  />
                  <span>Restrict high-resolution printing</span>
                </label>

                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restrictCopying}
                    onChange={(e) => setRestrictCopying(e.target.checked)}
                    className="accent-brand-500 rounded"
                  />
                  <span>Restrict content copying and text extraction</span>
                </label>

                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restrictModifying}
                    onChange={(e) => setRestrictModifying(e.target.checked)}
                    className="accent-brand-500 rounded"
                  />
                  <span>Restrict modifying document content and annotations</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleApplySecurity}
                disabled={!pdfBytes}
                className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-40"
              >
                {appliedSecurity ? <Check className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                <span>{appliedSecurity ? 'Security Queued!' : 'Apply Security Settings'}</span>
              </button>

              <button
                type="button"
                onClick={handleApplyAndSavePdf}
                disabled={!pdfBytes || isSavingEncrypted}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-md disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingEncrypted ? 'Saving PDF...' : 'Apply & Save PDF'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-semibold text-sm text-slate-200">Local Activity Audit Trail</h3>
                <p className="text-xs text-slate-400">
                  Tamper-evident logs of all local document operations and access events.
                </p>
              </div>

              <button
                onClick={handleExportAuditLogs}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Audit JSON</span>
              </button>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-2 text-slate-400 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 text-emerald-400 font-semibold">{log.action}</td>
                      <td className="py-2 text-slate-300 truncate max-w-md">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
