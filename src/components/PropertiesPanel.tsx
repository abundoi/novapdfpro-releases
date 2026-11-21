import React from 'react';
import { useEditorStore } from '../stores/editorStore';
import {
  Sliders,
  Type,
  Image as ImageIcon,
  CheckSquare,
  Trash2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Info,
  X,
  Sparkles,
  Layers,
} from 'lucide-react';

export const PropertiesPanel: React.FC = () => {
  const {
    pdfBytes,
    selectedItemId,
    selectedItemType,
    textItems,
    imageItems,
    annotations,
    formFields,
    watermark,
    headerFooter,
    pageMetas,
    currentPage,
    updateTextItem,
    deleteTextItem,
    updateImageItem,
    deleteImageItem,
    updateAnnotation,
    deleteAnnotation,
    updateFormField,
    deleteFormField,
    setPropertiesOpen,
  } = useEditorStore();

  const selectedText = textItems.find((t) => t.id === selectedItemId);
  const selectedImage = imageItems.find((i) => i.id === selectedItemId);
  const selectedAnnotation = annotations.find((a) => a.id === selectedItemId);
  const selectedForm = formFields.find((f) => f.id === selectedItemId);
  const currentPageMeta = pageMetas[currentPage - 1];

  if (!pdfBytes) return null;

  return (
    <div className="w-64 bg-slate-900 border-l border-slate-800 flex flex-col text-xs text-slate-300 select-none shadow-xl z-20">
      {/* Panel Header */}
      <div className="h-10 px-3 border-b border-slate-800 flex items-center justify-between font-semibold text-slate-200">
        <div className="flex items-center space-x-2">
          <Sliders className="w-3.5 h-3.5 text-brand-400" />
          <span>Properties Inspector</span>
        </div>
        <button
          onClick={() => setPropertiesOpen(false)}
          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
          title="Close Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* 1. SELECTED TEXT PROPERTIES (PARAGRAPH & TYPOGRAPHY) */}
        {selectedItemType === 'text' && selectedText && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-100 flex items-center space-x-1.5">
                <Type className="w-3.5 h-3.5 text-sky-400" />
                <span>Paragraph &amp; Text Editor</span>
              </span>
              <button
                onClick={() => deleteTextItem(selectedText.id)}
                className="p-1 text-red-400 hover:bg-red-950/40 rounded transition-colors"
                title="Delete Text Element"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Paragraph Text Content textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 font-medium">Text Content</label>
                <span className="text-[10px] text-slate-500 font-mono">
                  {selectedText.text.trim()
                    ? selectedText.text.trim().split(/\s+/).length
                    : 0}{' '}
                  words • {selectedText.text.length} chars
                </span>
              </div>
              <textarea
                value={selectedText.text}
                onChange={(e) => updateTextItem(selectedText.id, { text: e.target.value })}
                rows={5}
                placeholder="Type or paste long paragraph text..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 outline-none focus:border-brand-500 font-sans leading-relaxed resize-y"
              />
            </div>

            {/* Paragraph Width & Line Spacing */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">
                  Box Width (pt)
                </label>
                <input
                  type="number"
                  value={selectedText.width ? Math.round(selectedText.width) : ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    updateTextItem(selectedText.id, { width: val });
                  }}
                  placeholder="Auto fit"
                  min={40}
                  max={800}
                  step={10}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-slate-200 outline-none font-mono"
                  title="Width in PDF points. Text will wrap cleanly inside this width."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">
                  Line Spacing
                </label>
                <select
                  value={selectedText.lineHeight || 1.25}
                  onChange={(e) =>
                    updateTextItem(selectedText.id, { lineHeight: Number(e.target.value) })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value={1.0}>1.0 (Compact)</option>
                  <option value={1.25}>1.25 (Standard)</option>
                  <option value={1.5}>1.5 (Relaxed)</option>
                  <option value={1.75}>1.75 (Spacious)</option>
                  <option value={2.0}>2.0 (Double)</option>
                </select>
              </div>
            </div>

            {/* Text Alignment */}
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">Paragraph Alignment</label>
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => updateTextItem(selectedText.id, { align: 'left' })}
                  className={`py-1 rounded flex items-center justify-center transition-colors ${
                    !selectedText.align || selectedText.align === 'left'
                      ? 'bg-brand-600 text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Align Left"
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => updateTextItem(selectedText.id, { align: 'center' })}
                  className={`py-1 rounded flex items-center justify-center transition-colors ${
                    selectedText.align === 'center'
                      ? 'bg-brand-600 text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Align Center"
                >
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => updateTextItem(selectedText.id, { align: 'right' })}
                  className={`py-1 rounded flex items-center justify-center transition-colors ${
                    selectedText.align === 'right'
                      ? 'bg-brand-600 text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Align Right"
                >
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Font Family */}
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">Font Family</label>
              <select
                value={selectedText.fontFamily}
                onChange={(e) =>
                  updateTextItem(selectedText.id, { fontFamily: e.target.value as any })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-slate-200 outline-none"
              >
                <option value="Helvetica">Helvetica (Standard Sans)</option>
                <option value="TimesRoman">Times New Roman (Serif)</option>
                <option value="Courier">Courier (Monospace)</option>
              </select>
            </div>

            {/* Font Size & Color */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Font Size (pt)</label>
                <input
                  type="number"
                  value={selectedText.fontSize}
                  onChange={(e) =>
                    updateTextItem(selectedText.id, { fontSize: Number(e.target.value) })
                  }
                  min={6}
                  max={96}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-slate-200 outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Text Color</label>
                <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700 rounded-lg p-1">
                  <input
                    type="color"
                    value={selectedText.color || '#000000'}
                    onChange={(e) => updateTextItem(selectedText.id, { color: e.target.value })}
                    className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-slate-400 truncate">
                    {selectedText.color}
                  </span>
                </div>
              </div>
            </div>

            {/* Typography Styles */}
            <div className="flex items-center space-x-1.5 pt-1">
              <button
                onClick={() => updateTextItem(selectedText.id, { isBold: !selectedText.isBold })}
                className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center space-x-1 transition-colors ${
                  selectedText.isBold
                    ? 'bg-brand-600/30 border-brand-500 text-brand-300 font-bold'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Bold"
              >
                <Bold className="w-3.5 h-3.5" />
                <span>Bold</span>
              </button>
              <button
                onClick={() =>
                  updateTextItem(selectedText.id, { isItalic: !selectedText.isItalic })
                }
                className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center space-x-1 transition-colors ${
                  selectedText.isItalic
                    ? 'bg-brand-600/30 border-brand-500 text-brand-300 italic'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Italic"
              >
                <Italic className="w-3.5 h-3.5" />
                <span>Italic</span>
              </button>
              <button
                onClick={() =>
                  updateTextItem(selectedText.id, { isUnderline: !selectedText.isUnderline })
                }
                className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center space-x-1 transition-colors ${
                  selectedText.isUnderline
                    ? 'bg-brand-600/30 border-brand-500 text-brand-300 underline'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
                title="Underline"
              >
                <Underline className="w-3.5 h-3.5" />
                <span>Underline</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. SELECTED IMAGE PROPERTIES */}
        {selectedItemType === 'image' && selectedImage && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-100 flex items-center space-x-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-violet-400" />
                <span>
                  {(selectedImage.name || '').toLowerCase().includes('signature')
                    ? 'Signature Object'
                    : 'Image Object'}
                </span>
              </span>
              <button
                onClick={() => deleteImageItem(selectedImage.id)}
                className="p-1 text-red-400 hover:bg-red-950/40 rounded"
                title="Delete Object"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Width (px)</label>
                <input
                  type="number"
                  value={Math.round(selectedImage.width)}
                  onChange={(e) =>
                    updateImageItem(selectedImage.id, { width: Number(e.target.value) })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Height (px)</label>
                <input
                  type="number"
                  value={Math.round(selectedImage.height)}
                  onChange={(e) =>
                    updateImageItem(selectedImage.id, { height: Number(e.target.value) })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">
                Rotation: {selectedImage.rotation || 0}°
              </label>
              <input
                type="range"
                min="0"
                max="360"
                step="15"
                value={selectedImage.rotation || 0}
                onChange={(e) =>
                  updateImageItem(selectedImage.id, { rotation: Number(e.target.value) % 360 })
                }
                className="w-full accent-brand-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">
                Opacity: {Math.round((selectedImage.opacity ?? 1) * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={selectedImage.opacity ?? 1}
                onChange={(e) =>
                  updateImageItem(selectedImage.id, { opacity: parseFloat(e.target.value) })
                }
                className="w-full accent-brand-500"
              />
            </div>
          </div>
        )}

        {/* 3. SELECTED ANNOTATION PROPERTIES */}
        {selectedItemType === 'annotation' && selectedAnnotation && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-100 capitalize">
                {selectedAnnotation.type} Annotation
              </span>
              <button
                onClick={() => deleteAnnotation(selectedAnnotation.id)}
                className="p-1 text-red-400 hover:bg-red-950/40 rounded"
                title="Delete Annotation"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">Color</label>
              <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700 rounded p-1">
                <input
                  type="color"
                  value={selectedAnnotation.color}
                  onChange={(e) =>
                    updateAnnotation(selectedAnnotation.id, { color: e.target.value })
                  }
                  className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                />
                <span className="text-[10px] font-mono text-slate-400">
                  {selectedAnnotation.color}
                </span>
              </div>
            </div>

            {selectedAnnotation.type === 'stamp' && (
              <>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-medium">Stamp Label</label>
                  <input
                    type="text"
                    value={selectedAnnotation.stampLabel || selectedAnnotation.stampType || ''}
                    onChange={(e) =>
                      updateAnnotation(selectedAnnotation.id, {
                        stampLabel: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-100 uppercase font-bold outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-medium">Visual Style</label>
                  <select
                    value={selectedAnnotation.stampStyle || 'classic'}
                    onChange={(e) =>
                      updateAnnotation(selectedAnnotation.id, {
                        stampStyle: e.target.value as 'classic' | 'solid' | 'outline',
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 outline-none"
                  >
                    <option value="classic">Classic Double-Border</option>
                    <option value="solid">Solid Filled Badge</option>
                    <option value="outline">Transparent Outline</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-medium">
                    Tilt Angle: {selectedAnnotation.rotation || 0}°
                  </label>
                  <input
                    type="range"
                    min="-30"
                    max="30"
                    step="2"
                    value={selectedAnnotation.rotation || 0}
                    onChange={(e) =>
                      updateAnnotation(selectedAnnotation.id, {
                        rotation: Number(e.target.value),
                      })
                    }
                    className="w-full accent-brand-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-medium">
                    Opacity: {Math.round((selectedAnnotation.opacity ?? 0.95) * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0.25"
                    max="1"
                    step="0.05"
                    value={selectedAnnotation.opacity ?? 0.95}
                    onChange={(e) =>
                      updateAnnotation(selectedAnnotation.id, {
                        opacity: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-brand-500"
                  />
                </div>

                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAnnotation.showTimestamp !== false}
                    onChange={(e) =>
                      updateAnnotation(selectedAnnotation.id, {
                        showTimestamp: e.target.checked,
                      })
                    }
                    className="accent-brand-500"
                  />
                  <span>Show Date &amp; Author Subtext</span>
                </label>
              </>
            )}

            {selectedAnnotation.strokeWidth !== undefined && (
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">
                  Stroke Width: {selectedAnnotation.strokeWidth}px
                </label>
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={selectedAnnotation.strokeWidth}
                  onChange={(e) =>
                    updateAnnotation(selectedAnnotation.id, {
                      strokeWidth: Number(e.target.value),
                    })
                  }
                  className="w-full accent-brand-500"
                />
              </div>
            )}
          </div>
        )}

        {/* 4. SELECTED FORM FIELD PROPERTIES */}
        {selectedItemType === 'form' && selectedForm && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-100 flex items-center space-x-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                <span className="capitalize">{selectedForm.type} Field</span>
              </span>
              <button
                onClick={() => deleteFormField(selectedForm.id)}
                className="p-1 text-red-400 hover:bg-red-950/40 rounded"
                title="Delete Form Field"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">Field Identifier / Name</label>
              <input
                type="text"
                value={selectedForm.name}
                onChange={(e) => updateFormField(selectedForm.id, { name: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium">Default Value</label>
              <input
                type="text"
                value={String(selectedForm.defaultValue || '')}
                onChange={(e) =>
                  updateFormField(selectedForm.id, { defaultValue: e.target.value })
                }
                className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 outline-none"
              />
            </div>
          </div>
        )}

        {/* 5. PAGE & DOCUMENT DEFAULT METADATA (when nothing selected) */}
        {!selectedItemId && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-2">
              <span className="font-semibold text-slate-100 flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                <span>Page Information</span>
              </span>
            </div>

            <div className="space-y-2.5 text-slate-400">
              <div className="flex justify-between">
                <span>Current Page:</span>
                <span className="text-slate-200 font-mono">{currentPage}</span>
              </div>
              {currentPageMeta && (
                <>
                  <div className="flex justify-between">
                    <span>Width:</span>
                    <span className="text-slate-200 font-mono">
                      {Math.round(currentPageMeta.width)} pt
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Height:</span>
                    <span className="text-slate-200 font-mono">
                      {Math.round(currentPageMeta.height)} pt
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Rotation:</span>
                    <span className="text-slate-200 font-mono">
                      {currentPageMeta.rotation}°
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Document Watermark & Header/Footer Status */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <span className="font-semibold text-slate-100 flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Document Overlays</span>
              </span>

              <div className="space-y-2">
                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Watermark:</span>
                    {watermark?.text?.trim() ? (
                      <span className="text-amber-400 font-semibold truncate max-w-[100px]">
                        {watermark.text}
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">None</span>
                    )}
                  </div>
                  {watermark?.text?.trim() && (
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>{watermark.fontSize || 48}pt · {watermark.rotationDegrees ?? 45}°</span>
                      <span>{Math.round((watermark.opacity ?? 0.25) * 100)}% opacity</span>
                    </div>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Header / Footer:</span>
                    {(headerFooter?.headerLeft ||
                      headerFooter?.headerCenter ||
                      headerFooter?.headerRight ||
                      headerFooter?.footerLeft ||
                      headerFooter?.footerCenter ||
                      headerFooter?.footerRight) ? (
                      <span className="text-blue-400 font-semibold">Configured</span>
                    ) : (
                      <span className="text-slate-500 italic">None</span>
                    )}
                  </div>
                  {(headerFooter?.footerCenter || headerFooter?.headerCenter) && (
                    <div className="text-[10px] text-slate-400 truncate font-mono">
                      {headerFooter.footerCenter || headerFooter.headerCenter}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 text-slate-500 text-[11px] leading-relaxed">
              Click on any element, text block, or image on the canvas to inspect and edit its typography and properties.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
