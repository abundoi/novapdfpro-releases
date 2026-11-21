import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import { aiAssistant } from '../services/aiAssistant';
import { useLicenseStore } from '../stores/licenseStore';
import { AppSettings } from '../types';
import type { PdfAssociationStatus } from '../types/electron';
import {
  Settings,
  HardDrive,
  Cpu,
  Shield,
  Type,
  Check,
  RefreshCw,
  Folder,
  Crown,
  Save,
  FileCheck2,
  MousePointerClick,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { tier, status, email, licenseKeyMasked, trialDaysRemaining, openLicenseModal } =
    useLicenseStore();
  const [settings, setSettings] = useState<AppSettings>(dbService.getSettings());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState<string | null>(null);
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const [assocStatus, setAssocStatus] = useState<PdfAssociationStatus | null>(null);
  const [assocFeedback, setAssocFeedback] = useState<string | null>(null);
  const [isUpdatingAssoc, setIsUpdatingAssoc] = useState(false);

  const refreshAssocStatus = async () => {
    if (!window.electronAPI?.getPdfAssociationStatus) return;
    const st = await window.electronAPI.getPdfAssociationStatus();
    setAssocStatus(st);
  };

  useEffect(() => {
    void refreshAssocStatus();
  }, []);

  const handleRegisterOpenWith = async () => {
    if (!window.electronAPI?.registerOpenWith) return;
    setIsUpdatingAssoc(true);
    setAssocFeedback(null);
    try {
      const res = await window.electronAPI.registerOpenWith();
      if (res.status) setAssocStatus(res.status);
      setAssocFeedback(
        res.success
          ? 'Registered! Right-click any .pdf file in Explorer -> "Open with NovaPDFPro".'
          : res.error || 'Could not register Open with menu.'
      );
    } finally {
      setIsUpdatingAssoc(false);
    }
  };

  const handleSetDefaultPdfReader = async () => {
    if (!window.electronAPI?.setDefaultPdfReader) return;
    setIsUpdatingAssoc(true);
    setAssocFeedback(null);
    try {
      const res = await window.electronAPI.setDefaultPdfReader();
      if (res.status) setAssocStatus(res.status);
      if (res.success) {
        setAssocFeedback(
          res.status?.isDefaultReader
            ? 'NovaPDFPro is now your default Windows PDF reader!'
            : 'Registered NovaPDFPro! In the Windows Default Apps window that just opened, select NovaPDFPro for .pdf files to finalize.'
        );
      } else {
        setAssocFeedback(res.error || 'Could not update default PDF association.');
      }
    } finally {
      setIsUpdatingAssoc(false);
    }
  };

  const handleUpdate = (updates: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  const handleSaveSettings = () => {
    const saved = dbService.updateSettings(settings);
    setSettings(saved);
    setHasUnsavedChanges(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleTestOllama = async () => {
    setIsCheckingAi(true);
    setAiStatusMessage('Connecting to local Ollama daemon...');
    aiAssistant.setEndpoint(settings.ollamaEndpoint);

    try {
      const res = await aiAssistant.checkStatus(settings.ollamaEndpoint);
      if (res.isAvailable) {
        setAiStatusMessage(
          `Connected in ${res.latencyMs !== undefined ? res.latencyMs + 'ms' : '<50ms'}! Local models found: ${
            res.models.join(', ') || 'Connected, but no models installed. Run `ollama run llama3`.'
          }`
        );
      } else {
        setAiStatusMessage(`Connection failed: ${res.error || 'Connection refused'}`);
      }
    } catch (e: any) {
      setAiStatusMessage(`Error: ${e.message}`);
    } finally {
      setIsCheckingAi(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 select-none text-slate-100">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
              <Settings className="w-5 h-5 text-brand-400" />
              <span>Application Settings & System Preferences</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure offline storage locations, typography defaults, security timeouts, and local AI engines.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {saveSuccess && (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium">
                <Check className="w-3.5 h-3.5" />
                <span>Settings Saved</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleSaveSettings}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saveSuccess ? 'Saved!' : hasUnsavedChanges ? 'Save Changes' : 'Save Settings'}</span>
            </button>
          </div>
        </div>

        {/* 0. Subscription & Offline Licensing */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
              <Crown className="w-4 h-4 text-sky-400" />
              <span>NovaPDFPro Subscription &amp; License</span>
            </div>
            <p className="text-xs text-slate-400">
              Plan:{' '}
              <strong className="text-slate-200">
                {tier === 'TRIAL'
                  ? `Pro Trial (${trialDaysRemaining} days left — becomes Free Read-Only if not upgraded)`
                  : tier === 'FREE'
                  ? 'Free (Read-Only Reader)'
                  : `Activated Pro Subscriber (${status})`}
              </strong>
              {email ? ` • ${email}` : ''}
              {licenseKeyMasked ? ` • ${licenseKeyMasked}` : ''}
            </p>
          </div>
          <button
            onClick={() => openLicenseModal()}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow transition-colors"
          >
            Manage License / Upgrade
          </button>
        </div>

        {/* 0b. Windows PDF File Associations ("Open with" & Default PDF Reader) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
                <FileCheck2 className="w-4 h-4 text-emerald-400" />
                <span>Windows PDF Reader &amp; Right-Click &ldquo;Open with&rdquo;</span>
              </div>
              <p className="text-xs text-slate-400">
                Add <strong className="text-slate-200">Open with NovaPDFPro</strong> to the Windows Explorer right-click menu or set NovaPDFPro as your default <code className="text-sky-300">.pdf</code> handler.
              </p>
              {assocStatus?.supported && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                  <span
                    className={`px-2 py-0.5 rounded border font-medium ${
                      assocStatus.isRegisteredOpenWith
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    Right-Click &ldquo;Open with&rdquo;: {assocStatus.isRegisteredOpenWith ? 'Registered' : 'Not Registered'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded border font-medium ${
                      assocStatus.isDefaultReader
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    Default PDF Reader: {assocStatus.isDefaultReader ? 'NovaPDFPro' : assocStatus.currentProgId || 'System Default'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isUpdatingAssoc || !window.electronAPI?.registerOpenWith}
                onClick={handleRegisterOpenWith}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors disabled:opacity-40"
              >
                <MousePointerClick className="w-3.5 h-3.5 text-sky-400" />
                <span>Add to Right-Click Menu</span>
              </button>
              <button
                type="button"
                disabled={isUpdatingAssoc || !window.electronAPI?.setDefaultPdfReader}
                onClick={handleSetDefaultPdfReader}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors disabled:opacity-40"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Set as Default PDF Reader</span>
              </button>
            </div>
          </div>
          {assocFeedback && (
            <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-emerald-300">
              {assocFeedback}
            </div>
          )}
        </div>

        {/* 1. Editor & Typography Defaults */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200 border-b border-slate-800 pb-3">
            <Type className="w-4 h-4 text-sky-400" />
            <span>Editor & Typography Preferences</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Default Font Family</label>
              <select
                value={settings.defaultFont}
                onChange={(e) => handleUpdate({ defaultFont: e.target.value as any })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none"
              >
                <option value="Helvetica">Helvetica (Standard Sans)</option>
                <option value="TimesRoman">Times New Roman (Serif)</option>
                <option value="Courier">Courier (Monospace)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Default Font Size (pt)</label>
              <input
                type="number"
                value={settings.defaultFontSize}
                onChange={(e) => handleUpdate({ defaultFontSize: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Default Annotation Color</label>
              <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700 rounded-lg p-1.5">
                <input
                  type="color"
                  value={settings.defaultAnnotationColor}
                  onChange={(e) => handleUpdate({ defaultAnnotationColor: e.target.value })}
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
                <span className="text-xs font-mono text-slate-300">
                  {settings.defaultAnnotationColor}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Storage & Backup Directories */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200 border-b border-slate-800 pb-3">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <span>Local Storage & Backup Management</span>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Document Storage Directory</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={settings.storageDirectory}
                  onChange={(e) => handleUpdate({ storageDirectory: e.target.value })}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Automatic Backup Directory</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={settings.backupDirectory}
                  onChange={(e) => handleUpdate({ backupDirectory: e.target.value })}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">
                  Auto-Save Interval (Seconds)
                </label>
                <input
                  type="number"
                  value={settings.autoSaveIntervalSec}
                  onChange={(e) => handleUpdate({ autoSaveIntervalSec: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">
                  Inactivity Auto-Lock (Minutes)
                </label>
                <input
                  type="number"
                  value={settings.autoLockMinutes}
                  onChange={(e) => handleUpdate({ autoLockMinutes: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 3. Local AI Engine (Ollama) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
              <Cpu className="w-4 h-4 text-purple-400" />
              <span>Offline Local AI Assistant (Ollama)</span>
            </div>
            <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={settings.enableLocalAi}
                onChange={(e) => handleUpdate({ enableLocalAi: e.target.checked })}
                className="accent-brand-500 rounded"
              />
              <span>Enable Local AI</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Local Endpoint URL</label>
              <input
                type="text"
                value={settings.ollamaEndpoint}
                onChange={(e) => handleUpdate({ ollamaEndpoint: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Model Identifier</label>
              <input
                type="text"
                value={settings.ollamaModel}
                onChange={(e) => handleUpdate({ ollamaModel: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono outline-none"
              />
            </div>
          </div>

          {aiStatusMessage && (
            <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700 text-xs font-mono text-purple-300">
              {aiStatusMessage}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              onClick={handleTestOllama}
              disabled={isCheckingAi}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAi ? 'animate-spin' : ''}`} />
              <span>Test Local AI Connection</span>
            </button>
          </div>
        </div>

        {/* Sticky / Bottom Consistent Save Action Bar */}
        <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-6 py-4">
          <span className="text-xs text-slate-400">
            {hasUnsavedChanges
              ? 'You have unsaved preference changes.'
              : 'All application settings are stored offline on your Windows PC.'}
          </span>
          <button
            type="button"
            onClick={handleSaveSettings}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-colors"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{saveSuccess ? 'Settings Saved!' : 'Save & Apply Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
