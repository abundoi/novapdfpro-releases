import { create } from 'zustand';
import type { LicenseStatusPayload } from '../types/electron';

export type ProFeatureKey =
  | 'text_edit'
  | 'text_add'
  | 'image_add'
  | 'stamps'
  | 'organize'
  | 'ocr'
  | 'convert'
  | 'signatures'
  | 'security'
  | 'watermark'
  | 'header_footer'
  | 'local_ai';

export const PRO_FEATURE_LABELS: Record<ProFeatureKey, string> = {
  text_edit: 'Edit Existing PDF Text',
  text_add: 'Add Custom Text',
  image_add: 'Insert Images',
  stamps: 'Enterprise Stamps',
  organize: 'Page Organization Studio',
  ocr: 'Offline OCR Recognition',
  convert: 'Local Conversion Center',
  signatures: 'Electronic & Digital Signatures',
  security: 'Redaction & Password Encryption',
  watermark: 'Custom Watermarks',
  header_footer: 'Headers, Footers & Pagination',
  local_ai: 'Local AI Document Assistant',
};

interface LicenseState extends LicenseStatusPayload {
  isLoading: boolean;
  isModalOpen: boolean;
  lockedFeaturePrompt: string | null;
  lastError: string | null;

  loadLicenseStatus: () => Promise<void>;
  hasEntitlement: (feature?: ProFeatureKey) => boolean;
  openLicenseModal: (lockedFeaturePrompt?: string) => void;
  closeLicenseModal: () => void;
  activateKey: (licenseKey: string, portalUrl?: string) => Promise<{ success: boolean; error?: string }>;
  importOfflineToken: (token: string) => Promise<{ success: boolean; error?: string }>;
  refreshOnline: () => Promise<{ success: boolean; error?: string }>;
  deactivate: () => Promise<void>;
  setModeForTesting: (mode: 'FREE' | 'TRIAL') => Promise<void>;
}

const DEFAULT_STATUS: LicenseStatusPayload = {
  tier: 'FREE',
  status: 'FREE',
  trialDaysRemaining: 0,
  portalUrl: 'https://novapdf.appmys.com',
  machineFingerprint: 'unverified-device',
  deviceName: 'Windows PC',
};

export const useLicenseStore = create<LicenseState>((set, get) => ({
  ...DEFAULT_STATUS,
  isLoading: false,
  isModalOpen: false,
  lockedFeaturePrompt: null,
  lastError: null,

  loadLicenseStatus: async () => {
    if (!window.electronAPI?.licenseGetStatus) {
      set({ ...DEFAULT_STATUS, isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      const status = await window.electronAPI.licenseGetStatus();
      set({ ...status, isLoading: false, lastError: null });

      // Non-blocking background sync with portal when network is reachable
      if (status.tier === 'PRO' && window.electronAPI.licenseRefresh) {
        window.electronAPI
          .licenseRefresh({ portalUrl: status.portalUrl })
          .then((res) => {
            if (res.status) set({ ...res.status });
          })
          .catch(() => {
            // Expected offline - continue seamlessly with local signed lease
          });
      } else if (status.tier === 'TRIAL' && window.electronAPI.licenseSyncTrial) {
        window.electronAPI
          .licenseSyncTrial({ portalUrl: status.portalUrl })
          .then((res) => {
            if (res.status) set({ ...res.status });
          })
          .catch(() => {
            // Expected offline - continue with local DPAPI trial state
          });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  hasEntitlement: (_feature?: ProFeatureKey) => {
    const { tier, trialDaysRemaining, offlineValidUntil } = get();
    if (tier === 'PRO') {
      if (offlineValidUntil && Math.floor(Date.now() / 1000) > offlineValidUntil) {
        return false;
      }
      return true;
    }
    if (tier === 'TRIAL') {
      return (trialDaysRemaining || 0) > 0;
    }
    return false;
  },

  openLicenseModal: (lockedFeaturePrompt) =>
    set({
      isModalOpen: true,
      lockedFeaturePrompt: lockedFeaturePrompt || null,
      lastError: null,
    }),

  closeLicenseModal: () => set({ isModalOpen: false, lockedFeaturePrompt: null, lastError: null }),

  activateKey: async (licenseKey, portalUrl) => {
    set({ isLoading: true, lastError: null });
    const targetPortal = (portalUrl || get().portalUrl || 'https://novapdf.appmys.com').replace(/\/+$/, '');

    try {
      if (window.electronAPI?.licenseActivate) {
        const res = await window.electronAPI.licenseActivate({
          licenseKey,
          portalUrl: targetPortal,
        });
        if (!res.success || !res.status) {
          set({ isLoading: false, lastError: res.error || 'Activation failed' });
          return { success: false, error: res.error };
        }
        set({
          ...res.status,
          isLoading: false,
          lockedFeaturePrompt: null,
          lastError: null,
        });
        return { success: true };
      }

      set({
        isLoading: false,
        lastError: 'License activation requires the NovaPDFPro desktop runtime.',
      });
      return {
        success: false,
        error: 'License activation requires the NovaPDFPro desktop runtime.',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to reach licensing server';
      set({ isLoading: false, lastError: msg });
      return { success: false, error: msg };
    }
  },

  importOfflineToken: async (token) => {
    if (!window.electronAPI?.licenseImportOffline) {
      return { success: false, error: 'Offline token import requires desktop mode' };
    }
    set({ isLoading: true, lastError: null });
    const res = await window.electronAPI.licenseImportOffline({ token });
    if (!res.success || !res.status) {
      set({ isLoading: false, lastError: res.error || 'Invalid token' });
      return { success: false, error: res.error };
    }
    set({ ...res.status, isLoading: false, lockedFeaturePrompt: null, lastError: null });
    return { success: true };
  },

  refreshOnline: async () => {
    if (!window.electronAPI?.licenseRefresh) {
      return { success: false, error: 'Unavailable in browser mode' };
    }
    set({ isLoading: true, lastError: null });
    const res = await window.electronAPI.licenseRefresh({ portalUrl: get().portalUrl });
    if (res.status) set({ ...res.status });
    set({ isLoading: false, lastError: res.success ? null : res.error || 'Refresh failed' });
    return { success: res.success, error: res.error };
  },

  deactivate: async () => {
    set({ isLoading: true, lastError: null });
    if (window.electronAPI?.licenseDeactivate) {
      const res = await window.electronAPI.licenseDeactivate({ portalUrl: get().portalUrl });
      if (res.status) {
        set({
          ...res.status,
          email: undefined,
          licenseKeyMasked: undefined,
          plan: undefined,
          offlineValidUntil: undefined,
          isLoading: false,
        });
        return;
      }
    }
    set({ tier: 'FREE', status: 'FREE', email: undefined, licenseKeyMasked: undefined, isLoading: false });
  },

  setModeForTesting: async (mode) => {
    if (window.electronAPI?.isTestMode && window.electronAPI?.licenseSetMode) {
      const st = await window.electronAPI.licenseSetMode(mode);
      set({
        ...st,
        email: undefined,
        licenseKeyMasked: undefined,
        plan: undefined,
        offlineValidUntil: undefined,
      });
    }
  },
}));
