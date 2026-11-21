import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { pdfEngine } from '../services/pdfEngine';
import {
  RotateCw,
  Copy,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';

export const ThumbnailStrip: React.FC = () => {
  const {
    pdfBytes,
    pdfDocProxy,
    pageCount,
    currentPage,
    setCurrentPage,
    loadPdfBytes,
    currentFileName,
    currentFilePath,
    setStatusMessage,
  } = useEditorStore();

  const [thumbnails, setThumbnails] = useState<string[]>([]);

  // Generate lightweight thumbnails
  useEffect(() => {
    if (!pdfDocProxy || !pdfBytes) return;

    let isCancelled = false;
    const generateThumbs = async () => {
      const thumbs: string[] = [];
      const count = pdfDocProxy.numPages;

      for (let i = 1; i <= count; i++) {
        const page = await pdfDocProxy.getPage(i);
        const viewport = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          thumbs.push(canvas.toDataURL('image/jpeg', 0.8));
        }
      }

      if (!isCancelled) {
        setThumbnails(thumbs);
      }
    };

    generateThumbs();
    return () => {
      isCancelled = true;
    };
  }, [pdfDocProxy, pdfBytes]);

  // Page operation handlers
  const handleRotate = async (e: React.MouseEvent, pageIndex: number) => {
    e.stopPropagation();
    if (!pdfBytes) return;
    setStatusMessage(`Rotating page ${pageIndex + 1}...`);
    const updated = await pdfEngine.rotatePages(pdfBytes, [pageIndex], 90);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
  };

  const handleDuplicate = async (e: React.MouseEvent, pageIndex: number) => {
    e.stopPropagation();
    if (!pdfBytes) return;
    setStatusMessage(`Duplicating page ${pageIndex + 1}...`);
    const updated = await pdfEngine.duplicatePage(pdfBytes, pageIndex);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
  };

  const handleDelete = async (e: React.MouseEvent, pageIndex: number) => {
    e.stopPropagation();
    if (!pdfBytes || pageCount <= 1) return;
    setStatusMessage(`Deleting page ${pageIndex + 1}...`);
    const updated = await pdfEngine.deletePages(pdfBytes, [pageIndex]);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
  };

  const handleInsertBlank = async (afterIndex: number) => {
    if (!pdfBytes) return;
    setStatusMessage(`Inserting blank page after page ${afterIndex}...`);
    const updated = await pdfEngine.insertBlankPage(pdfBytes, afterIndex);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
  };

  const handleMovePage = async (fromIdx: number, toIdx: number) => {
    if (!pdfBytes || toIdx < 0 || toIdx >= pageCount) return;
    const order = Array.from({ length: pageCount }, (_, i) => i);
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    setStatusMessage(`Reordering page ${fromIdx + 1} to position ${toIdx + 1}...`);
    const updated = await pdfEngine.reorderPages(pdfBytes, order);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setCurrentPage(toIdx + 1);
  };

  if (!pdfBytes) return null;

  return (
    <div className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col select-none text-xs text-slate-300">
      {/* Strip Header */}
      <div className="h-10 px-3 border-b border-slate-800 flex items-center justify-between font-semibold text-slate-200">
        <div className="flex items-center space-x-1.5">
          <Layers className="w-3.5 h-3.5 text-brand-400" />
          <span>Pages ({pageCount})</span>
        </div>
        <button
          onClick={() => handleInsertBlank(pageCount)}
          className="p-1 hover:bg-slate-800 rounded text-brand-400 hover:text-brand-300"
          title="Insert Blank Page at End"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Thumbnails Scroll Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Array.from({ length: pageCount }).map((_, idx) => {
          const pageNum = idx + 1;
          const isCurrent = currentPage === pageNum;
          const thumbUrl = thumbnails[idx];

          return (
            <div
              key={idx}
              onClick={() => setCurrentPage(pageNum)}
              className={`group flex flex-col items-center rounded-lg p-2 transition-all cursor-pointer border ${
                isCurrent
                  ? 'bg-brand-600/15 border-brand-500 shadow-md ring-1 ring-brand-500/50'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600 hover:bg-slate-800/80'
              }`}
            >
              {/* Page Number & Action Buttons */}
              <div className="w-full flex items-center justify-between mb-1.5 px-0.5 text-[11px]">
                <span className={`font-mono font-medium ${isCurrent ? 'text-brand-400' : 'text-slate-400'}`}>
                  Page {pageNum}
                </span>

                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {idx > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMovePage(idx, idx - 1);
                      }}
                      className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
                      title="Move Page Up"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                  )}
                  {idx < pageCount - 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMovePage(idx, idx + 1);
                      }}
                      className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
                      title="Move Page Down"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => handleRotate(e, idx)}
                    className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
                    title="Rotate 90° Clockwise"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleDuplicate(e, idx)}
                    className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200"
                    title="Duplicate Page"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {pageCount > 1 && (
                    <button
                      onClick={(e) => handleDelete(e, idx)}
                      className="p-1 hover:bg-red-950/60 rounded text-slate-400 hover:text-red-400"
                      title="Delete Page"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Thumbnail Image */}
              <div className="w-full aspect-[1/1.4] bg-white rounded border border-slate-600/40 overflow-hidden flex items-center justify-center shadow-sm">
                {thumbUrl ? (
                  <img src={thumbUrl} alt={`Page ${pageNum}`} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-slate-400">Loading...</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
