import { create } from 'zustand';
import * as pdfjsLib from 'pdfjs-dist';
import {
  EditorTool,
  TextItem,
  ImageItem,
  AnnotationItem,
  FormFieldItem,
  PDFPageMeta,
} from '../types';
import { pdfEngine, WatermarkOptions, HeaderFooterOptions, SecurityOptions } from '../services/pdfEngine';
import { dbService } from '../services/db';

export type AppNavTab =
  | 'dashboard'
  | 'editor'
  | 'organize'
  | 'convert'
  | 'ocr'
  | 'signatures'
  | 'forms'
  | 'security'
  | 'history'
  | 'settings';

interface EditorState {
  activeTab: AppNavTab;
  setActiveTab: (tab: AppNavTab) => void;

  pdfBytes: Uint8Array | null;
  pdfDocProxy: pdfjsLib.PDFDocumentProxy | null;
  currentDocId: string;
  currentFileName: string;
  currentFilePath: string | null;
  pageCount: number;
  currentPage: number;
  zoom: number;
  rotation: number;
  pageMetas: PDFPageMeta[];

  // Tools & Selection
  activeTool: EditorTool;
  selectedItemId: string | null;
  selectedItemType: 'text' | 'image' | 'annotation' | 'form' | null;
  activeColor: string;
  activeFontSize: number;
  activeFontFamily: 'Helvetica' | 'TimesRoman' | 'Courier';
  activeStrokeWidth: number;
  activeOpacity: number;

  // Document Content Modifications
  textItems: TextItem[];
  imageItems: ImageItem[];
  annotations: AnnotationItem[];
  formFields: FormFieldItem[];
  watermark: WatermarkOptions;
  headerFooter: HeaderFooterOptions;
  security: SecurityOptions;

  // History & Status
  isDirty: boolean;
  isSaving: boolean;
  statusMessage: string;
  documentPassword: string | null;
  pendingPasswordPrompt: {
    bytes: Uint8Array;
    name: string;
    path?: string;
    isIncorrect: boolean;
    errorMessage?: string;
  } | null;
  cancelPendingPasswordPrompt: () => void;
  unlockPendingDocument: (password: string) => Promise<boolean>;

  undoStack: Array<{
    textItems: TextItem[];
    imageItems: ImageItem[];
    annotations: AnnotationItem[];
    formFields: FormFieldItem[];
  }>;
  redoStack: Array<{
    textItems: TextItem[];
    imageItems: ImageItem[];
    annotations: AnnotationItem[];
    formFields: FormFieldItem[];
  }>;

  // Actions
  loadPdfBytes: (bytes: Uint8Array, name?: string, path?: string, password?: string) => Promise<void>;
  createNewDocument: (pageSize?: 'A4' | 'Letter') => Promise<void>;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setActiveTool: (tool: EditorTool) => void;
  setActiveColor: (color: string) => void;
  setActiveFontSize: (size: number) => void;
  setActiveFontFamily: (font: 'Helvetica' | 'TimesRoman' | 'Courier') => void;
  setActiveStrokeWidth: (width: number) => void;
  setActiveOpacity: (opacity: number) => void;

  selectItem: (id: string | null, type?: 'text' | 'image' | 'annotation' | 'form' | null) => void;

  addTextItem: (item: Omit<TextItem, 'id'>) => void;
  updateTextItem: (id: string, updates: Partial<TextItem>) => void;
  deleteTextItem: (id: string) => void;

  addImageItem: (item: Omit<ImageItem, 'id'>) => void;
  updateImageItem: (id: string, updates: Partial<ImageItem>) => void;
  deleteImageItem: (id: string) => void;

  addAnnotation: (item: Omit<AnnotationItem, 'id' | 'createdAt' | 'author'> & { author?: string }) => void;
  updateAnnotation: (id: string, updates: Partial<AnnotationItem>) => void;
  deleteAnnotation: (id: string) => void;

  addFormField: (item: Omit<FormFieldItem, 'id'>) => void;
  updateFormField: (id: string, updates: Partial<FormFieldItem>) => void;
  deleteFormField: (id: string) => void;

  setWatermark: (wm: WatermarkOptions) => void;
  setHeaderFooter: (hf: HeaderFooterOptions) => void;
  setSecurity: (sec: SecurityOptions) => void;

  recordHistoryCheckpoint: () => void;
  undo: () => void;
  redo: () => void;

  isPropertiesOpen: boolean;
  toggleProperties: () => void;
  setPropertiesOpen: (open: boolean) => void;

  pendingSignatureTarget: {
    fieldId?: string;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  setPendingSignatureTarget: (
    target: {
      fieldId?: string;
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
    } | null
  ) => void;

  saveCurrentPdf: () => Promise<Uint8Array | null>;
  setStatusMessage: (msg: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  isPropertiesOpen: false,
  toggleProperties: () => set((state) => ({ isPropertiesOpen: !state.isPropertiesOpen })),
  setPropertiesOpen: (open: boolean) => set({ isPropertiesOpen: open }),

  pendingSignatureTarget: null,
  setPendingSignatureTarget: (target) => set({ pendingSignatureTarget: target }),

  pdfBytes: null,
  pdfDocProxy: null,
  currentDocId: 'doc_default',
  currentFileName: 'Untitled.pdf',
  currentFilePath: null,
  pageCount: 0,
  currentPage: 1,
  zoom: 1.0,
  rotation: 0,
  pageMetas: [],

  activeTool: 'select',
  selectedItemId: null,
  selectedItemType: null,
  activeColor: '#ffeb3b',
  activeFontSize: 14,
  activeFontFamily: 'Helvetica',
  activeStrokeWidth: 2,
  activeOpacity: 1,

  textItems: [],
  imageItems: [],
  annotations: [],
  formFields: [],
  watermark: { text: '' },
  headerFooter: {},
  security: {},

  isDirty: false,
  isSaving: false,
  statusMessage: 'Ready',
  documentPassword: null,
  pendingPasswordPrompt: null,
  undoStack: [],
  redoStack: [],

  cancelPendingPasswordPrompt: () => {
    set({ pendingPasswordPrompt: null, statusMessage: 'Password entry cancelled' });
  },

  unlockPendingDocument: async (password: string) => {
    const pending = get().pendingPasswordPrompt;
    if (!pending) return false;
    try {
      await get().loadPdfBytes(pending.bytes, pending.name, pending.path, password);
      return true;
    } catch {
      return false;
    }
  },

  loadPdfBytes: async (
    incomingBytes: Uint8Array,
    name: string = 'Document.pdf',
    path?: string,
    password?: string
  ) => {
    const bytes = new Uint8Array(incomingBytes);
    try {
      set({ statusMessage: 'Loading document...' });

      let proxy: any = null;
      // If encrypted and no password supplied yet, probe if password is required
      if (!password && pdfEngine.isPdfEncrypted(bytes)) {
        try {
          proxy = await pdfEngine.loadPdfJsDocument(bytes);
        } catch (pwErr: any) {
          set({
            pendingPasswordPrompt: {
              bytes,
              name,
              path,
              isIncorrect: false,
            },
            statusMessage: 'Secured document requires password to open',
          });
          return;
        }
      } else {
        proxy = await pdfEngine.loadPdfJsDocument(bytes, password);
      }

      const info = await pdfEngine.getDocumentInfo(bytes);

      const docId = `doc_${Date.now()}`;
      const prevActiveTab = get().activeTab;
      const prevCurrentPage = get().currentPage;
      const newPageCount = info.pageCount;
      const newCurrentPage = Math.max(1, Math.min(prevCurrentPage, newPageCount));

      set({
        pdfBytes: bytes,
        pdfDocProxy: proxy,
        documentPassword: password || null,
        pendingPasswordPrompt: null,
        currentDocId: docId,
        currentFileName: name,
        currentFilePath: path || null,
        pageCount: info.pageCount,
        currentPage: newCurrentPage,
        pageMetas: info.pages,
        textItems: [],
        imageItems: [],
        annotations: [],
        formFields: [],
        undoStack: [],
        redoStack: [],
        isDirty: false,
        statusMessage: `Loaded ${name} (${info.pageCount} pages)${password ? ' [Secured]' : ''}`,
        activeTab: prevActiveTab === 'dashboard' ? 'editor' : prevActiveTab,
      });

      // Save to recent documents in local DB
      dbService.saveDocument({
        id: docId,
        name,
        path,
        sizeBytes: bytes.byteLength,
        pageCount: info.pageCount,
        lastModified: Date.now(),
        isFavorite: false,
        tags: ['Recent'],
      });
    } catch (e: any) {
      console.error('[LOAD_PDF_ERROR]', e);
      if (
        e?.name === 'PasswordException' ||
        e?.message?.toLowerCase().includes('password') ||
        e?.code === 1 ||
        e?.code === 2
      ) {
        const isIncorrect = e?.code === 2 || Boolean(password);
        set({
          pendingPasswordPrompt: {
            bytes,
            name,
            path,
            isIncorrect,
            errorMessage: isIncorrect
              ? 'Incorrect password. Access denied.'
              : 'Password required to access secured document.',
          },
          statusMessage: isIncorrect ? 'Incorrect password' : 'Password required',
        });
        throw e;
      }
      set({ statusMessage: `Failed to load PDF: ${e.message}` });
      throw e;
    }
  },

  createNewDocument: async (pageSize = 'A4') => {
    try {
      set({ statusMessage: 'Creating new blank PDF...' });
      const bytes = await pdfEngine.createBlankDocument(pageSize, 1);
      await get().loadPdfBytes(bytes, 'New_Document.pdf');
      set({ statusMessage: 'Created new document' });
    } catch (err: any) {
      console.error('[CREATE_BLANK_ERROR]', err);
      set({ statusMessage: `Failed to create blank document: ${err.message}` });
    }
  },

  setCurrentPage: (page) => {
    const { pageCount } = get();
    const clamped = Math.max(1, Math.min(page, pageCount || 1));
    set({ currentPage: clamped });
  },

  setZoom: (zoom) => set({ zoom: Math.max(0.4, Math.min(3.0, zoom)) }),
  zoomIn: () => {
    const { zoom } = get();
    get().setZoom(zoom + 0.15);
  },
  zoomOut: () => {
    const { zoom } = get();
    get().setZoom(zoom - 0.15);
  },

  setActiveTool: (tool) =>
    set((state) => ({
      activeTool: tool,
      selectedItemId: tool === 'select' ? state.selectedItemId : null,
      selectedItemType: tool === 'select' ? state.selectedItemType : null,
    })),

  setActiveColor: (color) => {
    const { selectedItemId, selectedItemType, updateTextItem, updateAnnotation } = get();
    set({ activeColor: color });
    if (selectedItemId && selectedItemType === 'text') {
      updateTextItem(selectedItemId, { color });
    } else if (selectedItemId && selectedItemType === 'annotation') {
      updateAnnotation(selectedItemId, { color });
    }
  },

  setActiveFontSize: (size) => {
    const clamped = Math.max(6, Math.min(120, size));
    const { selectedItemId, selectedItemType, updateTextItem } = get();
    set({ activeFontSize: clamped });
    if (selectedItemId && selectedItemType === 'text') {
      updateTextItem(selectedItemId, { fontSize: clamped });
    }
  },

  setActiveFontFamily: (font) => {
    const { selectedItemId, selectedItemType, updateTextItem } = get();
    set({ activeFontFamily: font });
    if (selectedItemId && selectedItemType === 'text') {
      updateTextItem(selectedItemId, { fontFamily: font });
    }
  },

  setActiveStrokeWidth: (width) => {
    const { selectedItemId, selectedItemType, updateAnnotation } = get();
    set({ activeStrokeWidth: width });
    if (selectedItemId && selectedItemType === 'annotation') {
      updateAnnotation(selectedItemId, { strokeWidth: width });
    }
  },

  setActiveOpacity: (opacity) => {
    const { selectedItemId, selectedItemType, updateAnnotation, updateImageItem } = get();
    set({ activeOpacity: opacity });
    if (selectedItemId && selectedItemType === 'annotation') {
      updateAnnotation(selectedItemId, { opacity });
    } else if (selectedItemId && selectedItemType === 'image') {
      updateImageItem(selectedItemId, { opacity });
    }
  },

  selectItem: (id, type) => {
    if (!id || !type) {
      set({ selectedItemId: null, selectedItemType: null });
      return;
    }
    const state = get();
    const updates: Partial<EditorState> = {
      selectedItemId: id,
      selectedItemType: type,
    };
    if (type === 'text') {
      const txt = state.textItems.find((t) => t.id === id);
      if (txt) {
        updates.activeColor = txt.color || '#000000';
        updates.activeFontSize = txt.fontSize || 14;
        updates.activeFontFamily = txt.fontFamily || 'Helvetica';
      }
    } else if (type === 'annotation') {
      const ann = state.annotations.find((a) => a.id === id);
      if (ann) {
        if (ann.color) updates.activeColor = ann.color;
        if (ann.strokeWidth !== undefined) updates.activeStrokeWidth = ann.strokeWidth;
        if (ann.opacity !== undefined) updates.activeOpacity = ann.opacity;
      }
    } else if (type === 'image') {
      const img = state.imageItems.find((i) => i.id === id);
      if (img && img.opacity !== undefined) {
        updates.activeOpacity = img.opacity;
      }
    }
    set(updates);
  },

  recordHistoryCheckpoint: () => {
    const { textItems, imageItems, annotations, formFields, undoStack } = get();
    const snapshot = {
      textItems: JSON.parse(JSON.stringify(textItems)),
      imageItems: JSON.parse(JSON.stringify(imageItems)),
      annotations: JSON.parse(JSON.stringify(annotations)),
      formFields: JSON.parse(JSON.stringify(formFields)),
    };
    set({
      undoStack: [...undoStack.slice(-20), snapshot],
      redoStack: [],
      isDirty: true,
    });
  },

  undo: () => {
    const { undoStack, textItems, imageItems, annotations, formFields, redoStack } = get();
    if (undoStack.length === 0) return;

    const currentSnapshot = {
      textItems: JSON.parse(JSON.stringify(textItems)),
      imageItems: JSON.parse(JSON.stringify(imageItems)),
      annotations: JSON.parse(JSON.stringify(annotations)),
      formFields: JSON.parse(JSON.stringify(formFields)),
    };

    const previous = undoStack[undoStack.length - 1];
    set({
      textItems: previous.textItems,
      imageItems: previous.imageItems,
      annotations: previous.annotations,
      formFields: previous.formFields,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, currentSnapshot],
      isDirty: true,
      statusMessage: 'Undo applied',
    });
  },

  redo: () => {
    const { redoStack, textItems, imageItems, annotations, formFields, undoStack } = get();
    if (redoStack.length === 0) return;

    const currentSnapshot = {
      textItems: JSON.parse(JSON.stringify(textItems)),
      imageItems: JSON.parse(JSON.stringify(imageItems)),
      annotations: JSON.parse(JSON.stringify(annotations)),
      formFields: JSON.parse(JSON.stringify(formFields)),
    };

    const next = redoStack[redoStack.length - 1];
    set({
      textItems: next.textItems,
      imageItems: next.imageItems,
      annotations: next.annotations,
      formFields: next.formFields,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, currentSnapshot],
      isDirty: true,
      statusMessage: 'Redo applied',
    });
  },

  addTextItem: (item) => {
    get().recordHistoryCheckpoint();
    const newItem: TextItem = {
      ...item,
      id: `text_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    set((state) => ({
      textItems: [...state.textItems, newItem],
      selectedItemId: newItem.id,
      selectedItemType: 'text',
      statusMessage: 'Added text',
    }));
  },

  updateTextItem: (id, updates) => {
    const exists = get().textItems.some((t) => t.id === id);
    if (!exists) return;
    get().recordHistoryCheckpoint();
    set((state) => ({
      textItems: state.textItems.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },

  deleteTextItem: (id) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      textItems: state.textItems.filter((t) => t.id !== id),
      selectedItemId: null,
      selectedItemType: null,
    }));
  },

  addImageItem: (item) => {
    get().recordHistoryCheckpoint();
    const newImg: ImageItem = {
      ...item,
      id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    set((state) => ({
      imageItems: [...state.imageItems, newImg],
      activeTool: 'select',
      selectedItemId: newImg.id,
      selectedItemType: 'image',
      statusMessage: 'Inserted image',
    }));
  },

  updateImageItem: (id, updates) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      imageItems: state.imageItems.map((img) => (img.id === id ? { ...img, ...updates } : img)),
    }));
  },

  deleteImageItem: (id) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      imageItems: state.imageItems.filter((img) => img.id !== id),
      selectedItemId: null,
      selectedItemType: null,
    }));
  },

  addAnnotation: (item) => {
    get().recordHistoryCheckpoint();
    const newAnn: AnnotationItem = {
      ...item,
      id: `ann_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      author: item.author || 'NovaPDFPro User',
      createdAt: Date.now(),
    };
    set((state) => ({
      annotations: [...state.annotations, newAnn],
      activeTool: newAnn.type === 'stamp' ? 'select' : state.activeTool,
      selectedItemId: newAnn.id,
      selectedItemType: 'annotation',
      statusMessage: newAnn.type === 'stamp'
        ? `Inserted stamp "${newAnn.stampLabel || newAnn.stampType || 'STAMP'}"`
        : `Added ${newAnn.type}`,
    }));
  },

  updateAnnotation: (id, updates) => {
    const exists = get().annotations.some((a) => a.id === id);
    if (!exists) return;
    get().recordHistoryCheckpoint();
    set((state) => ({
      annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    }));
  },

  deleteAnnotation: (id) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
      selectedItemId: null,
      selectedItemType: null,
    }));
  },

  addFormField: (item) => {
    get().recordHistoryCheckpoint();
    const newField: FormFieldItem = {
      ...item,
      id: `field_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    set((state) => ({
      formFields: [...state.formFields, newField],
      selectedItemId: newField.id,
      selectedItemType: 'form',
      statusMessage: `Created form field: ${newField.name}`,
    }));
  },

  updateFormField: (id, updates) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      formFields: state.formFields.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  },

  deleteFormField: (id) => {
    get().recordHistoryCheckpoint();
    set((state) => ({
      formFields: state.formFields.filter((f) => f.id !== id),
      selectedItemId: null,
      selectedItemType: null,
    }));
  },

  setWatermark: (wm) => set({ watermark: wm, isDirty: true }),
  setHeaderFooter: (hf) => set({ headerFooter: hf, isDirty: true }),
  setSecurity: (sec) => set({ security: sec, isDirty: true }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),

  saveCurrentPdf: async () => {
    const {
      pdfBytes,
      textItems,
      imageItems,
      annotations,
      formFields,
      watermark,
      headerFooter,
      security,
      currentDocId,
      currentFileName,
    } = get();

    if (!pdfBytes) return null;

    const effectiveSecurity: SecurityOptions = {
      ...security,
      userPassword: security.userPassword || get().documentPassword || undefined,
    };
    const hasEncryption = Boolean(
      effectiveSecurity.userPassword || effectiveSecurity.ownerPassword
    );

    set({ isSaving: true, statusMessage: 'Compiling PDF modifications...' });
    try {
      const modifiedBytes = await pdfEngine.applyModifications(pdfBytes, {
        textItems,
        imageItems,
        annotations,
        formFields,
        watermark,
        headerFooter,
        security: hasEncryption ? effectiveSecurity : undefined,
      });

      // Reload updated proxy with password so preview is perfectly rendered
      const updatedProxy = await pdfEngine.loadPdfJsDocument(
        modifiedBytes,
        effectiveSecurity.userPassword
      );
      const info = await pdfEngine.getDocumentInfo(modifiedBytes);

      set({
        pdfBytes: modifiedBytes,
        pdfDocProxy: updatedProxy,
        documentPassword: effectiveSecurity.userPassword || null,
        pageCount: info.pageCount,
        pageMetas: info.pages,
        textItems: [],
        imageItems: [],
        annotations: [],
        formFields: [],
        watermark: { text: '' },
        headerFooter: {},
        isDirty: false,
        isSaving: false,
        statusMessage: `Document saved successfully${hasEncryption ? ' [Encrypted]' : ''}`,
      });

      // Create backup recovery checkpoint
      dbService.createVersion(currentDocId, 'User save checkpoint', modifiedBytes.byteLength);

      return modifiedBytes;
    } catch (e: any) {
      set({ isSaving: false, statusMessage: `Save error: ${e.message}` });
      return null;
    }
  },
}));
