import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ThumbnailStrip } from './components/ThumbnailStrip';
import { PDFViewer } from './components/PDFViewer';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DashboardView } from './components/DashboardView';
import { OrganizeView } from './components/OrganizeView';
import { ConvertView } from './components/ConvertView';
import { OCRView } from './components/OCRView';
import { SignaturesView } from './components/SignaturesView';
import { SecurityView } from './components/SecurityView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { AIAssistantModal } from './components/AIAssistantModal';
import { WatermarkModal } from './components/WatermarkModal';
import { HeaderFooterModal } from './components/HeaderFooterModal';
import { LicenseModal } from './components/LicenseModal';
import { PasswordPromptModal } from './components/PasswordPromptModal';
import { useEditorStore } from './stores/editorStore';
import { useLicenseStore, PRO_FEATURE_LABELS, type ProFeatureKey } from './stores/licenseStore';
import { pdfEngine } from './services/pdfEngine';
import { ocrEngine } from './services/ocrEngine';
import { converterService } from './services/converter';
import { Lock, Crown } from 'lucide-react';

if (typeof window !== 'undefined' && window.electronAPI?.isTestMode === true) {
  (window as any).__editorStore = useEditorStore;
  (window as any).__licenseStore = useLicenseStore;
  (window as any).__pdfEngine = pdfEngine;
  (window as any).__ocrEngine = ocrEngine;
  (window as any).__converterService = converterService;
}

export const App: React.FC = () => {
  const { activeTab, setActiveTab, isPropertiesOpen, undo, redo, loadPdfBytes } = useEditorStore();
  const { hasEntitlement, openLicenseModal, loadLicenseStatus, tier } = useLicenseStore();

  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isWatermarkOpen, setIsWatermarkOpen] = useState(false);
  const [isHeaderFooterOpen, setIsHeaderFooterOpen] = useState(false);

  useEffect(() => {
    loadLicenseStatus();

    if (window.electronAPI?.consumeInitialPdf) {
      window.electronAPI
        .consumeInitialPdf()
        .then(async (payload) => {
          if (payload?.data) {
            await loadPdfBytes(new Uint8Array(payload.data), payload.name, payload.filePath);
            setActiveTab('editor');
          }
        })
        .catch(() => {});
    }

    if (window.electronAPI?.onOpenPdfFile) {
      return window.electronAPI.onOpenPdfFile(async (payload) => {
        if (payload?.data) {
          await loadPdfBytes(new Uint8Array(payload.data), payload.name, payload.filePath);
          setActiveTab('editor');
        }
      });
    }
  }, [loadLicenseStatus, loadPdfBytes, setActiveTab]);

  // Global Keyboard Shortcuts (Undo / Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Allow native undo/redo inside input or textarea
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const proTabFeatureMap: Partial<Record<typeof activeTab, ProFeatureKey>> = {
    organize: 'organize',
    convert: 'convert',
    ocr: 'ocr',
    signatures: 'signatures',
    security: 'security',
  };
  const activeTabFeature = proTabFeatureMap[activeTab];
  const isTabLocked = activeTabFeature ? !hasEntitlement(activeTabFeature) : false;

  const handleOpenProTrigger = (feature: ProFeatureKey, onGranted: () => void) => {
    if (!hasEntitlement(feature)) {
      openLicenseModal(PRO_FEATURE_LABELS[feature]);
      return;
    }
    onGranted();
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. Custom Sleek Desktop Titlebar */}
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        {/* 2. Left Icon Navigation Sidebar */}
        <Sidebar onOpenAi={() => handleOpenProTrigger('local_ai', () => setIsAiOpen(true))} />

        {/* 3. Main Center Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
          {/* Top Acrobat Ribbon Toolbar (shown in editor mode) */}
          {activeTab === 'editor' && (
            <Toolbar
              onOpenAi={() => handleOpenProTrigger('local_ai', () => setIsAiOpen(true))}
              onOpenWatermarkModal={() =>
                handleOpenProTrigger('watermark', () => setIsWatermarkOpen(true))
              }
              onOpenHeaderFooterModal={() =>
                handleOpenProTrigger('header_footer', () => setIsHeaderFooterOpen(true))
              }
              onOpenPasswordModal={() =>
                handleOpenProTrigger('security', () => setActiveTab('security'))
              }
              onOpenSignatureModal={() =>
                handleOpenProTrigger('signatures', () => setActiveTab('signatures'))
              }
            />
          )}

          {/* Dynamic Content Views */}
          <div className="flex-1 flex overflow-hidden">
            {isTabLocked && activeTabFeature ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
                  <Lock className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">
                  {PRO_FEATURE_LABELS[activeTabFeature]} — NovaPDFPro Feature
                </h2>
                <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
                  You are currently in <strong>Free (Read-Only)</strong> mode. Activate a <strong>NovaPDFPro</strong> subscription or license key to unlock full offline editing, OCR, Conversion, Organization Studio, Signatures, and Security tools.
                </p>
                <button
                  onClick={() => openLicenseModal(PRO_FEATURE_LABELS[activeTabFeature])}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg transition-colors"
                >
                  <Crown className="w-4 h-4" />
                  <span>Activate Key or Upgrade to Pro</span>
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'dashboard' && <DashboardView />}

                {activeTab === 'editor' && (
                  <>
                    <ThumbnailStrip />
                    <PDFViewer />
                    {isPropertiesOpen && <PropertiesPanel />}
                  </>
                )}

                {activeTab === 'organize' && <OrganizeView />}
                {activeTab === 'convert' && <ConvertView />}
                {activeTab === 'ocr' && <OCRView />}
                {activeTab === 'signatures' && <SignaturesView />}
                {activeTab === 'security' && <SecurityView />}
                {activeTab === 'history' && <HistoryView />}
                {activeTab === 'settings' && <SettingsView />}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Slide-out & Dialog Modals */}
      <AIAssistantModal isOpen={isAiOpen} onClose={() => setIsAiOpen(false)} />
      <WatermarkModal isOpen={isWatermarkOpen} onClose={() => setIsWatermarkOpen(false)} />
      <HeaderFooterModal
        isOpen={isHeaderFooterOpen}
        onClose={() => setIsHeaderFooterOpen(false)}
      />
      <LicenseModal />
      <PasswordPromptModal />
    </div>
  );
};

export default App;
