export interface ElectronFileResult {
  filePath: string;
  name: string;
  size: number;
  lastModified: number;
  data: Uint8Array | number[];
}

export interface ElectronSaveResult {
  success: boolean;
  filePath: string;
}

export interface PdfAssociationStatus {
  supported: boolean;
  isRegisteredOpenWith: boolean;
  isDefaultReader: boolean;
  currentProgId: string;
  exePath?: string;
}

export interface ElectronAPI {
  isTestMode?: boolean;

  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (isMax: boolean) => void) => void;

  openPdfDialog: (filePath?: string) => Promise<ElectronFileResult | null>;
  consumeInitialPdf?: () => Promise<ElectronFileResult | null>;
  onOpenPdfFile?: (callback: (payload: ElectronFileResult) => void) => () => void;
  openMultiplePdfsDialog: () => Promise<ElectronFileResult[]>;
  savePdfDialog: (options: { defaultName: string; data: Uint8Array | number[] }) => Promise<ElectronSaveResult | null>;

  saveBackup: (options: { name: string; data: Uint8Array | number[] }) => Promise<{ success: boolean; path?: string; error?: string }>;
  listBackups: () => Promise<Array<{ filename: string; path: string; size: number; mtime: number }>>;
  getAppInfo: () => Promise<{
    isPortable: boolean;
    baseStorageDir: string;
    paths: Record<string, string>;
    version: string;
    platform: string;
    arch: string;
  }>;
  checkFileExists?: (filePath: string) => Promise<{ exists: boolean; filePath: string }>;

  getPdfAssociationStatus?: () => Promise<PdfAssociationStatus>;
  registerOpenWith?: () => Promise<{ success: boolean; error?: string; status?: PdfAssociationStatus }>;
  setDefaultPdfReader?: () => Promise<{
    success: boolean;
    openedWindowsSettings?: boolean;
    error?: string;
    status?: PdfAssociationStatus;
  }>;

  checkOllama: (endpoint?: string) => Promise<{
    available: boolean;
    models: string[];
    latencyMs?: number;
    endpoint?: string;
    version?: string;
    warning?: string;
    error?: string;
  }>;
  generateOllama: (payload: { endpoint?: string; model?: string; prompt: string; systemPrompt?: string }) => Promise<{ success: boolean; response?: string; error?: string }>;

  licenseGetStatus: () => Promise<LicenseStatusPayload>;
  licenseActivate: (payload: { licenseKey: string; portalUrl?: string }) => Promise<{ success: boolean; error?: string; status?: LicenseStatusPayload }>;
  licenseImportOffline: (payload: { token: string }) => Promise<{ success: boolean; error?: string; status?: LicenseStatusPayload }>;
  licenseRefresh: (payload?: { portalUrl?: string }) => Promise<{ success: boolean; error?: string; status?: LicenseStatusPayload }>;
  licenseDeactivate: (payload?: { portalUrl?: string }) => Promise<{ success: boolean; error?: string; status?: LicenseStatusPayload }>;
  licenseSyncTrial: (payload?: { portalUrl?: string }) => Promise<{ success: boolean; expired?: boolean; offline?: boolean; error?: string; status?: LicenseStatusPayload }>;
  licenseSetMode?: (mode: 'FREE' | 'TRIAL') => Promise<LicenseStatusPayload>;
  openExternalUrl: (url: string) => Promise<boolean>;
}

export interface LicenseStatusPayload {
  tier: 'FREE' | 'TRIAL' | 'PRO';
  status: string;
  email?: string;
  plan?: string;
  licenseKeyMasked?: string;
  maxSeats?: number;
  offlineValidUntil?: number;
  currentPeriodEnd?: number;
  portalUrl: string;
  machineFingerprint: string;
  deviceName: string;
  trialDaysRemaining: number;
  trialEndsAt?: number;
  trialExpired?: boolean;
  trialAnchored?: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
