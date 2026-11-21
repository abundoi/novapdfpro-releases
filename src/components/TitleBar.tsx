import React, { useEffect, useState } from 'react';
import {
  FileText,
  Minus,
  Square,
  X,
  Copy,
  HardDrive,
  Crown,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useLicenseStore } from '../stores/licenseStore';

export const TitleBar: React.FC = () => {
  const [isMax, setIsMax] = useState(false);
  const { currentFileName, isDirty, isSaving, statusMessage } = useEditorStore();
  const { tier, trialDaysRemaining, openLicenseModal } = useLicenseStore();

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.isMaximized().then(setIsMax);
      window.electronAPI.onMaximizedChange((max) => setIsMax(max));
    }
  }, []);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  return (
    <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between select-none px-3 text-xs z-50 text-slate-300">
      {/* Left: App Branding & File Status */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-brand-400 font-semibold tracking-wide">
          <div className="w-5 h-5 rounded bg-brand-600/30 border border-brand-500/40 flex items-center justify-center text-brand-300">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <span className="text-slate-100 font-bold text-sm tracking-tight">NovaPDFPro</span>
          <span className="text-[10px] font-mono text-slate-400">v01.31</span>
          <button
            type="button"
            onClick={() => openLicenseModal()}
            className={`text-[10px] px-2 py-0.5 rounded font-mono border flex items-center space-x-1 transition-colors cursor-pointer ${
              tier === 'PRO'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                : tier === 'TRIAL'
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
            }`}
            title={
              tier === 'PRO'
                ? 'Activated Pro Subscriber'
                : tier === 'TRIAL'
                ? '14-day Pro Trial — reverts to Free (Read-Only) if not upgraded after trial ends'
                : 'Free (Read-Only) — Activate Pro license to edit'
            }
          >
            <Crown className="w-2.5 h-2.5" />
            <span>
              {tier === 'PRO'
                ? 'PRO • ACTIVATED'
                : tier === 'TRIAL'
                ? `PRO TRIAL • ${trialDaysRemaining}d`
                : 'FREE (READ-ONLY) • UPGRADE'}
            </span>
          </button>
        </div>

        <div className="h-3 w-px bg-slate-700" />

        <div className="flex items-center space-x-2 max-w-sm truncate">
          <span className="text-slate-200 font-medium truncate">{currentFileName}</span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
          )}
          {isSaving && (
            <span className="text-[10px] text-brand-400 font-mono">Saving...</span>
          )}
        </div>
      </div>

      {/* Center: Status indicator */}
      <div className="hidden md:flex items-center space-x-2 text-slate-400 text-[11px]">
        <HardDrive className="w-3 h-3 text-emerald-400" />
        <span>Local Storage</span>
        <span className="text-slate-600">•</span>
        <span className="truncate max-w-xs">{statusMessage}</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center space-x-2">
        {/* Window controls if Electron */}
        {window.electronAPI && (
          <div className="flex items-center space-x-1">
            <button
              onClick={handleMinimize}
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100 transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleMaximize}
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100 transition-colors"
              title={isMax ? 'Restore' : 'Maximize'}
            >
              {isMax ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            </button>
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-600 rounded text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
