import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { X, Layers, Check, Trash2, Eye, Plus } from 'lucide-react';

interface HeaderFooterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_PAGINATIONS = [
  'Page {page} of {total}',
  'Page {page}',
  '- {page} -',
  'Confidential · Page {page}',
];

const PRESET_COLORS = [
  { label: 'Slate', hex: '#475569' },
  { label: 'Dark', hex: '#0f172a' },
  { label: 'Blue', hex: '#2563eb' },
  { label: 'Red', hex: '#dc2626' },
  { label: 'Green', hex: '#16a34a' },
];

export const HeaderFooterModal: React.FC<HeaderFooterModalProps> = ({ isOpen, onClose }) => {
  const { headerFooter, setHeaderFooter, setStatusMessage, currentPage, pdfDocProxy } =
    useEditorStore();
  const initialHeaderFooterRef = useRef(headerFooter);

  const [headerLeft, setHeaderLeft] = useState(headerFooter.headerLeft || '');
  const [headerCenter, setHeaderCenter] = useState(headerFooter.headerCenter || '');
  const [headerRight, setHeaderRight] = useState(headerFooter.headerRight || '');

  const [footerLeft, setFooterLeft] = useState(headerFooter.footerLeft || '');
  const [footerCenter, setFooterCenter] = useState(
    headerFooter.footerCenter || 'Page {page} of {total}'
  );
  const [footerRight, setFooterRight] = useState(headerFooter.footerRight || '');

  const [fontSize, setFontSize] = useState(headerFooter.fontSize || 9);
  const [colorHex, setColorHex] = useState(headerFooter.colorHex || '#475569');
  const [excludeFirstPage, setExcludeFirstPage] = useState(headerFooter.excludeFirstPage ?? false);

  const totalPages = pdfDocProxy?.numPages || 1;

  // Track active target input for token insertion
  const [activeTarget, setActiveTarget] = useState<'fc' | 'fl' | 'fr' | 'hc' | 'hl' | 'hr'>('fc');

  useEffect(() => {
    if (isOpen) {
      initialHeaderFooterRef.current = headerFooter;
      setHeaderLeft(headerFooter.headerLeft || '');
      setHeaderCenter(headerFooter.headerCenter || '');
      setHeaderRight(headerFooter.headerRight || '');
      setFooterLeft(headerFooter.footerLeft || '');
      setFooterCenter(headerFooter.footerCenter || 'Page {page} of {total}');
      setFooterRight(headerFooter.footerRight || '');
      setFontSize(headerFooter.fontSize || 9);
      setColorHex(headerFooter.colorHex || '#475569');
      setExcludeFirstPage(headerFooter.excludeFirstPage ?? false);
    }
  }, [isOpen]);

  // Live real-time preview sync with main canvas
  useEffect(() => {
    if (isOpen) {
      setHeaderFooter({
        headerLeft,
        headerCenter,
        headerRight,
        footerLeft,
        footerCenter,
        footerRight,
        fontSize,
        colorHex,
        excludeFirstPage,
      });
    }
  }, [
    isOpen,
    headerLeft,
    headerCenter,
    headerRight,
    footerLeft,
    footerCenter,
    footerRight,
    fontSize,
    colorHex,
    excludeFirstPage,
    setHeaderFooter,
  ]);

  if (!isOpen) return null;

  const handleApply = () => {
    setHeaderFooter({
      headerLeft: headerLeft.trim(),
      headerCenter: headerCenter.trim(),
      headerRight: headerRight.trim(),
      footerLeft: footerLeft.trim(),
      footerCenter: footerCenter.trim(),
      footerRight: footerRight.trim(),
      fontSize,
      colorHex,
      excludeFirstPage,
    });
    setStatusMessage(
      `Headers & Footers configured${excludeFirstPage ? ' (excluding cover page)' : ''}`
    );
    onClose();
  };

  const handleCancel = () => {
    // Revert to initial state
    setHeaderFooter(initialHeaderFooterRef.current);
    onClose();
  };

  const handleClear = () => {
    setHeaderLeft('');
    setHeaderCenter('');
    setHeaderRight('');
    setFooterLeft('');
    setFooterCenter('');
    setFooterRight('');
    setHeaderFooter({});
    setStatusMessage('Headers & Footers cleared');
    onClose();
  };

  const insertToken = (token: string) => {
    switch (activeTarget) {
      case 'fc':
        setFooterCenter((prev) => prev + token);
        break;
      case 'fl':
        setFooterLeft((prev) => prev + token);
        break;
      case 'fr':
        setFooterRight((prev) => prev + token);
        break;
      case 'hc':
        setHeaderCenter((prev) => prev + token);
        break;
      case 'hl':
        setHeaderLeft((prev) => prev + token);
        break;
      case 'hr':
        setHeaderRight((prev) => prev + token);
        break;
    }
  };

  const formatPreview = (template?: string) => {
    if (!template) return '';
    return template
      .replace(/{page}/gi, String(currentPage))
      .replace(/{total}/gi, String(totalPages));
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>Header &amp; Footer Layout</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Live Preview
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Configure running headers, titles, and dynamic page numbering with instant document preview.
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
          {/* Left Column: Form Controls (7 cols) */}
          <div className="md:col-span-7 space-y-4">
            {/* 1. Header Row */}
            <div className="space-y-2 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Running Headers (Top of Page)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Left</label>
                  <input
                    type="text"
                    value={headerLeft}
                    onFocus={() => setActiveTarget('hl')}
                    onChange={(e) => setHeaderLeft(e.target.value)}
                    placeholder="e.g. Project Nova"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Center</label>
                  <input
                    type="text"
                    value={headerCenter}
                    onFocus={() => setActiveTarget('hc')}
                    onChange={(e) => setHeaderCenter(e.target.value)}
                    placeholder="e.g. Specification"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Right</label>
                  <input
                    type="text"
                    value={headerRight}
                    onFocus={() => setActiveTarget('hr')}
                    onChange={(e) => setHeaderRight(e.target.value)}
                    placeholder="e.g. Confidential"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 2. Footer Row */}
            <div className="space-y-2 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Running Footers &amp; Pagination (Bottom of Page)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Left</label>
                  <input
                    type="text"
                    value={footerLeft}
                    onFocus={() => setActiveTarget('fl')}
                    onChange={(e) => setFooterLeft(e.target.value)}
                    placeholder="e.g. Internal"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Center</label>
                  <input
                    type="text"
                    value={footerCenter}
                    onFocus={() => setActiveTarget('fc')}
                    onChange={(e) => setFooterCenter(e.target.value)}
                    placeholder="Page {page} of {total}"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-medium">Right</label>
                  <input
                    type="text"
                    value={footerRight}
                    onFocus={() => setActiveTarget('fr')}
                    onChange={(e) => setFooterRight(e.target.value)}
                    placeholder="e.g. Audit Copy"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Quick Pagination Presets */}
              <div className="space-y-1 pt-1">
                <div className="text-[10px] text-slate-400">Quick Pagination Presets (sets center):</div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_PAGINATIONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setFooterCenter(preset)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono border transition-colors ${
                        footerCenter === preset
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700/60'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Token Insert Buttons */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
                <span>Insert Token:</span>
                <button
                  type="button"
                  onClick={() => insertToken('{page}')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 font-mono text-[10px] flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>{'{page}'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertToken('{total}')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 font-mono text-[10px] flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>{'{total}'}</span>
                </button>
              </div>
            </div>

            {/* 3. Typography & Styling */}
            <div className="grid grid-cols-2 gap-4 bg-slate-800/40 p-3 rounded-xl border border-slate-800">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Font Size</label>
                  <span className="text-[11px] font-mono text-blue-400 font-semibold">
                    {fontSize}pt
                  </span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="14"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map(({ label, hex }) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setColorHex(hex)}
                      title={label}
                      className={`w-5 h-5 rounded-full border transition-transform ${
                        colorHex.toLowerCase() === hex.toLowerCase()
                          ? 'scale-120 border-white'
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
                      className="w-4 h-4 rounded bg-transparent border-0 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-slate-300 uppercase">
                      {colorHex}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Options */}
            <label className="flex items-center space-x-2.5 text-xs text-slate-300 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={excludeFirstPage}
                onChange={(e) => setExcludeFirstPage(e.target.checked)}
                className="rounded border-slate-700 text-blue-500 focus:ring-0 w-3.5 h-3.5 bg-slate-800 cursor-pointer"
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
            <div className="w-[195px] h-[276px] bg-white rounded-lg shadow-2xl relative overflow-hidden flex flex-col justify-between p-2.5 select-none border border-slate-200">
              {/* Top Header Region (with subtle dashed border) */}
              <div
                className="w-full flex justify-between items-center border-b border-dashed border-blue-400/50 pb-1"
                style={{
                  fontSize: '7px',
                  color: colorHex,
                  fontFamily: 'Helvetica, Arial, sans-serif',
                }}
              >
                <div className="truncate flex-1 text-left">{formatPreview(headerLeft)}</div>
                <div className="truncate flex-1 text-center font-medium">
                  {formatPreview(headerCenter)}
                </div>
                <div className="truncate flex-1 text-right">{formatPreview(headerRight)}</div>
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

              {/* Bottom Footer Region (with subtle dashed border) */}
              <div
                className="w-full flex justify-between items-center border-t border-dashed border-blue-400/50 pt-1"
                style={{
                  fontSize: '7px',
                  color: colorHex,
                  fontFamily: 'Helvetica, Arial, sans-serif',
                }}
              >
                <div className="truncate flex-1 text-left">{formatPreview(footerLeft)}</div>
                <div className="truncate flex-1 text-center font-mono font-medium">
                  {formatPreview(footerCenter)}
                </div>
                <div className="truncate flex-1 text-right">{formatPreview(footerRight)}</div>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 text-center mt-3 leading-tight">
              Changes reflect live on the document canvas in the background.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center space-x-1.5 text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Headers &amp; Footers</span>
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
              className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/20 transition-all hover:shadow-blue-600/30 active:scale-98"
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
