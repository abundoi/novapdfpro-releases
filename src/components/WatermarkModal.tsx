import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { X, Sparkles, Check, Trash2, Eye } from 'lucide-react';

interface WatermarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_WATERMARKS = [
  'CONFIDENTIAL',
  'DRAFT',
  'INTERNAL ONLY',
  'DO NOT COPY',
  'SAMPLE',
  'TOP SECRET',
  'APPROVED',
  'ORIGINAL',
];

const PRESET_ANGLES = [
  { label: '45° Diagonal', val: 45 },
  { label: '0° Horizontal', val: 0 },
  { label: '90° Vertical', val: 90 },
  { label: '-45° Reverse', val: -45 },
];

const PRESET_COLORS = [
  { label: 'Slate', hex: '#94a3b8' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Green', hex: '#10b981' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Dark', hex: '#475569' },
];

export const WatermarkModal: React.FC<WatermarkModalProps> = ({ isOpen, onClose }) => {
  const { watermark, setWatermark, setStatusMessage, currentPage, pdfDocProxy } = useEditorStore();
  const initialWatermarkRef = useRef(watermark);

  const [text, setText] = useState(watermark.text || 'CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(watermark.fontSize || 48);
  const [opacity, setOpacity] = useState(watermark.opacity ?? 0.25);
  const [rotation, setRotation] = useState(watermark.rotationDegrees ?? 45);
  const [colorHex, setColorHex] = useState(watermark.colorHex || '#94a3b8');
  const [excludeFirstPage, setExcludeFirstPage] = useState(watermark.excludeFirstPage ?? false);

  const totalPages = pdfDocProxy?.numPages || 1;

  // Initialize from store when modal opens
  useEffect(() => {
    if (isOpen) {
      initialWatermarkRef.current = watermark;
      setText(watermark.text || 'CONFIDENTIAL');
      setFontSize(watermark.fontSize || 48);
      setOpacity(watermark.opacity ?? 0.25);
      setRotation(watermark.rotationDegrees ?? 45);
      setColorHex(watermark.colorHex || '#94a3b8');
      setExcludeFirstPage(watermark.excludeFirstPage ?? false);
    }
  }, [isOpen]);

  // Live real-time preview sync with main canvas
  useEffect(() => {
    if (isOpen) {
      setWatermark({
        text,
        fontSize,
        opacity,
        rotationDegrees: rotation,
        colorHex,
        excludeFirstPage,
      });
    }
  }, [isOpen, text, fontSize, opacity, rotation, colorHex, excludeFirstPage, setWatermark]);

  if (!isOpen) return null;

  const handleApply = () => {
    setWatermark({
      text: text.trim(),
      fontSize,
      opacity,
      rotationDegrees: rotation,
      colorHex,
      excludeFirstPage,
    });
    setStatusMessage(
      text.trim()
        ? `Watermark "${text.trim()}" applied${excludeFirstPage ? ' (excluding cover page)' : ' across document'}`
        : 'Watermark cleared'
    );
    onClose();
  };

  const handleCancel = () => {
    // Revert to initial watermark state
    setWatermark(initialWatermarkRef.current);
    onClose();
  };

  const handleRemove = () => {
    setText('');
    setWatermark({ text: '' });
    setStatusMessage('Watermark removed');
    onClose();
  };

  // Scaled font size for the miniature preview sheet
  const previewFontSize = Math.max(10, Math.min(32, fontSize * 0.38));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>Watermark Designer</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Live Preview
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Design custom security watermarks with instant real-time document preview.
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Dual Pane Layout */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6 p-6">
          {/* Left Column: Watermark Controls (7 cols) */}
          <div className="md:col-span-7 space-y-4">
            {/* Watermark Text */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-300 font-semibold">Watermark Text</label>
                <span className="text-[10px] text-slate-500">{text.length} chars</span>
              </div>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. CONFIDENTIAL, DRAFT, INTERNAL ONLY"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-bold tracking-wider transition-all"
                autoFocus
              />

              {/* Quick Text Presets */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PRESET_WATERMARKS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setText(preset)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                      text === preset
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                        : 'bg-slate-800/70 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700/60'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size & Opacity Sliders */}
            <div className="grid grid-cols-2 gap-4 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Font Size</label>
                  <span className="text-[11px] font-mono text-amber-400 font-semibold">
                    {fontSize}pt
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="96"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Opacity</label>
                  <span className="text-[11px] font-mono text-amber-400 font-semibold">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.8"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Rotation Angle */}
            <div className="space-y-1.5 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-300 font-medium">Rotation Angle</label>
                <span className="text-[11px] font-mono text-amber-400 font-semibold">
                  {rotation}°
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {PRESET_ANGLES.map(({ label, val }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setRotation(val)}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold border text-center transition-all ${
                      rotation === val
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min="-90"
                max="90"
                step="5"
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full accent-amber-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer mt-2"
              />
            </div>

            {/* Color Swatches */}
            <div className="space-y-1.5 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <label className="text-xs text-slate-300 font-medium">Watermark Color</label>
              <div className="flex items-center gap-2 pt-1">
                {PRESET_COLORS.map(({ label, hex }) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColorHex(hex)}
                    title={label}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      colorHex.toLowerCase() === hex.toLowerCase()
                        ? 'scale-115 border-white shadow-xs'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}

                <div className="ml-auto flex items-center space-x-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                  <input
                    type="color"
                    value={colorHex}
                    onChange={(e) => setColorHex(e.target.value)}
                    className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-[11px] font-mono text-slate-300 uppercase">{colorHex}</span>
                </div>
              </div>
            </div>

            {/* Options */}
            <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={excludeFirstPage}
                onChange={(e) => setExcludeFirstPage(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 bg-slate-800 cursor-pointer"
              />
              <span>Exclude cover page (first page of document)</span>
            </label>
          </div>

          {/* Right Column: Live Miniature Page Preview (5 cols) */}
          <div className="md:col-span-5 flex flex-col items-center justify-center bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 relative overflow-hidden">
            <div className="w-full flex items-center justify-between text-[11px] text-slate-400 mb-3 px-1">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Sheet Preview
              </span>
              <span className="font-mono text-slate-500">
                Page {currentPage} of {totalPages}
              </span>
            </div>

            {/* Miniature Document Paper Sheet */}
            <div className="w-[195px] h-[276px] bg-white rounded-lg shadow-2xl relative overflow-hidden flex flex-col justify-between p-3 select-none border border-slate-200">
              {/* Simulated Header Line */}
              <div className="w-full flex justify-between items-center opacity-30 border-b border-slate-400/40 pb-1">
                <div className="h-1.5 w-12 bg-slate-400 rounded-full" />
                <div className="h-1.5 w-8 bg-slate-400 rounded-full" />
              </div>

              {/* Simulated Content Skeleton Lines */}
              <div className="flex-1 my-3 space-y-1.5 opacity-25">
                <div className="h-2 w-3/4 bg-slate-500 rounded-full mb-2.5" />
                <div className="h-1.5 w-full bg-slate-400 rounded-full" />
                <div className="h-1.5 w-5/6 bg-slate-400 rounded-full" />
                <div className="h-1.5 w-full bg-slate-400 rounded-full" />
                <div className="h-1.5 w-4/5 bg-slate-400 rounded-full" />
                <div className="h-1.5 w-full bg-slate-400 rounded-full" />
                <div className="h-1.5 w-2/3 bg-slate-400 rounded-full" />
                <div className="h-1.5 w-full bg-slate-400 rounded-full" />
                <div className="h-1.5 w-3/4 bg-slate-400 rounded-full" />
              </div>

              {/* Simulated Footer Line */}
              <div className="w-full flex justify-between items-center opacity-30 border-t border-slate-400/40 pt-1">
                <div className="h-1.5 w-8 bg-slate-400 rounded-full" />
                <div className="h-1.5 w-6 bg-slate-400 rounded-full" />
              </div>

              {/* Centered Watermark Layer */}
              {text.trim() ? (
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
                  style={{ opacity }}
                >
                  <div
                    style={{
                      transform: `rotate(${-rotation}deg)`,
                      transformOrigin: 'center center',
                      fontSize: `${previewFontSize}px`,
                      color: colorHex,
                      fontWeight: 800,
                      fontFamily: 'Helvetica, Arial, sans-serif',
                      whiteSpace: 'nowrap',
                      letterSpacing: '0.08em',
                      lineHeight: 1,
                    }}
                  >
                    {text}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-[10px] text-slate-300 italic">
                  No watermark text
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-400 text-center mt-3 leading-tight">
              Edits appear live on the document canvas in the background.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleRemove}
            className="flex items-center space-x-1.5 text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Watermark</span>
          </button>

          <div className="flex space-x-2.5">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/30 active:scale-98"
            >
              <Check className="w-4 h-4" />
              <span>Apply to Document</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
