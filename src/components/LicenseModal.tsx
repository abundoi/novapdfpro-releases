import React, { useState } from 'react';
import {
  X,
  Crown,
  KeyRound,
  ShieldCheck,
  Sparkles,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Lock,
  Laptop,
} from 'lucide-react';
import { useLicenseStore } from '../stores/licenseStore';

export const LicenseModal: React.FC = () => {
  const {
    isModalOpen,
    lockedFeaturePrompt,
    tier,
    status,
    email,
    plan,
    licenseKeyMasked,
    maxSeats,
    offlineValidUntil,
    portalUrl,
    machineFingerprint,
    trialDaysRemaining,
    isLoading,
    lastError,
    closeLicenseModal,
    activateKey,
    importOfflineToken,
    refreshOnline,
    deactivate,
  } = useLicenseStore();

  const [keyInput, setKeyInput] = useState('');
  const [showOfflineImport, setShowOfflineImport] = useState(false);
  const [offlineTokenInput, setOfflineTokenInput] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isModalOpen) return null;

  const isPaid = tier === 'PRO';

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    const res = await activateKey(keyInput);
    if (res.success) {
      setSuccessMsg('NovaPDFPro license activated & cryptographically bound to this PC!');
      setKeyInput('');
    }
  };

  const handleImportToken = async () => {
    setSuccessMsg(null);
    const res = await importOfflineToken(offlineTokenInput);
    if (res.success) {
      setSuccessMsg('Signed offline token verified with Ed25519 public key!');
      setOfflineTokenInput('');
      setShowOfflineImport(false);
    }
  };

  const openPortal = () => {
    const cleanBase = (portalUrl || 'https://novapdf.appmys.com').replace(/\/+$/, '');
    const lower = cleanBase.toLowerCase();
    const portalPath = lower.includes('localhost') || lower.includes('127.0.0.1') ? '/novapdfpro' : '/portal';
    const target = `${cleanBase}${portalPath}`;
    if (window.electronAPI?.openExternalUrl) {
      window.electronAPI.openExternalUrl(target);
    } else {
      window.open(target, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4 select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-sky-950/50 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <Crown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">NovaPDFPro Licensing &amp; Plans</h3>
              <p className="text-[11px] text-slate-400">
                Plans &amp; pricing updated in the Web Portal • 14-day Free Pro Trial (No Card Upfront)
              </p>
            </div>
          </div>
          <button
            onClick={closeLicenseModal}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto text-xs">
          {/* Locked Feature Banner */}
          {lockedFeaturePrompt && (
            <div className="bg-amber-950/40 border border-amber-600/50 rounded-xl p-3.5 flex items-start space-x-3">
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-200">
                  {lockedFeaturePrompt} requires NovaPDFPro
                </div>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Activate a Pro license key or subscribe online to unlock all offline editing, OCR, conversion, and cryptographic signature features.
                </p>
              </div>
            </div>
          )}

          {/* Current Plan Status Card */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Current Edition
                </span>
                <div className="flex items-center space-x-2 mt-0.5">
                  <span className="text-base font-bold text-white">
                    {isPaid
                      ? 'Activated Pro Subscriber'
                      : tier === 'TRIAL'
                      ? `Pro Trial (${trialDaysRemaining} days left)`
                      : 'Free • Read-Only Mode'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      isPaid
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : tier === 'TRIAL'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {isPaid ? 'PRO ACTIVATED' : tier === 'TRIAL' ? 'TRIALING' : 'READ-ONLY'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {isPaid
                    ? 'Full offline Pro access unlocked for this PC.'
                    : tier === 'TRIAL'
                    ? 'All Pro tools unlocked during trial. Automatically switches to Free (Read-Only) if not upgraded when trial ends.'
                    : 'View & read PDFs offline. Activate a Pro license to edit, annotate, sign, convert, or run OCR.'}
                </p>
              </div>

              <button
                type="button"
                onClick={openPortal}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isPaid ? 'Manage Plan' : 'View Plans & Pricing'}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            {isPaid && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px]">
                <div>
                  <span className="text-slate-500">Account:</span>{' '}
                  <span className="text-slate-200">{email}</span>
                </div>
                <div>
                  <span className="text-slate-500">Key:</span>{' '}
                  <span className="font-mono text-sky-300">{licenseKeyMasked}</span>
                </div>
                <div>
                  <span className="text-slate-500">Seats:</span>{' '}
                  <span className="text-slate-200">Up to {maxSeats || 2} Windows PCs</span>
                </div>
                <div>
                  <span className="text-slate-500">Offline Grace Until:</span>{' '}
                  <span className="text-emerald-300">
                    {offlineValidUntil
                      ? new Date(offlineValidUntil * 1000).toLocaleDateString()
                      : 'Active'}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] text-slate-500">
              <span className="flex items-center space-x-1 font-mono">
                <Laptop className="w-3 h-3 text-slate-400" />
                <span>Device ID: {machineFingerprint.slice(0, 16)}…</span>
              </span>
              {isPaid && (
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => refreshOnline()}
                    className="text-sky-400 hover:text-sky-300 flex items-center space-x-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deactivate()}
                    className="text-red-400 hover:text-red-300"
                  >
                    Deactivate PC
                  </button>
                </div>
              )}
            </div>
          </div>

          {successMsg && (
            <div className="bg-emerald-950/50 border border-emerald-700/60 text-emerald-200 rounded-xl px-3.5 py-2.5 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {lastError && (
            <div className="bg-red-950/50 border border-red-700/60 text-red-200 rounded-xl px-3.5 py-2.5">
              {lastError}
            </div>
          )}

          {/* Activate License Key Form */}
          <form onSubmit={handleActivate} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-200 flex items-center space-x-1.5">
                <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                <span>Activate License Key</span>
              </label>
              <button
                type="button"
                onClick={() => setShowOfflineImport((v) => !v)}
                className="text-[11px] text-sky-400 hover:underline"
              >
                {showOfflineImport ? 'Use License Key Instead' : 'Air-Gapped Offline Token'}
              </button>
            </div>

            {!showOfflineImport ? (
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="NOVA-XXXX-XXXX-XXXX-XXXX"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 font-mono text-sm text-sky-200 uppercase outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={isLoading || keyInput.trim().length < 8}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold transition-colors shrink-0"
                >
                  {isLoading ? 'Activating...' : 'Activate'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={offlineTokenInput}
                  onChange={(e) => setOfflineTokenInput(e.target.value)}
                  placeholder="Paste Ed25519 signed offline license token..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleImportToken}
                    disabled={isLoading || offlineTokenInput.trim().length < 16}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold"
                  >
                    Verify &amp; Import Offline Token
                  </button>
                </div>
              </div>
            )}
          </form>

          {/* Trust Footer */}
          <div className="pt-3 border-t border-slate-800 flex items-center space-x-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Your PDF files stay 100% on your Windows PC. Activation only transmits your hashed device ID and license key.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
