import { AuditLogItem, DocumentVersion, AppSettings } from '../types';

export interface StoredDocument {
  id: string;
  name: string;
  path?: string;
  sizeBytes: number;
  pageCount: number;
  lastModified: number;
  isFavorite: boolean;
  tags: string[];
  thumbnail?: string;
  dataUrl?: string; // Stored base64 / blob
}

const STORAGE_KEYS = {
  DOCS: 'epdf_documents_v1',
  VERSIONS: 'epdf_versions_v1',
  AUDIT: 'epdf_audit_logs_v1',
  SETTINGS: 'epdf_settings_v1',
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultZoom: 1.0,
  defaultFont: 'Helvetica',
  defaultFontSize: 14,
  defaultAnnotationColor: '#ffeb3b',
  autoSaveIntervalSec: 60,
  autoLockMinutes: 15,
  enableAuditLogging: true,
  storageDirectory: '%LOCALAPPDATA%\\NovaPDFPro\\documents',
  backupDirectory: '%LOCALAPPDATA%\\NovaPDFPro\\backups',
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3',
  enableLocalAi: true,
  defaultOcrLang: 'eng',
};

class LocalDatabaseService {
  private inMemoryCache: Map<string, any> = new Map();

  constructor() {
    this.initDefaults();
  }

  private initDefaults() {
    if (!this.getItem(STORAGE_KEYS.SETTINGS)) {
      this.setItem(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    }
    if (!this.getItem(STORAGE_KEYS.DOCS)) {
      this.setItem(STORAGE_KEYS.DOCS, []);
    }
    if (!this.getItem(STORAGE_KEYS.AUDIT)) {
      this.setItem(STORAGE_KEYS.AUDIT, [
        {
          id: 'audit_init',
          timestamp: new Date().toISOString(),
          userId: 'local_session',
          username: 'local_session',
          action: 'SYSTEM_STARTUP',
          documentName: 'System',
          details: 'NovaPDFPro offline engine initialized.',
        },
      ]);
    }
  }

  private getItem<T>(key: string): T | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key);
        return val ? JSON.parse(val) : null;
      }
    } catch {
      // Fallback to memory
    }
    return this.inMemoryCache.get(key) || null;
  }

  private setItem<T>(key: string, value: T): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) {
      console.warn('LocalStorage quota or access restriction, caching in memory', e);
    }
    this.inMemoryCache.set(key, value);
  }

  // --- Document Methods ---
  public getDocuments(): StoredDocument[] {
    return this.getItem<StoredDocument[]>(STORAGE_KEYS.DOCS) || [];
  }

  public getDocumentById(id: string): StoredDocument | undefined {
    const docs = this.getDocuments();
    return docs.find((d) => d.id === id);
  }

  public saveDocument(doc: StoredDocument): void {
    const docs = this.getDocuments();
    const normPath = doc.path ? doc.path.trim().toLowerCase() : null;
    const existingIndex = docs.findIndex(
      (d) =>
        d.id === doc.id ||
        (normPath && d.path && d.path.trim().toLowerCase() === normPath)
    );
    const updatedDoc: StoredDocument = {
      ...doc,
      isFavorite: existingIndex >= 0 ? docs[existingIndex].isFavorite || doc.isFavorite : doc.isFavorite,
      lastModified: Date.now(),
    };
    const filtered = docs.filter((_, i) => i !== existingIndex);
    filtered.unshift(updatedDoc);
    this.setItem(STORAGE_KEYS.DOCS, filtered.slice(0, 100));
    this.logAudit('SAVE_DOCUMENT', `Saved document: ${doc.name}`, doc.name);
  }

  public deleteDocument(id: string): void {
    const docs = this.getDocuments();
    const target = docs.find((d) => d.id === id);
    const updated = docs.filter((d) => d.id !== id);
    this.setItem(STORAGE_KEYS.DOCS, updated);
    if (target) {
      this.logAudit('DELETE_DOCUMENT', `Removed from recents: ${target.name}`, target.name);
    }
  }

  public clearDocuments(): void {
    this.setItem(STORAGE_KEYS.DOCS, []);
    this.logAudit('CLEAR_RECENT_DOCUMENTS', 'Cleared all recent documents records');
  }

  public toggleFavorite(id: string): void {
    const docs = this.getDocuments();
    const doc = docs.find((d) => d.id === id);
    if (doc) {
      doc.isFavorite = !doc.isFavorite;
      this.setItem(STORAGE_KEYS.DOCS, docs);
    }
  }

  // --- Versioning & Backups ---
  public getVersions(docId: string): DocumentVersion[] {
    const all = this.getItem<DocumentVersion[]>(STORAGE_KEYS.VERSIONS) || [];
    return all.filter((v) => v.documentId === docId).sort((a, b) => b.versionNumber - a.versionNumber);
  }

  public createVersion(docId: string, note: string, sizeBytes: number): DocumentVersion {
    const all = this.getItem<DocumentVersion[]>(STORAGE_KEYS.VERSIONS) || [];
    const docVersions = all.filter((v) => v.documentId === docId);
    const newVersion: DocumentVersion = {
      id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      documentId: docId,
      versionNumber: docVersions.length + 1,
      timestamp: new Date().toISOString(),
      note: note || `Version checkpoint ${docVersions.length + 1}`,
      author: 'NovaPDFPro User',
      sizeBytes,
    };
    all.push(newVersion);
    this.setItem(STORAGE_KEYS.VERSIONS, all);
    this.logAudit('CREATE_VERSION', `Created recovery checkpoint v${newVersion.versionNumber}`);
    return newVersion;
  }

  // --- Audit Logs ---
  public getAuditLogs(): AuditLogItem[] {
    return this.getItem<AuditLogItem[]>(STORAGE_KEYS.AUDIT) || [];
  }

  public logAudit(action: string, details: string, documentName?: string): void {
    const logs = this.getAuditLogs();
    const newLog: AuditLogItem = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId: 'local_session',
      username: 'local_session',
      action,
      documentName,
      details,
    };
    logs.unshift(newLog);
    // Retain up to 2000 log items
    if (logs.length > 2000) logs.pop();
    this.setItem(STORAGE_KEYS.AUDIT, logs);
  }

  // --- Settings ---
  public getSettings(): AppSettings {
    return this.getItem<AppSettings>(STORAGE_KEYS.SETTINGS) || DEFAULT_SETTINGS;
  }

  public updateSettings(settings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    this.setItem(STORAGE_KEYS.SETTINGS, updated);
    this.logAudit('SETTINGS_UPDATE', 'Updated application configuration');
    return updated;
  }
}

export const dbService = new LocalDatabaseService();
