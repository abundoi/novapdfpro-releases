import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Save,
  Download,
  FilePlus,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  MousePointer,
  Hand,
  Type,
  Image as ImageIcon,
  Highlighter,
  Underline,
  Strikethrough,
  PenTool,
  Square,
  Circle,
  Minus,
  ArrowRight,
  MessageSquare,
  Stamp,
  FileSignature,
  CheckSquare,
  Calendar,
  Lock,
  Eraser,
  Sparkles,
  Layers,
  SlidersHorizontal,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RotateCw,
  Trash2,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useLicenseStore, PRO_FEATURE_LABELS, type ProFeatureKey } from '../stores/licenseStore';
import { EditorTool } from '../types';
import { STAMP_TEMPLATES, StampTemplate, calculateStampDimensions } from '../constants/stamps';
import {
  loadSavedSignatures,
  SavedSignatureItem,
  fitSignatureDimensions,
} from '../services/signatureService';
import { dbService } from '../services/db';

interface ToolbarProps {
  onOpenAi: () => void;
  onOpenWatermarkModal: () => void;
  onOpenHeaderFooterModal: () => void;
  onOpenPasswordModal: () => void;
  onOpenSignatureModal: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onOpenAi,
  onOpenWatermarkModal,
  onOpenHeaderFooterModal,
  onOpenPasswordModal,
  onOpenSignatureModal,
}) => {
  const {
    pdfBytes,
    currentFileName,
    currentPage,
    pageCount,
    zoom,
    activeTool,
    activeColor,
    activeFontSize,
    activeFontFamily,
    activeStrokeWidth,
    selectedItemId,
    selectedItemType,
    textItems,
    imageItems,
    annotations,
    formFields,
    watermark,
    headerFooter,
    security,
    isDirty,
    undoStack,
    redoStack,
    loadPdfBytes,
    createNewDocument,
    saveCurrentPdf,
    setStatusMessage,
    setCurrentPage,
    zoomIn,
    zoomOut,
    setZoom,
    setActiveTool,
    setActiveColor,
    setActiveFontSize,
    setActiveFontFamily,
    setActiveStrokeWidth,
    selectItem,
    addTextItem,
    updateTextItem,
    deleteTextItem,
    updateImageItem,
    deleteImageItem,
    updateAnnotation,
    deleteAnnotation,
    deleteFormField,
    undo,
    redo,
    addAnnotation,
    addImageItem,
    isPropertiesOpen,
    toggleProperties,
  } = useEditorStore();

  const { hasEntitlement, openLicenseModal } = useLicenseStore();
  const guardPro = (feature: ProFeatureKey, action: () => void) => {
    if (!hasEntitlement(feature)) {
      openLicenseModal(PRO_FEATURE_LABELS[feature]);
      return;
    }
    action();
  };

  const selectedText = selectedItemType === 'text' ? textItems.find((t) => t.id === selectedItemId) : undefined;
  const selectedImage = selectedItemType === 'image' ? imageItems.find((i) => i.id === selectedItemId) : undefined;
  const selectedAnnotation = selectedItemType === 'annotation' ? annotations.find((a) => a.id === selectedItemId) : undefined;
  const selectedForm = selectedItemType === 'form' ? formFields.find((f) => f.id === selectedItemId) : undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const stampsMenuRef = useRef<HTMLDivElement>(null);
  const sigMenuRef = useRef<HTMLDivElement>(null);
  const [showStampsDropdown, setShowStampsDropdown] = useState(false);
  const [showSigDropdown, setShowSigDropdown] = useState(false);
  const [savedSigQuickList, setSavedSigQuickList] = useState<SavedSignatureItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<'edit' | 'annotate' | 'forms' | 'protect'>('edit');
  const [justSaved, setJustSaved] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSavingNewFile, setIsSavingNewFile] = useState(false);

  const buildEditedFileName = (name: string) => {
    const clean = (name || 'Document.pdf').replace(/\.pdf$/i, '');
    return `${clean.endsWith('_edited') ? clean : `${clean}_edited`}.pdf`;
  };

  const handleSaveAsNewFile = async () => {
    setIsSavingNewFile(true);
    try {
      const saved = await saveCurrentPdf();
      if (!saved) return;

      const defaultNewName = buildEditedFileName(currentFileName);
      if (window.electronAPI) {
        const res = await window.electronAPI.savePdfDialog({
          defaultName: defaultNewName,
          data: saved,
        });
        if (res?.success && res.filePath) {
          const savedName = res.filePath.split(/[\\/]/).pop() || defaultNewName;
          await useEditorStore.getState().loadPdfBytes(saved, savedName, res.filePath);
          setStatusMessage(`Saved updated PDF as new file: ${savedName}`);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2500);
          setShowSaveModal(false);
        } else {
          setStatusMessage('Updates applied in session (Save as New File canceled)');
          setShowSaveModal(false);
        }
      } else {
        const blob = new Blob([saved as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultNewName;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMessage(`Saved updated PDF as new file: ${defaultNewName}`);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        setShowSaveModal(false);
      }
    } finally {
      setIsSavingNewFile(false);
    }
  };

  const handleApplySessionOnly = async () => {
    const res = await saveCurrentPdf();
    if (res) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2200);
      setShowSaveModal(false);
    }
  };

  const handleSaveChanges = () => {
    if (!pdfBytes) return;
    setShowSaveModal(true);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        const activeTab = useEditorStore.getState().activeTab;
        if (activeTab !== 'editor' || !useEditorStore.getState().pdfBytes) return;
        e.preventDefault();
        const lic = useLicenseStore.getState();
        if (!lic.hasEntitlement('text_edit')) {
          lic.openLicenseModal(PRO_FEATURE_LABELS.text_edit);
          return;
        }
        setShowSaveModal(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!showStampsDropdown) return;
    const handleOutside = (e: MouseEvent) => {
      if (stampsMenuRef.current && !stampsMenuRef.current.contains(e.target as Node)) {
        setShowStampsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showStampsDropdown]);

  useEffect(() => {
    if (!showSigDropdown) return;
    setSavedSigQuickList(loadSavedSignatures());
    const handleOutside = (e: MouseEvent) => {
      if (sigMenuRef.current && !sigMenuRef.current.contains(e.target as Node)) {
        setShowSigDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showSigDropdown]);

  // Handle open document
  const handleOpenClick = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openPdfDialog();
      if (res) {
        await loadPdfBytes(new Uint8Array(res.data), res.name, res.filePath);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      await loadPdfBytes(new Uint8Array(buffer), file.name);
    }
  };

  // Handle Save As New File (direct export)
  const handleExport = () => guardPro('text_edit', () => void handleSaveAsNewFile());

  // Handle Image upload into canvas
  const handleInsertImage = () => {
    imgInputRef.current?.click();
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          const imgObj = new Image();
          imgObj.onload = () => {
            const natW = imgObj.naturalWidth || 180;
            const natH = imgObj.naturalHeight || 120;
            const maxW = 200;
            const ratio = natW > maxW ? maxW / natW : 1;
            addImageItem({
              pageIndex: currentPage - 1,
              x: 100,
              y: 150,
              width: Math.max(40, Math.round(natW * ratio)),
              height: Math.max(40, Math.round(natH * ratio)),
              dataUrl,
              name: file.name,
              format: file.type.includes('png') ? 'png' : 'jpeg',
              opacity: 1,
            });
          };
          imgObj.onerror = () => {
            addImageItem({
              pageIndex: currentPage - 1,
              x: 100,
              y: 150,
              width: 180,
              height: 120,
              dataUrl,
              name: file.name,
              format: file.type.includes('png') ? 'png' : 'jpeg',
              opacity: 1,
            });
          };
          imgObj.src = dataUrl;
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleAddStamp = (stamp: StampTemplate) => {
    const dims = calculateStampDimensions(stamp.label, true);
    addAnnotation({
      pageIndex: currentPage - 1,
      type: 'stamp',
      rect: { x: 140, y: 160, width: dims.width, height: dims.height },
      color: stamp.color,
      stampType: stamp.type,
      stampLabel: stamp.label,
      stampStyle: stamp.defaultStyle,
      rotation: stamp.defaultRotation,
      showTimestamp: true,
      opacity: 0.95,
    });
    setShowStampsDropdown(false);
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-slate-200 select-none z-30">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="application/pdf"
        className="hidden"
      />
      <input
        type="file"
        ref={imgInputRef}
        onChange={handleImageInputChange}
        accept="image/png, image/jpeg"
        className="hidden"
      />

      {/* Row 1: Primary Actions, History & View Controls */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-slate-800/80 text-xs">
        {/* Left: File actions */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => guardPro('text_add', () => createNewDocument('A4'))}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            title="Create New Blank PDF"
          >
            <FilePlus className="w-3.5 h-3.5 text-brand-400" />
            <span>New</span>
          </button>

          <button
            onClick={handleOpenClick}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            title="Open Local PDF File"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Open</span>
          </button>

          <button
            onClick={() => guardPro('text_edit', handleSaveChanges)}
            disabled={!pdfBytes}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-semibold transition-colors disabled:opacity-40 ${
              justSaved
                ? 'bg-emerald-600 text-white border border-emerald-500'
                : 'bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-500/60 shadow-sm'
            }`}
            title="Save All Updates (Ctrl+S — Recommended: Save as New File)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{justSaved ? 'Saved!' : 'Save'}</span>
          </button>

          <button
            onClick={handleExport}
            disabled={!pdfBytes}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            title="Save Updated Document as a New PDF File (Recommended)"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Save As</span>
          </button>

          {!hasEntitlement('text_edit') && (
            <button
              type="button"
              onClick={() => openLicenseModal('Edit PDFs (Currently Free Read-Only)')}
              className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-semibold hover:bg-amber-500/25 transition-colors"
              title="Read-Only Mode — Activate Pro to edit or save changes"
            >
              READ-ONLY
            </button>
          )}

          <div className="h-4 w-px bg-slate-700 mx-1" />

          {/* Undo / Redo */}
          <button
            onClick={() => guardPro('text_edit', undo)}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => guardPro('text_edit', redo)}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30"
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Center: Tool Category Tabs */}
        <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60">
          <button
            onClick={() => setActiveCategory('edit')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activeCategory === 'edit'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Edit PDF
          </button>
          <button
            onClick={() => setActiveCategory('annotate')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activeCategory === 'annotate'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Annotate & Mark
          </button>
          <button
            onClick={() => setActiveCategory('forms')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activeCategory === 'forms'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign & Forms
          </button>
          <button
            onClick={() => setActiveCategory('protect')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activeCategory === 'protect'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Protect & Redact
          </button>
        </div>

        {/* Right: Page Navigation & Zoom Controls */}
        <div className="flex items-center space-x-2">
          {pdfBytes && (
            <div className="flex items-center space-x-1 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                title="Previous Page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-slate-200">
                {currentPage} / {pageCount}
              </span>
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                title="Next Page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center space-x-1 bg-slate-800 px-1 py-0.5 rounded border border-slate-700">
            <button
              onClick={zoomOut}
              className="p-1 text-slate-400 hover:text-slate-100"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-200 font-mono text-[11px] px-1">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="p-1 text-slate-400 hover:text-slate-100"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom(1.0)}
              className="p-1 text-slate-400 hover:text-slate-100"
              title="Actual Size (100%)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={toggleProperties}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all ${
              isPropertiesOpen
                ? 'bg-brand-600 text-white border-brand-500 shadow-sm'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750 hover:text-white'
            }`}
            title="Toggle Properties Inspector"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Inspector</span>
          </button>
        </div>
      </div>

      {/* Row 2: Sub-tools based on selected category */}
      <div className="h-11 px-3 flex items-center justify-between text-xs bg-slate-850">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {/* Universal Selection & Hand Tools */}
          <button
            onClick={() => setActiveTool('select')}
            className={`p-2 rounded flex items-center space-x-1 transition-colors ${
              activeTool === 'select'
                ? 'bg-brand-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title="Selection Tool (V)"
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>Select</span>
          </button>

          <button
            onClick={() => setActiveTool('hand')}
            className={`p-2 rounded flex items-center space-x-1 transition-colors ${
              activeTool === 'hand'
                ? 'bg-brand-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title="Hand / Pan Tool (H)"
          >
            <Hand className="w-3.5 h-3.5" />
            <span>Pan</span>
          </button>

          <div className="h-5 w-px bg-slate-700 mx-1" />

          {/* EDIT CATEGORY TOOLS */}
          {activeCategory === 'edit' && (
            <>
              <button
                onClick={() => guardPro('text_edit', () => setActiveTool('text-edit'))}
                className={`p-2 rounded flex items-center space-x-1.5 transition-colors ${
                  activeTool === 'text-edit'
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Edit Existing Text in PDF (Click on text to modify content)"
              >
                <Type className="w-3.5 h-3.5 text-sky-400" />
                <span>Edit Existing Text</span>
                {!hasEntitlement('text_edit') && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    PRO
                  </span>
                )}
              </button>

              <button
                onClick={() => guardPro('text_add', () => setActiveTool('text-add'))}
                className={`p-2 rounded flex items-center space-x-1.5 transition-colors ${
                  activeTool === 'text-add'
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add New Text (Click anywhere to insert)"
              >
                <Type className="w-3.5 h-3.5 text-emerald-400" />
                <span>Add Text</span>
                {!hasEntitlement('text_add') && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    PRO
                  </span>
                )}
              </button>

              <button
                onClick={() => guardPro('image_add', handleInsertImage)}
                className="p-2 rounded flex items-center space-x-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                title="Insert PNG or JPG Image into PDF"
              >
                <ImageIcon className="w-3.5 h-3.5 text-violet-400" />
                <span>Insert Image</span>
                {!hasEntitlement('image_add') && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                    PRO
                  </span>
                )}
              </button>
            </>
          )}

          {/* ANNOTATE CATEGORY TOOLS */}
          {activeCategory === 'annotate' && (
            <>
              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (selectedText) {
                      const estWidth = Math.max(40, selectedText.text.length * selectedText.fontSize * 0.55);
                      addAnnotation({
                        pageIndex: selectedText.pageIndex,
                        type: 'highlight',
                        rect: {
                          x: selectedText.x,
                          y: selectedText.y,
                          width: estWidth,
                          height: selectedText.fontSize * 1.25,
                        },
                        color: '#ffeb3b',
                        opacity: 0.35,
                      });
                      return;
                    }
                    setActiveTool('highlight');
                    setActiveColor('#ffeb3b');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'highlight'
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Highlight Tool (Applies to selected text or click/drag on page)"
              >
                <Highlighter className="w-3.5 h-3.5 text-yellow-400" />
                <span>Highlight</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (selectedText) {
                      updateTextItem(selectedText.id, { isUnderline: !selectedText.isUnderline });
                      return;
                    }
                    if (activeColor === '#ffeb3b') setActiveColor('#2563eb');
                    setActiveTool('underline');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'underline' || selectedText?.isUnderline
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Underline Tool (Applies to selected text or click/drag on page)"
              >
                <Underline className="w-3.5 h-3.5" />
                <span>Underline</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (selectedText) {
                      const estWidth = Math.max(40, selectedText.text.length * selectedText.fontSize * 0.55);
                      addAnnotation({
                        pageIndex: selectedText.pageIndex,
                        type: 'strikethrough',
                        rect: {
                          x: selectedText.x,
                          y: selectedText.y,
                          width: estWidth,
                          height: selectedText.fontSize * 1.25,
                        },
                        color: '#ef4444',
                        strokeWidth: activeStrokeWidth || 2,
                        opacity: 1,
                      });
                      return;
                    }
                    if (activeColor === '#ffeb3b') setActiveColor('#ef4444');
                    setActiveTool('strikethrough');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'strikethrough'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Strikethrough Tool (Applies to selected text or click/drag on page)"
              >
                <Strikethrough className="w-3.5 h-3.5" />
                <span>Strike</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (activeColor === '#ffeb3b') setActiveColor('#ef4444');
                    setActiveTool('draw');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'draw'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Freehand Ink Drawing"
              >
                <PenTool className="w-3.5 h-3.5 text-rose-400" />
                <span>Draw</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (activeColor === '#ffeb3b') setActiveColor('#2563eb');
                    setActiveTool('shape-rect');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'shape-rect'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Rectangle"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Box</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (activeColor === '#ffeb3b') setActiveColor('#2563eb');
                    setActiveTool('shape-circle');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'shape-circle'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Circle / Ellipse"
              >
                <Circle className="w-3.5 h-3.5" />
                <span>Circle</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (activeColor === '#ffeb3b') setActiveColor('#111827');
                    setActiveTool('shape-line');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'shape-line'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Straight Line (Hold Shift to snap 45°)"
              >
                <Minus className="w-3.5 h-3.5" />
                <span>Line</span>
              </button>

              <button
                onClick={() =>
                  guardPro('text_edit', () => {
                    if (activeColor === '#ffeb3b') setActiveColor('#111827');
                    setActiveTool('shape-arrow');
                  })
                }
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'shape-arrow'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Arrow (Hold Shift to snap 45°)"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Arrow</span>
              </button>

              <button
                onClick={() => guardPro('text_edit', () => setActiveTool('note'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'note'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Sticky Note / Comment"
              >
                <MessageSquare className="w-3.5 h-3.5 text-amber-300" />
                <span>Note</span>
              </button>

              {/* Stamps Tool with Floating Dropdown and Quick Menu */}
              <div ref={stampsMenuRef} className="relative flex items-center">
                <button
                  onClick={() =>
                    guardPro('stamps', () => {
                      setActiveTool('stamp');
                      setShowStampsDropdown(false);
                    })
                  }
                  className={`p-2 rounded-l flex items-center space-x-1.5 transition-colors ${
                    activeTool === 'stamp'
                      ? 'bg-brand-600 text-white font-medium'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                  title="Stamp Tool (Click anywhere on page to open floating stamp list)"
                >
                  <Stamp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Stamp</span>
                  {!hasEntitlement('stamps') && (
                    <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                      PRO
                    </span>
                  )}
                </button>
                <button
                  onClick={() => guardPro('stamps', () => setShowStampsDropdown((prev) => !prev))}
                  className={`px-1.5 py-2 rounded-r border-l border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors ${
                    activeTool === 'stamp' || showStampsDropdown
                      ? 'bg-brand-600 text-white border-brand-500'
                      : ''
                  }`}
                  title="Quick Insert Stamp Preset"
                >
                  <span className="text-[10px]">▾</span>
                </button>

                {showStampsDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-1.5 space-y-1">
                    <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                      Quick Insert Stamp
                    </div>
                    {STAMP_TEMPLATES.map((st) => (
                      <button
                        key={`${st.type}_${st.label}`}
                        onClick={() => handleAddStamp(st)}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-800 flex items-center justify-between transition-colors"
                      >
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase"
                          style={{
                            color: st.defaultStyle === 'solid' ? '#ffffff' : st.color,
                            backgroundColor:
                              st.defaultStyle === 'solid' ? st.color : 'transparent',
                            border: `1.5px solid ${st.color}`,
                          }}
                        >
                          {st.label}
                        </span>
                        <span className="text-[10px] text-slate-500">Insert</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* FORMS & SIGNATURES TOOLS */}
          {activeCategory === 'forms' && (
            <>
              <div ref={sigMenuRef} className="relative flex items-center">
                <button
                  onClick={() => {
                    setShowSigDropdown(false);
                    onOpenSignatureModal();
                  }}
                  className="p-2 rounded-l flex items-center space-x-1.5 text-brand-300 bg-brand-600/20 border border-brand-500/40 hover:bg-brand-600/30 transition-colors font-medium"
                  title="Open Electronic & Digital Signature Studio"
                >
                  <FileSignature className="w-3.5 h-3.5 text-brand-400" />
                  <span>Add Signature</span>
                </button>
                <button
                  onClick={() => guardPro('signatures', () => setShowSigDropdown((prev) => !prev))}
                  className="px-1.5 py-2 rounded-r border border-l-0 border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 hover:text-white transition-colors"
                  title="Quick Insert Saved Signature"
                >
                  <span className="text-[10px]">▾</span>
                </button>

                {showSigDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-2 space-y-2">
                    <div className="px-1.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
                      <span>Saved Signatures</span>
                      <button
                        onClick={() => {
                          setShowSigDropdown(false);
                          onOpenSignatureModal();
                        }}
                        className="text-brand-400 hover:text-brand-300 normal-case"
                      >
                        Open Studio →
                      </button>
                    </div>
                    {savedSigQuickList.length === 0 ? (
                      <div className="px-2 py-3 text-center text-[11px] text-slate-400">
                        No saved signatures yet. Click <strong>Open Studio</strong> to draw, type, or import one.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {savedSigQuickList.map((sig) => (
                          <button
                            key={sig.id}
                            onClick={() => {
                              const dims = fitSignatureDimensions(sig.width, sig.height, 180, 75);
                              addImageItem({
                                pageIndex: currentPage - 1,
                                x: 100,
                                y: 420,
                                width: dims.width,
                                height: dims.height,
                                dataUrl: sig.dataUrl,
                                name: `Signature_${sig.label.replace(/\s+/g, '_')}.png`,
                                format: 'png',
                                opacity: 1,
                              });
                              setShowSigDropdown(false);
                            }}
                            className="w-full p-2 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800 flex items-center justify-between space-x-2 transition-colors"
                          >
                            <div className="w-24 h-9 bg-white rounded flex items-center justify-center p-1 shrink-0">
                              <img
                                src={sig.dataUrl}
                                alt={sig.label}
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                            <span className="text-[11px] text-slate-300 truncate flex-1 text-left">
                              {sig.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => guardPro('signatures', () => setActiveTool('form-signature'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'form-signature'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Place Interactive Signature Field Placeholder"
              >
                <FileSignature className="w-3.5 h-3.5 text-sky-400" />
                <span>Sign Field</span>
              </button>

              <button
                onClick={() => guardPro('text_add', () => setActiveTool('form-text'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'form-text'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add Text Input Field"
              >
                <Type className="w-3.5 h-3.5" />
                <span>Text Field</span>
              </button>

              <button
                onClick={() => guardPro('text_add', () => setActiveTool('form-checkbox'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'form-checkbox'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add Checkbox Field"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>Checkbox</span>
              </button>

              <button
                onClick={() => guardPro('text_add', () => setActiveTool('form-dropdown'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'form-dropdown'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add Dropdown Field"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Dropdown</span>
              </button>

              <button
                onClick={() => guardPro('text_add', () => setActiveTool('form-date'))}
                className={`p-2 rounded flex items-center space-x-1 transition-colors ${
                  activeTool === 'form-date'
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add Date Field"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Date Field</span>
              </button>
            </>
          )}

          {/* PROTECT & REDACT TOOLS */}
          {activeCategory === 'protect' && (
            <>
              <button
                onClick={() => guardPro('security', () => setActiveTool('redact'))}
                className={`p-2 rounded flex items-center space-x-1.5 transition-colors ${
                  activeTool === 'redact'
                    ? 'bg-red-600 text-white font-medium'
                    : 'text-red-300 hover:bg-red-950/40'
                }`}
                title="Mark Area for Permanent Redaction (Burn-in black block and remove data)"
              >
                <Eraser className="w-3.5 h-3.5 text-red-400" />
                <span>Permanent Redaction</span>
              </button>

              <button
                onClick={onOpenWatermarkModal}
                className={`p-2 rounded flex items-center space-x-1.5 transition-colors ${
                  watermark?.text?.trim()
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 font-medium'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title={
                  watermark?.text?.trim()
                    ? `Active Watermark: "${watermark.text}" (Click to edit or remove)`
                    : 'Add Watermark to Document'
                }
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Watermark</span>
                {watermark?.text?.trim() && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={onOpenHeaderFooterModal}
                className={`p-2 rounded flex items-center space-x-1.5 transition-colors ${
                  headerFooter?.headerLeft ||
                  headerFooter?.headerCenter ||
                  headerFooter?.headerRight ||
                  headerFooter?.footerLeft ||
                  headerFooter?.footerCenter ||
                  headerFooter?.footerRight
                    ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40 font-medium'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title="Add Headers, Footers and Dynamic Page Numbers"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Header & Footer</span>
                {(headerFooter?.headerLeft ||
                  headerFooter?.headerCenter ||
                  headerFooter?.headerRight ||
                  headerFooter?.footerLeft ||
                  headerFooter?.footerCenter ||
                  headerFooter?.footerRight) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={onOpenPasswordModal}
                className="p-2 rounded flex items-center space-x-1 text-slate-300 hover:bg-slate-800"
                title="Set Password and Permissions"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Password Encrypt</span>
              </button>
            </>
          )}
        </div>

        {/* Contextual Selection & Active Tool Operations Bar */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* 1. SELECTED TEXT OR TEXT TOOL CONTROLS */}
          {(selectedText || activeTool === 'text-add' || activeTool === 'text-edit') && (
            <div className="flex items-center space-x-1.5 bg-slate-800/90 px-2 py-1 rounded border border-slate-700">
              {selectedText && (
                <span className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider px-1 border-r border-slate-700">
                  Text Selected
                </span>
              )}
              <select
                value={selectedText ? selectedText.fontFamily : activeFontFamily}
                onChange={(e) => setActiveFontFamily(e.target.value as any)}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none"
                title="Font Family"
              >
                <option value="Helvetica">Helvetica</option>
                <option value="TimesRoman">Times Roman</option>
                <option value="Courier">Courier</option>
              </select>

              <div className="flex items-center bg-slate-900 border border-slate-700 rounded">
                <button
                  onClick={() =>
                    setActiveFontSize((selectedText ? selectedText.fontSize : activeFontSize) - 2)
                  }
                  className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                  title="Decrease Font Size"
                >
                  -
                </button>
                <span className="px-1 text-[11px] font-mono text-slate-200">
                  {selectedText ? selectedText.fontSize : activeFontSize}pt
                </span>
                <button
                  onClick={() =>
                    setActiveFontSize((selectedText ? selectedText.fontSize : activeFontSize) + 2)
                  }
                  className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                  title="Increase Font Size"
                >
                  +
                </button>
              </div>

              {selectedText && (
                <>
                  <button
                    onClick={() =>
                      updateTextItem(selectedText.id, { isBold: !selectedText.isBold })
                    }
                    className={`p-1 rounded border ${
                      selectedText.isBold
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Bold"
                  >
                    <Bold className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() =>
                      updateTextItem(selectedText.id, { isItalic: !selectedText.isItalic })
                    }
                    className={`p-1 rounded border ${
                      selectedText.isItalic
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Italic"
                  >
                    <Italic className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() =>
                      updateTextItem(selectedText.id, { isUnderline: !selectedText.isUnderline })
                    }
                    className={`p-1 rounded border ${
                      selectedText.isUnderline
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Underline"
                  >
                    <Underline className="w-3 h-3" />
                  </button>

                  <div className="h-3 w-px bg-slate-700 mx-0.5" />

                  <button
                    onClick={() => updateTextItem(selectedText.id, { align: 'left' })}
                    className={`p-1 rounded border ${
                      !selectedText.align || selectedText.align === 'left'
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Align Left"
                  >
                    <AlignLeft className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => updateTextItem(selectedText.id, { align: 'center' })}
                    className={`p-1 rounded border ${
                      selectedText.align === 'center'
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Align Center"
                  >
                    <AlignCenter className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => updateTextItem(selectedText.id, { align: 'right' })}
                    className={`p-1 rounded border ${
                      selectedText.align === 'right'
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                    title="Align Right"
                  >
                    <AlignRight className="w-3 h-3" />
                  </button>
                </>
              )}

              <input
                type="color"
                value={selectedText ? selectedText.color : activeColor}
                onChange={(e) => setActiveColor(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer border border-slate-600 bg-transparent"
                title="Text Color"
              />

              {selectedText && (
                <>
                  <button
                    onClick={() =>
                      addTextItem({
                        pageIndex: selectedText.pageIndex,
                        x: selectedText.x + 15,
                        y: selectedText.y + 15,
                        text: selectedText.text,
                        fontSize: selectedText.fontSize,
                        fontFamily: selectedText.fontFamily,
                        color: selectedText.color,
                        isBold: selectedText.isBold,
                        isItalic: selectedText.isItalic,
                        isUnderline: selectedText.isUnderline,
                      })
                    }
                    className="p-1 rounded bg-slate-900 hover:bg-slate-700 text-slate-300 border border-slate-700"
                    title="Duplicate Selected Text"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      deleteTextItem(selectedText.id);
                      selectItem(null, null);
                    }}
                    className="p-1 rounded bg-red-950/60 hover:bg-red-600 text-red-300 hover:text-white border border-red-800/50 transition-colors"
                    title="Delete Selected Text"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* 2. SELECTED IMAGE / SIGNATURE CONTROLS */}
          {selectedImage && (
            <div className="flex items-center space-x-1.5 bg-slate-800/90 px-2 py-1 rounded border border-slate-700">
              <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider px-1 border-r border-slate-700">
                {(selectedImage.name || '').toLowerCase().includes('signature') ? 'Signature' : 'Image'} ({Math.round(selectedImage.width)}×{Math.round(selectedImage.height)})
              </span>
              <button
                onClick={() =>
                  updateImageItem(selectedImage.id, {
                    width: Math.max(25, Math.round(selectedImage.width * 0.9)),
                    height: Math.max(25, Math.round(selectedImage.height * 0.9)),
                  })
                }
                className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-700 rounded border border-slate-700 text-[11px]"
                title="Scale Down 10%"
              >
                -10%
              </button>
              <button
                onClick={() =>
                  updateImageItem(selectedImage.id, {
                    width: Math.round(selectedImage.width * 1.1),
                    height: Math.round(selectedImage.height * 1.1),
                  })
                }
                className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-700 rounded border border-slate-700 text-[11px]"
                title="Scale Up 10%"
              >
                +10%
              </button>
              <button
                onClick={() =>
                  updateImageItem(selectedImage.id, {
                    rotation: ((selectedImage.rotation || 0) + 90) % 360,
                  })
                }
                className="p-1 rounded bg-slate-900 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Rotate Image 90°"
              >
                <RotateCw className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  deleteImageItem(selectedImage.id);
                  selectItem(null, null);
                }}
                className="p-1 rounded bg-red-950/60 hover:bg-red-600 text-red-300 hover:text-white border border-red-800/50 transition-colors"
                title="Delete Selected Image"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 3. SELECTED STAMP / ANNOTATION CONTROLS */}
          {selectedAnnotation && selectedAnnotation.type === 'stamp' && (
            <div className="flex items-center space-x-1.5 bg-slate-800/90 px-2 py-1 rounded border border-slate-700">
              <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider px-1 border-r border-slate-700">
                Stamp
              </span>
              <select
                value={
                  STAMP_TEMPLATES.some(
                    (t) =>
                      t.type === selectedAnnotation.stampType &&
                      t.label === (selectedAnnotation.stampLabel || selectedAnnotation.stampType)
                  )
                    ? `${selectedAnnotation.stampType}:${selectedAnnotation.stampLabel || selectedAnnotation.stampType}`
                    : 'CUSTOM'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'CUSTOM') return;
                  const [type, label] = val.split(':');
                  const tmpl = STAMP_TEMPLATES.find((t) => t.type === type && t.label === label);
                  if (tmpl) {
                    const dims = calculateStampDimensions(
                      tmpl.label,
                      selectedAnnotation.showTimestamp !== false
                    );
                    updateAnnotation(selectedAnnotation.id, {
                      stampType: tmpl.type,
                      stampLabel: tmpl.label,
                      color: tmpl.color,
                      stampStyle: tmpl.defaultStyle,
                      rect: {
                        ...selectedAnnotation.rect,
                        width: Math.max(selectedAnnotation.rect.width, dims.width),
                      },
                    });
                  }
                }}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none"
                title="Switch Stamp Preset"
              >
                {STAMP_TEMPLATES.map((t) => (
                  <option key={`${t.type}_${t.label}`} value={`${t.type}:${t.label}`}>
                    {t.label}
                  </option>
                ))}
                <option value="CUSTOM">Custom Label</option>
              </select>

              <select
                value={selectedAnnotation.stampStyle || 'classic'}
                onChange={(e) =>
                  updateAnnotation(selectedAnnotation.id, {
                    stampStyle: e.target.value as 'classic' | 'solid' | 'outline',
                  })
                }
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none"
                title="Stamp Visual Style"
              >
                <option value="classic">Classic</option>
                <option value="solid">Solid</option>
                <option value="outline">Outline</option>
              </select>

              <button
                onClick={() => {
                  const cur = selectedAnnotation.rotation || 0;
                  const next = cur === 0 ? -10 : cur === -10 ? 10 : 0;
                  updateAnnotation(selectedAnnotation.id, { rotation: next });
                }}
                className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-700 rounded border border-slate-700 text-[11px] font-mono text-slate-200"
                title="Cycle Stamp Tilt Angle (0° / -10° / +10°)"
              >
                {selectedAnnotation.rotation || 0}°
              </button>

              <button
                onClick={() =>
                  updateAnnotation(selectedAnnotation.id, {
                    rect: {
                      ...selectedAnnotation.rect,
                      width: Math.max(96, Math.round(selectedAnnotation.rect.width * 0.9)),
                      height: Math.max(32, Math.round(selectedAnnotation.rect.height * 0.9)),
                    },
                  })
                }
                className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-700 rounded border border-slate-700 text-[11px]"
                title="Scale Stamp Down 10%"
              >
                -10%
              </button>
              <button
                onClick={() =>
                  updateAnnotation(selectedAnnotation.id, {
                    rect: {
                      ...selectedAnnotation.rect,
                      width: Math.round(selectedAnnotation.rect.width * 1.1),
                      height: Math.round(selectedAnnotation.rect.height * 1.1),
                    },
                  })
                }
                className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-700 rounded border border-slate-700 text-[11px]"
                title="Scale Stamp Up 10%"
              >
                +10%
              </button>

              <button
                onClick={() =>
                  updateAnnotation(selectedAnnotation.id, {
                    showTimestamp: selectedAnnotation.showTimestamp === false,
                  })
                }
                className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                  selectedAnnotation.showTimestamp !== false
                    ? 'bg-brand-600/30 border-brand-500 text-brand-200'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Toggle Date & Author Metadata"
              >
                Date
              </button>

              <input
                type="color"
                value={selectedAnnotation.color || activeColor}
                onChange={(e) => {
                  updateAnnotation(selectedAnnotation.id, { color: e.target.value });
                  setActiveColor(e.target.value);
                }}
                className="w-5 h-5 rounded cursor-pointer border border-slate-600 bg-transparent"
                title="Change Stamp Color"
              />

              <button
                onClick={() =>
                  addAnnotation({
                    pageIndex: selectedAnnotation.pageIndex,
                    type: 'stamp',
                    rect: {
                      ...selectedAnnotation.rect,
                      x: selectedAnnotation.rect.x + 20,
                      y: selectedAnnotation.rect.y + 20,
                    },
                    color: selectedAnnotation.color,
                    stampType: selectedAnnotation.stampType,
                    stampLabel: selectedAnnotation.stampLabel,
                    stampStyle: selectedAnnotation.stampStyle,
                    rotation: selectedAnnotation.rotation,
                    showTimestamp: selectedAnnotation.showTimestamp,
                    opacity: selectedAnnotation.opacity,
                  })
                }
                className="p-1 rounded bg-slate-900 hover:bg-slate-700 text-slate-300 border border-slate-700"
                title="Duplicate Selected Stamp"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  deleteAnnotation(selectedAnnotation.id);
                  selectItem(null, null);
                }}
                className="p-1 rounded bg-red-950/60 hover:bg-red-600 text-red-300 hover:text-white border border-red-800/50 transition-colors"
                title="Delete Selected Stamp"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {selectedAnnotation && selectedAnnotation.type !== 'stamp' && (
            <div className="flex items-center space-x-1.5 bg-slate-800/90 px-2 py-1 rounded border border-slate-700">
              <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider px-1 border-r border-slate-700">
                {selectedAnnotation.type}
              </span>
              <input
                type="color"
                value={selectedAnnotation.color || activeColor}
                onChange={(e) => {
                  updateAnnotation(selectedAnnotation.id, { color: e.target.value });
                  setActiveColor(e.target.value);
                }}
                className="w-5 h-5 rounded cursor-pointer border border-slate-600 bg-transparent"
                title="Change Selected Annotation Color"
              />
              {(selectedAnnotation.strokeWidth !== undefined ||
                ['line', 'arrow', 'underline', 'strikethrough', 'freehand', 'rectangle', 'circle'].includes(
                  selectedAnnotation.type
                )) && (
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded">
                  <button
                    onClick={() => {
                      const next = Math.max(1, (selectedAnnotation.strokeWidth || 2) - 1);
                      updateAnnotation(selectedAnnotation.id, { strokeWidth: next });
                      setActiveStrokeWidth(next);
                    }}
                    className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                    title="Decrease Stroke"
                  >
                    -
                  </button>
                  <span className="px-1 text-[10px] font-mono text-slate-200">
                    {selectedAnnotation.strokeWidth || 2}px
                  </span>
                  <button
                    onClick={() => {
                      const next = Math.min(12, (selectedAnnotation.strokeWidth || 2) + 1);
                      updateAnnotation(selectedAnnotation.id, { strokeWidth: next });
                      setActiveStrokeWidth(next);
                    }}
                    className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                    title="Increase Stroke"
                  >
                    +
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  deleteAnnotation(selectedAnnotation.id);
                  selectItem(null, null);
                }}
                className="p-1 rounded bg-red-950/60 hover:bg-red-600 text-red-300 hover:text-white border border-red-800/50 transition-colors"
                title="Delete Selected Annotation"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 4. SELECTED FORM FIELD CONTROLS */}
          {selectedForm && (
            <div className="flex items-center space-x-1.5 bg-slate-800/90 px-2 py-1 rounded border border-slate-700">
              <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider px-1 border-r border-slate-700">
                Field: {selectedForm.name}
              </span>
              <button
                onClick={() => {
                  deleteFormField(selectedForm.id);
                  selectItem(null, null);
                }}
                className="p-1 rounded bg-red-950/60 hover:bg-red-600 text-red-300 hover:text-white border border-red-800/50 transition-colors"
                title="Delete Selected Form Field"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 5. DEFAULT COLOR PICKER WHEN NO ITEM IS SELECTED */}
          {!selectedText &&
            !selectedImage &&
            !selectedAnnotation &&
            !selectedForm &&
            activeTool !== 'text-add' &&
            activeTool !== 'text-edit' &&
            ['annotate', 'edit'].includes(activeCategory) && (
              <div className="flex items-center space-x-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                <span className="text-[10px] text-slate-400">Color:</span>
                <input
                  type="color"
                  value={activeColor}
                  onChange={(e) => setActiveColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border border-slate-600 bg-transparent"
                  title="Change Active Color"
                />
              </div>
            )}
        </div>
      </div>

      {/* Save Updated PDF Modal (Recommends Save as New File) */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isSavingNewFile && setShowSaveModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Save className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Save Updated PDF</h3>
                  <p className="text-[11px] text-slate-400">
                    All edits and annotations will be permanently compiled
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingNewFile}
                onClick={() => setShowSaveModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Pending Updates Included:</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {textItems.length +
                    imageItems.length +
                    annotations.length +
                    formFields.length +
                    (watermark?.text?.trim() ? 1 : 0) +
                    (headerFooter?.headerLeft ||
                    headerFooter?.headerCenter ||
                    headerFooter?.headerRight ||
                    headerFooter?.footerLeft ||
                    headerFooter?.footerCenter ||
                    headerFooter?.footerRight
                      ? 1
                      : 0) +
                    (security?.userPassword || security?.ownerPassword ? 1 : 0)}{' '}
                  item(s)
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {textItems.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                    {textItems.length} Text Edit{textItems.length > 1 ? 's' : ''}
                  </span>
                )}
                {imageItems.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-violet-300 border border-slate-700">
                    {imageItems.length} Image / Signature
                  </span>
                )}
                {annotations.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                    {annotations.length} Annotation / Stamp / Draw
                  </span>
                )}
                {formFields.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700">
                    {formFields.length} Form Field{formFields.length > 1 ? 's' : ''}
                  </span>
                )}
                {watermark?.text?.trim() && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700">
                    Watermark
                  </span>
                )}
                {(headerFooter?.headerLeft ||
                  headerFooter?.headerCenter ||
                  headerFooter?.headerRight ||
                  headerFooter?.footerLeft ||
                  headerFooter?.footerCenter ||
                  headerFooter?.footerRight) && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700">
                    Header / Footer
                  </span>
                )}
                {!isDirty &&
                  textItems.length + imageItems.length + annotations.length + formFields.length === 0 && (
                    <span className="text-slate-500">All current edits are ready to export cleanly.</span>
                  )}
              </div>
            </div>

            <div className="bg-emerald-950/35 border border-emerald-500/40 rounded-xl p-3 text-[11px] text-emerald-200 leading-relaxed">
              <span className="font-bold text-emerald-300">Recommended: Save as New File</span> — Preserves your original PDF untouched while writing all updates into{' '}
              <span className="font-mono text-white">{buildEditedFileName(currentFileName)}</span>.
            </div>

            <div className="flex flex-col space-y-2 pt-1">
              <button
                type="button"
                disabled={isSavingNewFile}
                onClick={handleSaveAsNewFile}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/30 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isSavingNewFile ? 'Compiling & Saving...' : 'Save as New File (Recommended)'}
                </span>
              </button>
              <button
                type="button"
                disabled={isSavingNewFile}
                onClick={handleApplySessionOnly}
                className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 border border-slate-700 transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Apply Changes in Current Session Only</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
