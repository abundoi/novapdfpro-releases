import React, { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { dbService, StoredDocument } from '../services/db';
import {
  FileText,
  FilePlus,
  FolderOpen,
  LayoutGrid,
  RefreshCw,
  ScanText,
  PenTool,
  Star,
  Clock,
  HardDrive,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const { pdfBytes, currentDocId, loadPdfBytes, createNewDocument, setActiveTab, setStatusMessage } =
    useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<StoredDocument[]>(() => dbService.getDocuments());
  const [missingDocAlert, setMissingDocAlert] = useState<{
    id: string;
    name: string;
    message: string;
  } | null>(null);
  const [missingIds, setMissingIds] = useState<Record<string, boolean>>({});

  const refreshDocs = () => {
    setDocs(dbService.getDocuments());
  };

  useEffect(() => {
    const list = dbService.getDocuments();
    setDocs(list);
    if (!window.electronAPI?.checkFileExists) return;
    let cancelled = false;
    (async () => {
      const statusMap: Record<string, boolean> = {};
      for (const d of list) {
        if (d.path) {
          const check = await window.electronAPI!.checkFileExists!(d.path);
          if (!check.exists) statusMap[d.id] = true;
        }
      }
      if (!cancelled) setMissingIds(statusMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDocId]);

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

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const buf = await file.arrayBuffer();
      await loadPdfBytes(new Uint8Array(buf), file.name);
    }
  };

  const handleOpenRecentDoc = async (doc: StoredDocument) => {
    setMissingDocAlert(null);

    // 1. Always try tracing back the saved file path on disk first (unless deleted or renamed)
    if (doc.path && window.electronAPI?.openPdfDialog) {
      const res = await window.electronAPI.openPdfDialog(doc.path);
      if (res && res.data) {
        setMissingIds((prev) => {
          const next = { ...prev };
          delete next[doc.id];
          return next;
        });
        await loadPdfBytes(new Uint8Array(res.data), res.name, res.filePath);
        return;
      }

      // File was deleted, moved, or renamed — keep user on Home page and warn cleanly
      setMissingIds((prev) => ({ ...prev, [doc.id]: true }));
      const msg = `Cannot open "${doc.name}" at "${doc.path}". The document may have been deleted, moved, or renamed.`;
      setMissingDocAlert({ id: doc.id, name: doc.name, message: msg });
      setStatusMessage(`Missing file: ${doc.name}`);
      return;
    }

    // 2. Active in-memory document without disk path (e.g., unsaved New Blank PDF)
    if (doc.id === currentDocId && pdfBytes) {
      setActiveTab('editor');
      return;
    }

    // 3. Unsaved/browser entry with no traceable disk file path
    setMissingDocAlert({
      id: doc.id,
      name: doc.name,
      message: `"${doc.name}" does not have a saved file path on disk to trace back (it was not saved or was opened in browser mode).`,
    });
  };

  const handleDeleteRecentDoc = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dbService.deleteDocument(id);
    if (missingDocAlert?.id === id) {
      setMissingDocAlert(null);
    }
    refreshDocs();
  };

  const handleToggleFavorite = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    dbService.toggleFavorite(id);
    refreshDocs();
  };

  const handleClearAllRecents = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dbService.clearDocuments();
    setMissingDocAlert(null);
    setMissingIds({});
    refreshDocs();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 select-none text-slate-100">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        accept="application/pdf"
        className="hidden"
      />

      {/* Header Banner */}
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2.5">
              <span>NovaPDFPro</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 font-mono border border-brand-500/30">
                v01.31 Windows Edition
              </span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Commercially viable, offline-first PDF manipulation, editing, OCR and digital signature suite.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => createNewDocument('A4')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition-colors shadow-sm"
            >
              <FilePlus className="w-4 h-4 text-brand-400" />
              <span>New Blank PDF</span>
            </button>

            <button
              onClick={handleOpenClick}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs transition-colors shadow-md shadow-brand-600/20"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Open Local Document</span>
            </button>
          </div>
        </div>

        {/* Quick Launch Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div
            onClick={() => setActiveTab('editor')}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-500/50 hover:bg-slate-850 cursor-pointer transition-all group shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 mb-3 group-hover:scale-110 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-slate-100 group-hover:text-brand-300">
              PDF Editor
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Edit existing text, insert images, add shapes, annotations, stamps, and permanent redactions.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('organize')}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-850 cursor-pointer transition-all group shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3 group-hover:scale-110 transition-transform">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-slate-100 group-hover:text-emerald-300">
              Organize & Merge
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Reorder pages, rotate, duplicate, extract, merge multiple PDFs, or split into single pages.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('ocr')}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-850 cursor-pointer transition-all group shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 group-hover:scale-110 transition-transform">
              <ScanText className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-slate-100 group-hover:text-amber-300">
              Offline OCR Engine
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Extract text from scanned documents locally using bundled Tesseract models.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('convert')}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-850 cursor-pointer transition-all group shadow-sm"
          >
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mb-3 group-hover:scale-110 transition-transform">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-slate-100 group-hover:text-purple-300">
              Conversion Center
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Batch convert PDFs to Images, TXT, HTML or compile images and text into PDFs.
            </p>
          </div>
        </div>

        {/* Recent Documents Table */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
              <Clock className="w-4 h-4 text-brand-400" />
              <span>Recent Documents</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-xs text-slate-500">{docs.length} tracked documents</span>
              {docs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllRecents}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-300 border border-slate-700 hover:border-red-700/60 text-xs font-medium transition-colors"
                  title="Clear all recent documents records"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          {missingDocAlert && (
            <div className="mb-4 bg-amber-950/40 border border-amber-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-start space-x-2.5 text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Document Not Found on Disk</div>
                  <div className="text-[11px] text-amber-300/85 mt-0.5">{missingDocAlert.message}</div>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => handleDeleteRecentDoc(e, missingDocAlert.id)}
                  className="px-2.5 py-1 rounded-lg bg-red-900/50 hover:bg-red-800/70 text-red-200 border border-red-700/60 text-[11px] font-medium"
                >
                  Remove Entry
                </button>
                <button
                  type="button"
                  onClick={() => setMissingDocAlert(null)}
                  className="p-1 text-slate-400 hover:text-white"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {docs.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              <FolderOpen className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <span>No recent documents opened yet. Click &quot;Open Local Document&quot; above.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-3 font-medium">Document</th>
                    <th className="pb-3 font-medium">Pages</th>
                    <th className="pb-3 font-medium">Size</th>
                    <th className="pb-3 font-medium">Last Opened</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {docs.map((doc) => {
                    const isMissing = Boolean(missingIds[doc.id]);
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => handleOpenRecentDoc(doc)}
                        className={`hover:bg-slate-800/50 cursor-pointer transition-colors group ${
                          isMissing ? 'opacity-75' : ''
                        }`}
                        title={doc.path ? `Click to open ${doc.path}` : doc.name}
                      >
                        <td className="py-3 font-medium text-slate-200">
                          <div className="flex items-center space-x-2">
                            <FileText
                              className={`w-4 h-4 flex-shrink-0 ${
                                isMissing ? 'text-amber-400' : 'text-brand-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="truncate max-w-md group-hover:text-brand-300 transition-colors">
                                  {doc.name}
                                </span>
                                {isMissing && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                                    Deleted / Renamed
                                  </span>
                                )}
                              </div>
                              {doc.path && (
                                <div className="text-[10px] text-slate-500 font-mono truncate max-w-lg">
                                  {doc.path}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-slate-400">{doc.pageCount} pages</td>
                        <td className="py-3 text-slate-400 font-mono">{formatSize(doc.sizeBytes)}</td>
                        <td className="py-3 text-slate-400">
                          {new Date(doc.lastModified).toLocaleDateString()}
                        </td>
                        <td
                          className="py-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              type="button"
                              onClick={(e) => handleToggleFavorite(e, doc.id)}
                              className={`p-1.5 rounded hover:bg-slate-700/60 hover:text-amber-400 transition-colors ${
                                doc.isFavorite ? 'text-amber-400' : 'text-slate-500'
                              }`}
                              title="Favorite"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteRecentDoc(e, doc.id)}
                              className="p-1.5 rounded hover:bg-red-950/60 text-slate-500 hover:text-red-400 transition-colors"
                              title="Remove from Recents"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
