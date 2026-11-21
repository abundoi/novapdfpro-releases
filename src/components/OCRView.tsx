import React, { useState, useMemo } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { ocrEngine, OCRPageResult } from '../services/ocrEngine';
import {
  ScanText,
  Play,
  Copy,
  Download,
  CheckCircle,
  FileText,
  Sliders,
  Sparkles,
  Search,
  FileCheck2,
  FileCode,
  Layers,
  BarChart3,
  Check,
  Save,
} from 'lucide-react';

export const OCRView: React.FC = () => {
  const {
    pdfBytes,
    pdfDocProxy,
    currentPage,
    pageCount,
    currentFileName,
    currentFilePath,
    loadPdfBytes,
    setStatusMessage,
  } = useEditorStore();

  const [language, setLanguage] = useState<string>('eng');
  const [enhanceContrast, setEnhanceContrast] = useState<boolean>(true);
  const [pageScope, setPageScope] = useState<'current' | 'all' | 'custom'>('current');
  const [customRange, setCustomRange] = useState<string>('1');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('');
  const [results, setResults] = useState<OCRPageResult[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExportingSearchable, setIsExportingSearchable] = useState<boolean>(false);
  const [ocrAppliedToDoc, setOcrAppliedToDoc] = useState<boolean>(false);

  const handleApplyOcrToDocument = async () => {
    if (!pdfBytes || results.length === 0) return;
    setIsExportingSearchable(true);
    setStatusMessage('Embedding invisible OCR text layer into active PDF...');
    try {
      const searchablePdfBytes = await ocrEngine.createSearchablePdf(pdfBytes, results);
      await loadPdfBytes(searchablePdfBytes, currentFileName, currentFilePath || undefined);
      setOcrAppliedToDoc(true);
      setStatusMessage('OCR text layer applied to active document');
      setTimeout(() => setOcrAppliedToDoc(false), 3000);
    } catch (err: any) {
      setStatusMessage(`OCR Apply Error: ${err.message}`);
    } finally {
      setIsExportingSearchable(false);
    }
  };

  // Parse custom range string like "1, 3-5, 8" into unique page numbers
  const parsePageNumbers = (): number[] => {
    if (pageScope === 'current') return [currentPage];
    if (pageScope === 'all') return Array.from({ length: pageCount }, (_, i) => i + 1);

    const pages = new Set<number>();
    const parts = customRange.split(',').map((s) => s.trim()).filter(Boolean);

    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.max(1, Math.min(start, end));
          const max = Math.min(pageCount, Math.max(start, end));
          for (let p = min; p <= max; p++) pages.add(p);
        }
      } else {
        const p = parseInt(part, 10);
        if (!isNaN(p) && p >= 1 && p <= pageCount) {
          pages.add(p);
        }
      }
    }

    const sorted = Array.from(pages).sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : [1];
  };

  const handleStartOCR = async () => {
    if (!pdfDocProxy || !pdfBytes) return;

    const targetPages = parsePageNumbers();
    if (targetPages.length === 0) {
      setProgressStatus('Please specify valid pages to process.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressStatus('Initializing local OCR engine...');
    setStatusMessage('Running offline OCR...');

    try {
      const ocrResults = await ocrEngine.batchRecognize(pdfDocProxy, targetPages, {
        language,
        enhanceContrast,
        onProgress: (p, s) => {
          setProgress(p);
          setProgressStatus(s);
        },
      });

      setResults(ocrResults);
      setStatusMessage('OCR recognition completed');
    } catch (err: any) {
      setProgressStatus(`OCR Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const fullExtractedText = useMemo(() => {
    return results.map((r) => `--- Page ${r.pageNumber} ---\n${r.text}`).join('\n\n');
  }, [results]);

  const stats = useMemo(() => {
    return ocrEngine.calculateStats(results);
  }, [results]);

  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return results;
    const query = searchQuery.toLowerCase();
    return results.filter((r) => r.text.toLowerCase().includes(query));
  }, [results, searchQuery]);

  const handleCopyText = () => {
    if (!fullExtractedText) return;
    navigator.clipboard.writeText(fullExtractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadText = () => {
    if (!fullExtractedText) return;
    const blob = new Blob([fullExtractedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName.replace('.pdf', '')}_OCR_Text.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (results.length === 0) return;
    const payload = {
      document: currentFileName,
      processedAt: new Date().toISOString(),
      engine: 'NovaPDFPro Offline OCR',
      metrics: stats,
      pages: results,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName.replace('.pdf', '')}_OCR_Data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSearchablePdf = async () => {
    if (!pdfBytes || results.length === 0) return;
    setIsExportingSearchable(true);
    setStatusMessage('Generating enterprise searchable PDF text layer...');

    try {
      const searchablePdfBytes = await ocrEngine.createSearchablePdf(pdfBytes, results);
      const outName = `${currentFileName.replace('.pdf', '')}_Searchable.pdf`;

      if (window.electronAPI) {
        await window.electronAPI.savePdfDialog({
          defaultName: outName,
          data: searchablePdfBytes,
        });
      } else {
        const blob = new Blob([searchablePdfBytes as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatusMessage('Searchable PDF exported successfully');
    } catch (err: any) {
      console.error('Failed to create Searchable PDF:', err);
      setStatusMessage(`Searchable PDF Error: ${err.message}`);
    } finally {
      setIsExportingSearchable(false);
    }
  };

  if (!pdfBytes) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-400">
        <ScanText className="w-12 h-12 text-slate-600 mb-3" />
        <h3 className="text-base font-semibold text-slate-200">No Document Open for OCR</h3>
        <p className="text-xs text-slate-500 mt-1">Please open a scanned PDF document to recognize text.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 select-none text-slate-100">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
            <ScanText className="w-5 h-5 text-amber-400" />
            <span>Offline Optical Character Recognition (OCR)</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
              Enterprise Grade
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Transform scanned bitmap documents and image-based PDFs into searchable, selectable text layers with zero cloud dependencies.
          </p>
        </div>

        {/* Configuration Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200 border-b border-slate-800 pb-3">
            <Sliders className="w-4 h-4 text-brand-400" />
            <span>OCR Parameters & Engine Settings</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Language */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Recognition Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-brand-500"
              >
                <option value="eng">English (eng)</option>
                <option value="deu">German (deu)</option>
                <option value="fra">French (fra)</option>
                <option value="spa">Spanish (spa)</option>
                <option value="ita">Italian (ita)</option>
                <option value="por">Portuguese (por)</option>
                <option value="chi_sim">Chinese Simplified (chi_sim)</option>
                <option value="jpn">Japanese (jpn)</option>
              </select>
            </div>

            {/* Scope */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Target Page Scope</label>
              <select
                value={pageScope}
                onChange={(e) => setPageScope(e.target.value as any)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-brand-500"
              >
                <option value="current">Current Page (Page {currentPage})</option>
                <option value="all">All Pages ({pageCount} pages)</option>
                <option value="custom">Custom Page Range</option>
              </select>
            </div>

            {/* Preprocessing */}
            <div className="space-y-1.5 flex flex-col justify-end pb-1">
              <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={enhanceContrast}
                  onChange={(e) => setEnhanceContrast(e.target.checked)}
                  className="accent-brand-500 rounded"
                />
                <span>Adaptive Contrast & Deskew Preprocessing</span>
              </label>
            </div>
          </div>

          {/* Custom Range Input */}
          {pageScope === 'custom' && (
            <div className="pt-2 border-t border-slate-800/80 flex items-center space-x-3">
              <span className="text-xs text-slate-400">Pages to process:</span>
              <input
                type="text"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                placeholder="e.g. 1, 3-5, 8"
                className="w-64 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none font-mono focus:border-brand-500"
              />
              <span className="text-[11px] text-slate-500">Document has {pageCount} pages</span>
            </div>
          )}

          {/* Progress Bar */}
          {isProcessing && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex justify-between text-xs font-mono text-slate-300">
                <span>{progressStatus}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Trigger Button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleStartOCR}
              disabled={isProcessing}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition-colors shadow-md disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isProcessing ? 'Processing OCR...' : 'Run Local OCR Engine'}</span>
            </button>
          </div>
        </div>

        {/* OCR Metrics Summary Cards */}
        {results.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium">Pages Recognized</p>
                <p className="text-lg font-bold text-slate-100">{stats.totalPages}</p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium">Words Extracted</p>
                <p className="text-lg font-bold text-slate-100">{stats.totalWords.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium">Avg Confidence</p>
                <p className="text-lg font-bold text-amber-400">{stats.avgConfidence}%</p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <FileCheck2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-medium">Searchable PDF</p>
                <p className="text-sm font-bold text-emerald-400 flex items-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Ready</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results Card */}
        {results.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-3 gap-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-sm text-slate-200">
                  Extracted Text Results
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Apply OCR text layer directly to open document */}
                <button
                  onClick={handleApplyOcrToDocument}
                  disabled={isExportingSearchable}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium shadow-sm transition-colors disabled:opacity-40"
                  title="Embed recognized invisible text layer into the active PDF workspace"
                >
                  {ocrAppliedToDoc ? <Check className="w-3.5 h-3.5" /> : <FileCheck2 className="w-3.5 h-3.5" />}
                  <span>{ocrAppliedToDoc ? 'Applied to PDF!' : 'Apply to Active PDF'}</span>
                </button>

                {/* Save Searchable PDF */}
                <button
                  onClick={handleExportSearchablePdf}
                  disabled={isExportingSearchable}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-40"
                  title="Inject invisible text layer and save Searchable PDF to disk"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isExportingSearchable ? 'Compiling PDF...' : 'Save Searchable PDF'}</span>
                </button>

                {/* Export JSON */}
                <button
                  onClick={handleExportJson}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 border border-purple-500/40 text-xs font-medium transition-colors"
                  title="Download full word bounding boxes and coordinates in JSON format"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>

                {/* Copy Text */}
                <button
                  onClick={handleCopyText}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied!' : 'Copy Text'}</span>
                </button>

                {/* Download TXT */}
                <button
                  onClick={handleDownloadText}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-brand-600/30 text-brand-300 hover:bg-brand-600/50 border border-brand-500/40 text-xs font-medium transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .TXT</span>
                </button>
              </div>
            </div>

            {/* In-Results Search Bar */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search keywords within recognized OCR text..."
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500 font-sans"
              />
              {searchQuery && (
                <div className="text-[11px] text-slate-400 mt-1 pl-1">
                  Found {filteredResults.length} matching {filteredResults.length === 1 ? 'page' : 'pages'}
                </div>
              )}
            </div>

            {/* Results List */}
            <div className="space-y-4">
              {filteredResults.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4 text-center">
                  No matching text found for "{searchQuery}".
                </p>
              ) : (
                filteredResults.map((res) => (
                  <div key={res.pageNumber} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Page {res.pageNumber}</span>
                      <span className="font-mono text-emerald-400">
                        Confidence: {Math.round(res.confidence)}%
                      </span>
                    </div>
                    <textarea
                      readOnly
                      value={res.text}
                      rows={6}
                      className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg p-3 text-xs text-slate-200 font-mono outline-none"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
