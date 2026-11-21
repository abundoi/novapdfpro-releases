import React, { useEffect, useState, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { pdfEngine } from '../services/pdfEngine';
import {
  RotateCw,
  Trash2,
  Download,
  Copy,
  Plus,
  Layers,
  ArrowLeft,
  ArrowRight,
  Scissors,
  Files,
  FolderOpen,
  LayoutGrid,
  Kanban,
  Check,
  Save,
  ArrowUp,
  ArrowDown,
  GripVertical,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';

interface KanbanSection {
  id: string;
  title: string;
  color: string;
  pages: number[]; // 1-based page numbers
}

const DEFAULT_SECTIONS: Omit<KanbanSection, 'pages'>[] = [
  { id: 'cover', title: '1. Cover & Front Matter', color: '#38bdf8' },
  { id: 'body', title: '2. Main Body & Content', color: '#10b981' },
  { id: 'data', title: '3. Financials & Data', color: '#f59e0b' },
  { id: 'appendix', title: '4. Appendix & Signatures', color: '#a855f7' },
];

export const OrganizeView: React.FC = () => {
  const {
    pdfBytes,
    pdfDocProxy,
    pageCount,
    loadPdfBytes,
    currentFileName,
    currentFilePath,
    setStatusMessage,
    setActiveTab,
  } = useEditorStore();

  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>('grid');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [kanbanSections, setKanbanSections] = useState<KanbanSection[]>([]);
  const [isSavingDoc, setIsSavingDoc] = useState<boolean>(false);
  const [draggedGridIdx, setDraggedGridIdx] = useState<number | null>(null);
  const [dragOverGridIdx, setDragOverGridIdx] = useState<number | null>(null);
  const [draggedKanbanItem, setDraggedKanbanItem] = useState<{
    pageNum: number;
    fromSecIdx: number;
    fromItemIdx: number;
  } | null>(null);
  const [dragOverSecIdx, setDragOverSecIdx] = useState<number | null>(null);

  const mergeInputRef = useRef<HTMLInputElement>(null);
  const standaloneMergeInputRef = useRef<HTMLInputElement>(null);

  // Initialize Kanban sections safely without wiping existing user assignments
  useEffect(() => {
    if (pageCount === 0) {
      setKanbanSections([]);
      return;
    }

    setKanbanSections((prev) => {
      const allKanbanPages = prev.flatMap((s) => s.pages);
      const isConsistent =
        allKanbanPages.length === pageCount &&
        allKanbanPages.every((p) => p >= 1 && p <= pageCount);

      if (isConsistent && prev.length > 0) {
        return prev; // Preserve user's custom kanban layout!
      }

      // Default initial layout
      const s1: number[] = [1];
      const s2: number[] = [];
      const s3: number[] = [];
      const s4: number[] = [];

      for (let p = 2; p <= pageCount; p++) {
        if (p === pageCount && pageCount >= 3) {
          s4.push(p);
        } else {
          s2.push(p);
        }
      }

      return [
        { ...DEFAULT_SECTIONS[0], pages: s1 },
        { ...DEFAULT_SECTIONS[1], pages: s2 },
        { ...DEFAULT_SECTIONS[2], pages: s3 },
        { ...DEFAULT_SECTIONS[3], pages: s4 },
      ];
    });
  }, [pageCount]);

  // Render Page Thumbnails
  useEffect(() => {
    if (!pdfDocProxy || !pdfBytes) {
      setThumbnails([]);
      return;
    }

    let isCancelled = false;
    const loadThumbs = async () => {
      const thumbs: string[] = [];
      for (let i = 1; i <= pdfDocProxy.numPages; i++) {
        try {
          const page = await pdfDocProxy.getPage(i);
          const viewport = page.getViewport({ scale: 0.35 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            thumbs.push(canvas.toDataURL('image/jpeg', 0.85));
          }
        } catch {
          thumbs.push('');
        }
      }
      if (!isCancelled) setThumbnails(thumbs);
    };

    loadThumbs();
    return () => {
      isCancelled = true;
    };
  }, [pdfDocProxy, pdfBytes]);

  // Global Ctrl+S keyboard shortcut inside Organize Studio
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveDocument();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfBytes, kanbanSections, viewMode, currentFileName, pageCount]);

  const toggleSelectPage = (pageNum: number) => {
    setSelectedPages((prev) =>
      prev.includes(pageNum) ? prev.filter((p) => p !== pageNum) : [...prev, pageNum]
    );
  };

  const selectAll = () => {
    setSelectedPages(Array.from({ length: pageCount }, (_, i) => i + 1));
  };

  const deselectAll = () => setSelectedPages([]);

  // --- SAVE & EXPORT MASTER PDF (For both Grid View and Kanban View) ---
  const handleSaveDocument = async () => {
    if (!pdfBytes) return;

    setIsSavingDoc(true);
    setStatusMessage('Compiling and saving organized PDF document...');

    try {
      let finalBytes = pdfBytes;

      // In Kanban view: automatically sync the column ordering into the master PDF first
      if (viewMode === 'kanban') {
        const orderedPages = kanbanSections.flatMap((s) => s.pages);
        if (orderedPages.length === pageCount) {
          const zeroBasedOrder = orderedPages.map((p) => p - 1);
          finalBytes = await pdfEngine.reorderPages(pdfBytes, zeroBasedOrder);
          await loadPdfBytes(finalBytes, currentFileName, currentFilePath || undefined);
        }
      }

      const defaultOutName = currentFileName || 'NovaPDF_Organized.pdf';

      if (window.electronAPI) {
        const res = await window.electronAPI.savePdfDialog({
          defaultName: defaultOutName,
          data: finalBytes,
        });
        if (res && res.filePath) {
          await loadPdfBytes(finalBytes, res.filePath.split(/[\\/]/).pop() || defaultOutName, res.filePath);
          setStatusMessage(`Document saved successfully to ${res.filePath}`);
        } else {
          setStatusMessage('Save operation cancelled');
        }
      } else {
        const blob = new Blob([finalBytes as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultOutName;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMessage('Organized PDF downloaded successfully');
      }
    } catch (err: any) {
      console.error('Failed to save document:', err);
      setStatusMessage(`Save Error: ${err.message}`);
    } finally {
      setIsSavingDoc(false);
    }
  };

  // --- GRID VIEW OPERATIONS ---

  // Move Page in Grid (Left / Right)
  const handleMovePage = async (e: React.MouseEvent, fromIdx: number, direction: -1 | 1) => {
    e.stopPropagation();
    if (!pdfBytes) return;
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= pageCount) return;

    await executeGridReorder(fromIdx, toIdx);
  };

  // Execute reorder between fromIdx and toIdx
  const executeGridReorder = async (fromIdx: number, toIdx: number) => {
    if (!pdfBytes || fromIdx === toIdx) return;
    const order = Array.from({ length: pageCount }, (_, i) => i);
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);

    setStatusMessage(`Moving page ${fromIdx + 1} to position ${toIdx + 1}...`);
    const updated = await pdfEngine.reorderPages(pdfBytes, order);

    // Keep kanban aligned
    const oldPageNum = fromIdx + 1;
    const newPageNum = toIdx + 1;
    setKanbanSections((prev) => {
      return prev.map((sec) => ({
        ...sec,
        pages: sec.pages.map((p) => {
          if (p === oldPageNum) return newPageNum;
          if (fromIdx < toIdx && p > oldPageNum && p <= newPageNum) return p - 1;
          if (fromIdx > toIdx && p >= newPageNum && p < oldPageNum) return p + 1;
          return p;
        }),
      }));
    });

    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setStatusMessage(`Page moved to position ${toIdx + 1}`);
  };

  // Drag & Drop reordering in Grid View
  const handleGridDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedGridIdx(idx);
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleGridDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGridIdx !== idx) {
      setDragOverGridIdx(idx);
    }
  };

  const handleGridDrop = async (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    setDragOverGridIdx(null);
    if (draggedGridIdx === null || draggedGridIdx === toIdx) {
      setDraggedGridIdx(null);
      return;
    }
    const fromIdx = draggedGridIdx;
    setDraggedGridIdx(null);
    await executeGridReorder(fromIdx, toIdx);
  };

  // Single Page Delete in Grid
  const handleSingleDelete = async (e: React.MouseEvent, pageIdx: number) => {
    e.stopPropagation();
    if (!pdfBytes || pageCount <= 1) {
      setStatusMessage('Document must contain at least one page');
      return;
    }
    const pageNum = pageIdx + 1;
    setStatusMessage(`Deleting page ${pageNum}...`);
    const updated = await pdfEngine.deletePages(pdfBytes, [pageIdx]);

    // Update Kanban sections
    setKanbanSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        pages: sec.pages
          .filter((p) => p !== pageNum)
          .map((p) => (p > pageNum ? p - 1 : p)),
      }))
    );

    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setSelectedPages((prev) =>
      prev.filter((p) => p !== pageNum).map((p) => (p > pageNum ? p - 1 : p))
    );
    setStatusMessage(`Page ${pageNum} deleted`);
  };

  // Batch Delete in Grid
  const handleBatchDelete = async () => {
    if (!pdfBytes || selectedPages.length === 0 || selectedPages.length >= pageCount) {
      if (selectedPages.length >= pageCount) {
        setStatusMessage('Cannot delete all pages from the document');
      }
      return;
    }
    const indices = selectedPages.map((p) => p - 1);
    setStatusMessage(`Deleting ${selectedPages.length} pages...`);
    const updated = await pdfEngine.deletePages(pdfBytes, indices);

    // Map remaining pages for Kanban sections
    const deletedSet = new Set(selectedPages);
    setKanbanSections((prev) =>
      prev.map((sec) => {
        const remaining = sec.pages.filter((p) => !deletedSet.has(p));
        return {
          ...sec,
          pages: remaining.map((p) => {
            const countBelow = selectedPages.filter((del) => del < p).length;
            return p - countBelow;
          }),
        };
      })
    );

    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setSelectedPages([]);
    setStatusMessage('Selected pages deleted successfully');
  };

  // Single Page Rotate
  const handleSingleRotate = async (e: React.MouseEvent, pageIdx: number) => {
    e.stopPropagation();
    if (!pdfBytes) return;
    setStatusMessage(`Rotating page ${pageIdx + 1}...`);
    const updated = await pdfEngine.rotatePages(pdfBytes, [pageIdx], 90);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setStatusMessage(`Page ${pageIdx + 1} rotated`);
  };

  // Batch Rotate
  const handleBatchRotate = async () => {
    if (!pdfBytes || selectedPages.length === 0) return;
    const indices = selectedPages.map((p) => p - 1);
    setStatusMessage(`Rotating ${selectedPages.length} pages...`);
    const updated = await pdfEngine.rotatePages(pdfBytes, indices, 90);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setStatusMessage('Pages rotated successfully');
  };

  // Single Page Duplicate
  const handleSingleDuplicate = async (e: React.MouseEvent, pageIdx: number) => {
    e.stopPropagation();
    if (!pdfBytes) return;
    setStatusMessage(`Duplicating page ${pageIdx + 1}...`);
    const updated = await pdfEngine.duplicatePage(pdfBytes, pageIdx);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setStatusMessage(`Page ${pageIdx + 1} duplicated`);
  };

  // --- KANBAN VIEW OPERATIONS ---

  // Move page between Kanban sections
  const handleKanbanMoveSection = (pageNum: number, fromSecIdx: number, direction: -1 | 1) => {
    const toSecIdx = fromSecIdx + direction;
    if (toSecIdx < 0 || toSecIdx >= kanbanSections.length) return;

    setKanbanSections((prev) => {
      const next = prev.map((s) => ({ ...s, pages: [...s.pages] }));
      next[fromSecIdx].pages = next[fromSecIdx].pages.filter((p) => p !== pageNum);
      next[toSecIdx].pages.push(pageNum);
      return next;
    });
    setStatusMessage(`Moved Page ${pageNum} to ${kanbanSections[toSecIdx].title}`);
  };

  // Reorder page inside a Kanban section
  const handleKanbanReorderWithin = (secIdx: number, itemIdx: number, direction: -1 | 1) => {
    const toItemIdx = itemIdx + direction;
    setKanbanSections((prev) => {
      const next = prev.map((s) => ({ ...s, pages: [...s.pages] }));
      const list = next[secIdx].pages;
      if (toItemIdx < 0 || toItemIdx >= list.length) return prev;
      const temp = list[itemIdx];
      list[itemIdx] = list[toItemIdx];
      list[toItemIdx] = temp;
      return next;
    });
  };

  // Delete page directly from Kanban card
  const handleKanbanDeletePage = async (e: React.MouseEvent, pageNum: number) => {
    e.stopPropagation();
    if (!pdfBytes || pageCount <= 1) {
      setStatusMessage('Cannot delete the only page in the document');
      return;
    }

    const pageIdx = pageNum - 1;
    setStatusMessage(`Deleting page ${pageNum}...`);
    const updated = await pdfEngine.deletePages(pdfBytes, [pageIdx]);

    // Update Kanban sections: remove pageNum, decrement pages > pageNum
    setKanbanSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        pages: sec.pages
          .filter((p) => p !== pageNum)
          .map((p) => (p > pageNum ? p - 1 : p)),
      }))
    );

    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setSelectedPages((prev) =>
      prev.filter((p) => p !== pageNum).map((p) => (p > pageNum ? p - 1 : p))
    );
    setStatusMessage(`Page ${pageNum} removed from document`);
  };

  // Drag & Drop for Kanban
  const handleKanbanDragStart = (
    e: React.DragEvent,
    pageNum: number,
    fromSecIdx: number,
    fromItemIdx: number
  ) => {
    setDraggedKanbanItem({ pageNum, fromSecIdx, fromItemIdx });
    e.dataTransfer.setData('text/plain', String(pageNum));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleKanbanDragOverSection = (e: React.DragEvent, secIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverSecIdx !== secIdx) {
      setDragOverSecIdx(secIdx);
    }
  };

  const handleKanbanDropOnSection = (toSecIdx: number) => {
    setDragOverSecIdx(null);
    if (!draggedKanbanItem) return;

    const { pageNum, fromSecIdx } = draggedKanbanItem;
    setDraggedKanbanItem(null);

    if (fromSecIdx === toSecIdx) return;

    setKanbanSections((prev) => {
      const next = prev.map((s) => ({ ...s, pages: [...s.pages] }));
      next[fromSecIdx].pages = next[fromSecIdx].pages.filter((p) => p !== pageNum);
      next[toSecIdx].pages.push(pageNum);
      return next;
    });
    setStatusMessage(`Moved Page ${pageNum} into ${kanbanSections[toSecIdx].title}`);
  };

  // Apply Kanban sequence onto master PDF
  const handleApplyKanbanOrder = async () => {
    if (!pdfBytes) return;
    const orderedPages = kanbanSections.flatMap((s) => s.pages);
    if (orderedPages.length !== pageCount) {
      setStatusMessage('All pages must be included in Kanban sections');
      return;
    }

    const zeroBasedOrder = orderedPages.map((p) => p - 1);
    setStatusMessage('Applying Kanban section order to PDF...');
    const updated = await pdfEngine.reorderPages(pdfBytes, zeroBasedOrder);
    await loadPdfBytes(updated, currentFileName, currentFilePath || undefined);
    setStatusMessage('Kanban page sequence applied successfully to document');
  };

  // Extract a specific Kanban section into standalone PDF
  const handleExportSection = async (section: KanbanSection) => {
    if (!pdfBytes || section.pages.length === 0) return;
    const indices = section.pages.map((p) => p - 1);
    setStatusMessage(`Exporting ${section.title} (${section.pages.length} pages)...`);
    const extractedBytes = await pdfEngine.extractPages(pdfBytes, indices);

    const safeTitle = section.title.replace(/[^a-zA-Z0-9]/g, '_');
    if (window.electronAPI) {
      await window.electronAPI.savePdfDialog({
        defaultName: `${safeTitle}_Exported.pdf`,
        data: extractedBytes,
      });
    } else {
      const blob = new Blob([extractedBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}_Exported.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setStatusMessage(`Exported ${section.title} successfully`);
  };

  // Extract Selected Pages into new PDF
  const handleExtractPages = async () => {
    if (!pdfBytes || selectedPages.length === 0) return;
    const indices = selectedPages.map((p) => p - 1);
    setStatusMessage(`Extracting ${selectedPages.length} pages...`);
    const extractedBytes = await pdfEngine.extractPages(pdfBytes, indices);

    if (window.electronAPI) {
      await window.electronAPI.savePdfDialog({
        defaultName: `Extracted_Pages_${Date.now()}.pdf`,
        data: extractedBytes,
      });
    } else {
      const blob = new Blob([extractedBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Extracted_Pages_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setStatusMessage('Extracted pages exported successfully');
  };

  // Split PDF into individual pages
  const handleSplitPdf = async () => {
    if (!pdfBytes) return;
    setStatusMessage('Splitting PDF into individual pages...');
    const splitResults = await pdfEngine.splitPdf(pdfBytes);

    for (let i = 0; i < splitResults.length; i++) {
      if (window.electronAPI) {
        await window.electronAPI.saveBackup({
          name: `Page_${i + 1}`,
          data: splitResults[i],
        });
      } else {
        const blob = new Blob([splitResults[i] as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Page_${i + 1}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
    setStatusMessage(`Split document into ${splitResults.length} separate PDF files`);
  };

  // Merge another PDF into current open document
  const handleMergeClick = async () => {
    if (!pdfBytes) return;
    if (window.electronAPI) {
      const files = await window.electronAPI.openMultiplePdfsDialog();
      if (files && files.length > 0) {
        setStatusMessage(`Merging ${files.length} document(s)...`);
        const incomingList = files.map((f) => new Uint8Array(f.data));
        const mergedBytes = await pdfEngine.mergePdfs([pdfBytes, ...incomingList]);
        await loadPdfBytes(mergedBytes, currentFileName, currentFilePath || undefined);
        setStatusMessage(`Merged ${files.length} document(s) successfully`);
      }
    } else {
      mergeInputRef.current?.click();
    }
  };

  const handleMergeFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pdfBytes) {
      const buf = await file.arrayBuffer();
      setStatusMessage(`Merging ${file.name} into current document...`);
      const mergedBytes = await pdfEngine.mergePdfs([pdfBytes, new Uint8Array(buf)]);
      await loadPdfBytes(mergedBytes, currentFileName, currentFilePath || undefined);
      setStatusMessage('Documents merged successfully');
    }
  };

  // Merge multiple PDFs from scratch
  const handleStandaloneMerge = async () => {
    if (window.electronAPI) {
      const files = await window.electronAPI.openMultiplePdfsDialog();
      if (files && files.length > 1) {
        setStatusMessage(`Merging ${files.length} documents...`);
        const byteList = files.map((f) => new Uint8Array(f.data));
        const mergedBytes = await pdfEngine.mergePdfs(byteList);
        await loadPdfBytes(mergedBytes, 'Merged_Document.pdf');
        setStatusMessage(`Successfully combined ${files.length} PDFs into new document`);
      }
    } else {
      standaloneMergeInputRef.current?.click();
    }
  };

  const handleStandaloneFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 1) {
      const byteList: Uint8Array[] = [];
      for (let i = 0; i < files.length; i++) {
        const buf = await files[i].arrayBuffer();
        byteList.push(new Uint8Array(buf));
      }
      setStatusMessage(`Merging ${files.length} documents...`);
      const mergedBytes = await pdfEngine.mergePdfs(byteList);
      await loadPdfBytes(mergedBytes, 'Merged_Document.pdf');
      setStatusMessage(`Successfully combined ${files.length} PDFs into new document`);
    }
  };

  // Empty State
  if (!pdfBytes) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-400 select-none">
        <input
          type="file"
          ref={standaloneMergeInputRef}
          onChange={handleStandaloneFileInput}
          accept="application/pdf"
          multiple
          className="hidden"
        />

        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 mb-4 shadow-xl">
          <Layers className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">Page Organization & Kanban Studio</h2>
        <p className="text-sm text-slate-400 text-center max-w-md mb-6">
          Open a local document to rearrange, rotate, duplicate, or delete pages, or combine multiple PDF files into one master document.
        </p>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition-colors"
          >
            <FolderOpen className="w-4 h-4 text-brand-400" />
            <span>Open Existing Document</span>
          </button>

          <button
            onClick={handleStandaloneMerge}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors shadow-md shadow-emerald-600/20"
          >
            <Files className="w-4 h-4" />
            <span>Merge Multiple PDFs</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 select-none text-slate-100">
      <input
        type="file"
        ref={mergeInputRef}
        onChange={handleMergeFileInput}
        accept="application/pdf"
        className="hidden"
      />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Actions Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm gap-4">
          <div className="flex items-center space-x-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                <span>Page Organization Studio</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Total {pageCount} pages • {selectedPages.length} selected • Drag cards or use arrows to reorganize
              </p>
            </div>

            {/* View Mode Toggle: Grid vs Kanban */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 ml-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Grid View</span>
              </button>

              <button
                onClick={() => setViewMode('kanban')}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Kanban className="w-3.5 h-3.5" />
                <span>Kanban Board</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Primary Save Document Button (Visible in both Grid View and Kanban View) */}
            <button
              onClick={handleSaveDocument}
              disabled={isSavingDoc}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/25 transition-all"
              title="Save organized document to disk (Ctrl + S)"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingDoc ? 'Saving Document...' : 'Save Document'}</span>
            </button>

            {viewMode === 'grid' ? (
              <>
                <button
                  onClick={selectedPages.length === pageCount ? deselectAll : selectAll}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700"
                >
                  {selectedPages.length === pageCount ? 'Deselect All' : 'Select All'}
                </button>

                <button
                  onClick={handleBatchRotate}
                  disabled={selectedPages.length === 0}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 disabled:opacity-40"
                  title="Rotate Selected 90°"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Rotate</span>
                </button>

                <button
                  onClick={handleExtractPages}
                  disabled={selectedPages.length === 0}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-brand-600/30 hover:bg-brand-600/50 text-brand-300 border border-brand-500/40 text-xs font-medium disabled:opacity-40"
                  title="Extract Selected Pages into New PDF"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Extract</span>
                </button>

                <button
                  onClick={handleBatchDelete}
                  disabled={selectedPages.length === 0 || selectedPages.length >= pageCount}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/40 text-xs font-medium disabled:opacity-40"
                  title="Delete Selected Pages"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete ({selectedPages.length})</span>
                </button>
              </>
            ) : (
              /* Kanban Global Actions */
              <button
                onClick={handleApplyKanbanOrder}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md transition-colors"
                title="Apply Kanban section ordering to master PDF sequence"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Kanban Sequence</span>
              </button>
            )}

            <div className="h-5 w-px bg-slate-700 mx-1" />

            <button
              onClick={handleMergeClick}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium shadow-sm"
              title="Merge another PDF into this document"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Merge PDF</span>
            </button>

            <button
              onClick={handleSplitPdf}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700"
              title="Split into individual page files"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Split All</span>
            </button>
          </div>
        </div>

        {/* 1. GRID VIEW MODE */}
        {viewMode === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {Array.from({ length: pageCount }).map((_, idx) => {
              const pageNum = idx + 1;
              const isSelected = selectedPages.includes(pageNum);
              const thumbUrl = thumbnails[idx];
              const isDragged = draggedGridIdx === idx;
              const isDragOver = dragOverGridIdx === idx;

              return (
                <div
                  key={idx}
                  draggable={true}
                  onDragStart={(e) => handleGridDragStart(e, idx)}
                  onDragOver={(e) => handleGridDragOver(e, idx)}
                  onDrop={(e) => handleGridDrop(e, idx)}
                  onClick={() => toggleSelectPage(pageNum)}
                  className={`relative rounded-xl border p-3 flex flex-col items-center cursor-pointer transition-all ${
                    isDragged ? 'opacity-40 scale-95 border-brand-400' : ''
                  } ${
                    isDragOver ? 'ring-2 ring-emerald-400 border-emerald-500 scale-105' : ''
                  } ${
                    isSelected
                      ? 'bg-brand-600/20 border-brand-500 ring-2 ring-brand-500/50 shadow-lg'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                  }`}
                >
                  <div className="w-full flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-1 text-slate-400">
                      <GripVertical className="w-3.5 h-3.5 cursor-grab" />
                      <span className="font-mono text-xs font-semibold text-slate-300">
                        Page {pageNum}
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center ${
                        isSelected
                          ? 'bg-brand-500 border-brand-400 text-white'
                          : 'border-slate-600 bg-slate-800'
                      }`}
                    >
                      {isSelected && <span className="text-[10px] leading-none">✓</span>}
                    </div>
                  </div>

                  <div className="w-full aspect-[1/1.4] bg-white rounded-lg border border-slate-700 overflow-hidden flex items-center justify-center shadow-md mb-2">
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={`Page ${pageNum}`} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-slate-400">Loading...</span>
                    )}
                  </div>

                  {/* Quick Action Controls */}
                  <div className="w-full flex items-center justify-between pt-2 border-t border-slate-800/80 text-slate-400">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => handleMovePage(e, idx, -1)}
                        disabled={idx === 0}
                        className="p-1 hover:text-white hover:bg-slate-800 rounded disabled:opacity-20"
                        title="Move Left"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleMovePage(e, idx, 1)}
                        disabled={idx === pageCount - 1}
                        className="p-1 hover:text-white hover:bg-slate-800 rounded disabled:opacity-20"
                        title="Move Right"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => handleSingleRotate(e, idx)}
                        className="p-1 hover:text-brand-400 hover:bg-slate-800 rounded"
                        title="Rotate 90° Clockwise"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleSingleDuplicate(e, idx)}
                        className="p-1 hover:text-emerald-400 hover:bg-slate-800 rounded"
                        title="Duplicate Page"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleSingleDelete(e, idx)}
                        disabled={pageCount <= 1}
                        className="p-1 hover:text-red-400 hover:bg-slate-800 rounded disabled:opacity-20"
                        title="Delete Page"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 2. KANBAN BOARD VIEW MODE */}
        {viewMode === 'kanban' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {kanbanSections.map((sec, secIdx) => {
              const isSectionDragOver = dragOverSecIdx === secIdx;

              return (
                <div
                  key={sec.id}
                  onDragOver={(e) => handleKanbanDragOverSection(e, secIdx)}
                  onDrop={() => handleKanbanDropOnSection(secIdx)}
                  className={`bg-slate-900/90 border rounded-xl flex flex-col min-h-[520px] shadow-md transition-colors ${
                    isSectionDragOver
                      ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-slate-850'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Column Header */}
                  <div
                    className="p-3 border-b border-slate-800 flex items-center justify-between rounded-t-xl"
                    style={{ borderTop: `3px solid ${sec.color}` }}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-xs text-slate-100">{sec.title}</span>
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold"
                        style={{ backgroundColor: `${sec.color}20`, color: sec.color }}
                      >
                        {sec.pages.length}
                      </span>
                    </div>

                    <button
                      onClick={() => handleExportSection(sec)}
                      disabled={sec.pages.length === 0}
                      className="p-1 text-slate-400 hover:text-white rounded disabled:opacity-30"
                      title={`Export ${sec.title} as PDF`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Column Cards Container */}
                  <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[650px]">
                    {sec.pages.length === 0 ? (
                      <div className="h-32 rounded-lg border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 text-xs text-center p-3">
                        <span>No pages in this section</span>
                        <span className="text-[10px] text-slate-600 mt-1">Drag or move pages here</span>
                      </div>
                    ) : (
                      sec.pages.map((pageNum, itemIdx) => {
                        const thumbIdx = pageNum - 1;
                        const thumbUrl = thumbnails[thumbIdx];
                        const isCardDragged = draggedKanbanItem?.pageNum === pageNum;

                        return (
                          <div
                            key={pageNum}
                            draggable={true}
                            onDragStart={(e) =>
                              handleKanbanDragStart(e, pageNum, secIdx, itemIdx)
                            }
                            className={`bg-slate-850 border border-slate-700/80 rounded-lg p-2.5 flex flex-col shadow-sm hover:border-slate-600 transition-all ${
                              isCardDragged ? 'opacity-40 scale-95' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-1.5">
                                <GripVertical className="w-3 h-3 text-slate-500 cursor-grab" />
                                <span className="font-mono text-xs font-bold text-slate-200">
                                  Page {pageNum}
                                </span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => handleKanbanReorderWithin(secIdx, itemIdx, -1)}
                                  disabled={itemIdx === 0}
                                  className="p-0.5 text-slate-400 hover:text-white disabled:opacity-20"
                                  title="Move Up in Column"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleKanbanReorderWithin(secIdx, itemIdx, 1)}
                                  disabled={itemIdx === sec.pages.length - 1}
                                  className="p-0.5 text-slate-400 hover:text-white disabled:opacity-20"
                                  title="Move Down in Column"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => handleKanbanDeletePage(e, pageNum)}
                                  disabled={pageCount <= 1}
                                  className="p-0.5 text-slate-400 hover:text-red-400 disabled:opacity-20 ml-1"
                                  title="Delete Page from Document"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            {/* Mini Thumbnail */}
                            <div className="w-full aspect-[1/1.3] bg-white rounded border border-slate-700 overflow-hidden flex items-center justify-center mb-2">
                              {thumbUrl ? (
                                <img src={thumbUrl} alt={`Page ${pageNum}`} className="w-full h-full object-contain" />
                              ) : (
                                <span className="text-[10px] text-slate-400">Page {pageNum}</span>
                              )}
                            </div>

                            {/* Kanban Navigation Controls */}
                            <div className="flex items-center justify-between pt-1.5 border-t border-slate-800 text-slate-400 text-[10px]">
                              <button
                                onClick={() => handleKanbanMoveSection(pageNum, secIdx, -1)}
                                disabled={secIdx === 0}
                                className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-750 hover:text-white disabled:opacity-20"
                                title="Move to Previous Section"
                              >
                                <ArrowLeft className="w-3 h-3" />
                                <span>Prev</span>
                              </button>

                              <button
                                onClick={(e) => handleSingleRotate(e, thumbIdx)}
                                className="p-1 hover:text-brand-400 rounded"
                                title="Rotate 90° Clockwise"
                              >
                                <RotateCw className="w-3 h-3" />
                              </button>

                              <button
                                onClick={() => handleKanbanMoveSection(pageNum, secIdx, 1)}
                                disabled={secIdx === kanbanSections.length - 1}
                                className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-750 hover:text-white disabled:opacity-20"
                                title="Move to Next Section"
                              >
                                <span>Next</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
