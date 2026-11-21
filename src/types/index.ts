export type EditorTool =
  | 'select'
  | 'hand'
  | 'text-edit'
  | 'text-add'
  | 'image-add'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'draw'
  | 'shape-rect'
  | 'shape-circle'
  | 'shape-arrow'
  | 'shape-line'
  | 'note'
  | 'stamp'
  | 'signature'
  | 'redact'
  | 'form-text'
  | 'form-checkbox'
  | 'form-radio'
  | 'form-dropdown'
  | 'form-date'
  | 'form-signature';

export type StampType =
  | 'APPROVED'
  | 'CONFIDENTIAL'
  | 'DRAFT'
  | 'REVISED'
  | 'FINAL'
  | 'SIGN_HERE'
  | 'VOID'
  | 'CUSTOM';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DigitalCertificateMeta {
  signerName: string;
  signerRole: string;
  reason: string;
  timestampIso: string;
  sha256: string;
}

export interface AnnotationItem {
  id: string;
  pageIndex: number;
  type:
    | 'highlight'
    | 'underline'
    | 'strikethrough'
    | 'freehand'
    | 'rectangle'
    | 'circle'
    | 'line'
    | 'arrow'
    | 'note'
    | 'stamp'
    | 'redaction';
  rect: Rect;
  color: string;
  opacity?: number;
  strokeWidth?: number;
  text?: string;
  points?: Point[];
  stampType?: StampType;
  stampLabel?: string;
  stampStyle?: 'classic' | 'solid' | 'outline';
  rotation?: number;
  showTimestamp?: boolean;
  certificateMeta?: DigitalCertificateMeta;
  author: string;
  createdAt: number;
  isPermanentRedaction?: boolean;
}

export interface TextItem {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  originalText?: string;
  fontSize: number;
  fontFamily: 'Helvetica' | 'TimesRoman' | 'Courier';
  color: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  lineHeight?: number;
  isRedactionReplacement?: boolean;
  boundingBox?: Rect;
}

export interface ImageItem {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  dataUrl: string;
  name: string;
  format: 'png' | 'jpeg';
}

export interface FormFieldItem {
  id: string;
  pageIndex: number;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'date' | 'signature';
  name: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string | boolean;
  defaultValue?: string;
  options?: string[];
  isRequired?: boolean;
}

export interface PDFPageMeta {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  timestamp: string;
  note: string;
  author: string;
  sizeBytes: number;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string;
  username?: string;
  action: string;
  documentName?: string;
  details: string;
  ipAddress?: string;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  defaultZoom: number;
  defaultFont: 'Helvetica' | 'TimesRoman' | 'Courier';
  defaultFontSize: number;
  defaultAnnotationColor: string;
  autoSaveIntervalSec: number;
  autoLockMinutes: number;
  enableAuditLogging: boolean;
  storageDirectory: string;
  backupDirectory: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  enableLocalAi: boolean;
  defaultOcrLang: string;
}

export interface ConvertedFileRecord {
  id: string;
  filename: string;
  sourceFormat: string;
  targetFormat: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  timestamp: string;
  fileSize: number;
  outputPath?: string;
  error?: string;
}
