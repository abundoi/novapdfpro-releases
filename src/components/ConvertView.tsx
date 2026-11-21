import React, { useState, useRef, useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { converterService, ImagePageFit } from '../services/converter';
import { pdfEngine } from '../services/pdfEngine';
import { dbService } from '../services/db';
import {
  RefreshCw,
  FileText,
  Image as ImageIcon,
  Code,
  Download,
  Upload,
  CheckCircle,
  AlertCircle,
  Clock,
  FilePlus,
  FolderOpen,
  ExternalLink,
  Trash2,
} from 'lucide-react';

interface JobOutputFile {
  label: string;
  downloadUrl: string;
  downloadFilename: string;
}

interface ConversionJob {
  id: string;
  name: string;
  fromType: string;
  toType: string;
  status: 'processing' | 'done' | 'failed';
  outputs?: JobOutputFile[];
  pdfBytes?: Uint8Array;
  detail?: string;
  error?: string;
}

export const ConvertView: React.FC = () => {
  const {
    pdfBytes,
    currentFileName,
    currentPage,
    pageCount,
    isDirty,
    textItems,
    imageItems,
    annotations,
    formFields,
    watermark,
    headerFooter,
    security,
    loadPdfBytes,
    createNewDocument,
    setActiveTab,
    setStatusMessage,
  } = useEditorStore();

  const [targetFormat, setTargetFormat] = useState<'png' | 'jpeg' | 'txt' | 'html'>('png');
  const [pageScope, setPageScope] = useState<'all' | 'current'>('all');
  const [renderScale, setRenderScale] = useState<number>(2.0);
  const [includeUnsavedEdits, setIncludeUnsavedEdits] = useState<boolean>(true);
  const [imagePageFit, setImagePageFit] = useState<ImagePageFit>('a4');
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [showPasteText, setShowPasteText] = useState(false);
  const [pastedTitle, setPastedTitle] = useState('Converted Document');
  const [pastedBody, setPastedBody] = useState('');
  const [isDraggingImages, setIsDraggingImages] = useState(false);

  const imageFilesInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const openPdfInputRef = useRef<HTMLInputElement>(null);
  const createdUrlsRef = useRef<string[]>([]);

  const trackBlobUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    createdUrlsRef.current.push(url);
    return url;
  };

  useEffect(() => {
    return () => {
      for (const u of createdUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // Ignore revoke errors
        }
      }
      createdUrlsRef.current = [];
    };
  }, []);

  const getEffectivePdfBytes = async (): Promise<Uint8Array | null> => {
    if (!pdfBytes) return null;
    const hasEdits =
      isDirty ||
      textItems.length > 0 ||
      imageItems.length > 0 ||
      annotations.length > 0 ||
      formFields.length > 0;
    if (includeUnsavedEdits && hasEdits) {
      return await pdfEngine.applyModifications(pdfBytes, {
        textItems,
        imageItems,
        annotations,
        formFields,
        watermark,
        headerFooter,
        security,
      });
    }
    return pdfBytes;
  };

  // 1. Convert active PDF to PNG, JPEG, TXT, or HTML
  const handleConvertCurrentPdf = async () => {
    if (!pdfBytes) return;

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const baseName = currentFileName.replace(/\.pdf$/i, '') || 'Document';
    const selectedPages = pageScope === 'current' ? [currentPage] : undefined;

    setJobs((prev) => [
      {
        id: jobId,
        name: currentFileName,
        fromType: 'PDF',
        toType: targetFormat.toUpperCase(),
        status: 'processing',
      },
      ...prev,
    ]);
    setIsProcessing(true);

    try {
      const sourceBytes = await getEffectivePdfBytes();
      if (!sourceBytes) throw new Error('No PDF loaded.');

      if (targetFormat === 'png' || targetFormat === 'jpeg') {
        const images = await converterService.pdfToImages(
          sourceBytes,
          targetFormat,
          renderScale,
          selectedPages
        );
        if (images.length === 0) {
          throw new Error('No pages rendered for conversion.');
        }

        const outputs: JobOutputFile[] = images.map((img) => ({
          label: `Page ${img.pageNumber}`,
          downloadUrl: img.dataUrl,
          downloadFilename: `${baseName}_page${img.pageNumber}.${targetFormat === 'jpeg' ? 'jpg' : 'png'}`,
        }));

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'done',
                  outputs,
                  detail: `${outputs.length} ${outputs.length === 1 ? 'page' : 'pages'} @ ${Math.round(renderScale * 72)} DPI`,
                }
              : j
          )
        );
        dbService.logAudit(
          'CONVERT_DOCUMENT',
          `Converted ${currentFileName} (${outputs.length} page(s)) to ${targetFormat.toUpperCase()}`,
          currentFileName
        );
        setStatusMessage(`Converted ${outputs.length} page(s) to ${targetFormat.toUpperCase()}`);
      } else if (targetFormat === 'txt') {
        const text = await converterService.pdfToText(sourceBytes, selectedPages);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = trackBlobUrl(blob);
        const suffix = pageScope === 'current' ? `_page${currentPage}` : '';

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'done',
                  outputs: [
                    {
                      label: 'TXT Output',
                      downloadUrl: url,
                      downloadFilename: `${baseName}${suffix}_extracted.txt`,
                    },
                  ],
                  detail: `${text.length.toLocaleString()} characters extracted`,
                }
              : j
          )
        );
        dbService.logAudit(
          'CONVERT_DOCUMENT',
          `Converted ${currentFileName} to TXT`,
          currentFileName
        );
        setStatusMessage(`Extracted plain text from ${currentFileName}`);
      } else if (targetFormat === 'html') {
        const html = await converterService.pdfToHtml(sourceBytes, baseName, selectedPages);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = trackBlobUrl(blob);
        const suffix = pageScope === 'current' ? `_page${currentPage}` : '';

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'done',
                  outputs: [
                    {
                      label: 'HTML Document',
                      downloadUrl: url,
                      downloadFilename: `${baseName}${suffix}.html`,
                    },
                  ],
                  detail: `${pageScope === 'current' ? '1 page' : `${pageCount} pages`} structured HTML`,
                }
              : j
          )
        );
        dbService.logAudit(
          'CONVERT_DOCUMENT',
          `Converted ${currentFileName} to HTML`,
          currentFileName
        );
        setStatusMessage(`Exported structured HTML from ${currentFileName}`);
      }
    } catch (err: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'failed', error: err?.message || 'Conversion failed' }
            : j
        )
      );
      setStatusMessage(`Conversion error: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Convert Images to PDF (input or drag-and-drop)
  const processImageFilesToPdf = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(f.name)
    );
    if (files.length === 0) return;

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    setJobs((prev) => [
      {
        id: jobId,
        name: files.length === 1 ? files[0].name : `${files.length} Images Batch`,
        fromType: 'Images',
        toType: 'PDF',
        status: 'processing',
      },
      ...prev,
    ]);
    setIsProcessing(true);

    try {
      const imgList: Array<{ dataUrl: string; format: 'png' | 'jpeg' | 'auto'; name: string }> = [];

      for (const file of files) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
          reader.readAsDataURL(file);
        });
        const fmt: 'png' | 'jpeg' | 'auto' = file.type.includes('png')
          ? 'png'
          : file.type.includes('jpeg') || file.type.includes('jpg')
          ? 'jpeg'
          : 'auto';
        imgList.push({ dataUrl, format: fmt, name: file.name });
      }

      const compiledPdf = await converterService.imagesToPdf(imgList, imagePageFit);
      const blob = new Blob([compiledPdf as any], { type: 'application/pdf' });
      const url = trackBlobUrl(blob);
      const filename =
        files.length === 1
          ? `${files[0].name.replace(/\.[^/.]+$/, '')}.pdf`
          : `Images_Compiled_${Date.now()}.pdf`;

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'done',
                pdfBytes: compiledPdf,
                outputs: [{ label: 'PDF Document', downloadUrl: url, downloadFilename: filename }],
                detail: `${files.length} ${files.length === 1 ? 'image' : 'images'} • ${imagePageFit.toUpperCase()}`,
              }
            : j
        )
      );
      dbService.logAudit('CONVERT_DOCUMENT', `Converted ${files.length} image(s) into ${filename}`, filename);
      setStatusMessage(`Converted ${files.length} image(s) into ${filename}`);
    } catch (err: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'failed', error: err?.message || 'Image conversion failed' }
            : j
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImagesToPdfInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processImageFilesToPdf(files);
    }
    e.target.value = '';
  };

  // 3. Convert TXT / Markdown / pasted text to PDF
  const processTextContentToPdf = async (text: string, sourceName: string, title?: string) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    setJobs((prev) => [
      {
        id: jobId,
        name: sourceName,
        fromType: 'TXT',
        toType: 'PDF',
        status: 'processing',
      },
      ...prev,
    ]);
    setIsProcessing(true);

    try {
      const compiledPdf = await converterService.textToPdf(text, title);
      const blob = new Blob([compiledPdf as any], { type: 'application/pdf' });
      const url = trackBlobUrl(blob);
      const filename = `${sourceName.replace(/\.[^/.]+$/, '') || 'Text_Document'}.pdf`;

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'done',
                pdfBytes: compiledPdf,
                outputs: [{ label: 'PDF Document', downloadUrl: url, downloadFilename: filename }],
                detail: `${text.length.toLocaleString()} chars paginated`,
              }
            : j
        )
      );
      dbService.logAudit('CONVERT_DOCUMENT', `Converted text "${sourceName}" into ${filename}`, filename);
      setStatusMessage(`Converted "${sourceName}" to ${filename}`);
    } catch (err: any) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'failed', error: err?.message || 'Text conversion failed' }
            : j
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextToPdfInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      await processTextContentToPdf(text, file.name, file.name.replace(/\.[^/.]+$/, ''));
    }
    e.target.value = '';
  };

  const handleDownloadOutput = async (output: JobOutputFile, pdfData?: Uint8Array) => {
    if (pdfData && window.electronAPI) {
      const res = await window.electronAPI.savePdfDialog({
        defaultName: output.downloadFilename,
        data: pdfData,
      });
      if (res?.success) {
        setStatusMessage(`Saved ${output.downloadFilename} to ${res.filePath}`);
        return;
      }
    }
    const a = document.createElement('a');
    a.href = output.downloadUrl;
    a.download = output.downloadFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadAllOutputs = (outputs: JobOutputFile[]) => {
    outputs.forEach((out, idx) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = out.downloadUrl;
        a.download = out.downloadFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 140);
    });
  };

  const handleOpenGeneratedPdf = async (bytes: Uint8Array, filename: string) => {
    await loadPdfBytes(bytes, filename);
    setActiveTab('editor');
    setStatusMessage(`Opened ${filename} in PDF Editor`);
  };

  const handleOpenLocalPdfClick = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openPdfDialog();
      if (res) {
        await loadPdfBytes(new Uint8Array(res.data), res.name, res.filePath);
      }
    } else {
      openPdfInputRef.current?.click();
    }
  };

  const handleClearJobs = () => {
    for (const u of createdUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // Ignore
      }
    }
    createdUrlsRef.current = [];
    setJobs([]);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8 select-none text-slate-100">
      <input
        type="file"
        ref={imageFilesInputRef}
        onChange={handleImagesToPdfInput}
        multiple
        accept="image/png, image/jpeg, image/webp, image/bmp"
        className="hidden"
      />
      <input
        type="file"
        ref={textFileInputRef}
        onChange={handleTextToPdfInput}
        accept=".txt,.md,.csv,text/plain"
        className="hidden"
      />
      <input
        type="file"
        ref={openPdfInputRef}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const buf = await f.arrayBuffer();
            await loadPdfBytes(new Uint8Array(buf), f.name);
          }
          e.target.value = '';
        }}
        accept="application/pdf"
        className="hidden"
      />

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
              <RefreshCw className="w-5 h-5 text-purple-400" />
              <span>Local PDF Conversion Center</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Perform 100% offline bidirectional conversions between PDF, PNG, JPG, TXT, and HTML locally.
            </p>
          </div>

          {!pdfBytes && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => createNewDocument('A4')}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
              >
                <FilePlus className="w-3.5 h-3.5 text-brand-400" />
                <span>Create Blank PDF</span>
              </button>
              <button
                onClick={handleOpenLocalPdfClick}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open Local PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Section 1: Convert Active PDF */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-200">
                Export Active PDF to Another Format
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Target document:{' '}
                <span className="text-brand-300 font-medium">
                  {pdfBytes ? `${currentFileName} (${pageCount} pages)` : 'No PDF loaded'}
                </span>
              </p>
            </div>

            {pdfBytes && (
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnsavedEdits}
                  onChange={(e) => setIncludeUnsavedEdits(e.target.checked)}
                  className="accent-purple-500 rounded"
                />
                <span>Include active editor annotations &amp; text</span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => setTargetFormat('png')}
              className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all ${
                targetFormat === 'png'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-5 h-5" />
              <span className="font-semibold text-xs">PDF to PNG</span>
              <span className="text-[10px] text-slate-500">All pages lossless raster</span>
            </button>

            <button
              onClick={() => setTargetFormat('jpeg')}
              className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all ${
                targetFormat === 'jpeg'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-5 h-5" />
              <span className="font-semibold text-xs">PDF to JPG</span>
              <span className="text-[10px] text-slate-500">Compact page images</span>
            </button>

            <button
              onClick={() => setTargetFormat('txt')}
              className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all ${
                targetFormat === 'txt'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-5 h-5" />
              <span className="font-semibold text-xs">PDF to TXT</span>
              <span className="text-[10px] text-slate-500">Line-preserved text</span>
            </button>

            <button
              onClick={() => setTargetFormat('html')}
              className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all ${
                targetFormat === 'html'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-5 h-5" />
              <span className="font-semibold text-xs">PDF to HTML</span>
              <span className="text-[10px] text-slate-500">Structured web layout</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400">Pages:</span>
                <select
                  value={pageScope}
                  onChange={(e) => setPageScope(e.target.value as 'all' | 'current')}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                >
                  <option value="all">All Pages ({pageCount || 1})</option>
                  <option value="current">Current Page (Page {currentPage})</option>
                </select>
              </div>

              {(targetFormat === 'png' || targetFormat === 'jpeg') && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-400">Resolution:</span>
                  <select
                    value={renderScale}
                    onChange={(e) => setRenderScale(Number(e.target.value))}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                  >
                    <option value={1.5}>Standard (108 DPI)</option>
                    <option value={2.0}>High (144 DPI)</option>
                    <option value={3.0}>Ultra Print (216 DPI)</option>
                  </select>
                </div>
              )}
            </div>

            <button
              onClick={handleConvertCurrentPdf}
              disabled={!pdfBytes || isProcessing}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-md disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>{isProcessing ? 'Converting...' : 'Start Local Conversion'}</span>
            </button>
          </div>
        </div>

        {/* Section 2: Convert External Files into PDF */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-sm text-slate-200">Convert External Files into PDF</h3>
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">Image Page Layout:</span>
              <select
                value={imagePageFit}
                onChange={(e) => setImagePageFit(e.target.value as ImagePageFit)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
              >
                <option value="a4">Fit to A4 Page</option>
                <option value="letter">Fit to US Letter</option>
                <option value="original">Original Image Dimensions</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              onClick={() => imageFilesInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImages(true);
              }}
              onDragLeave={() => setIsDraggingImages(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDraggingImages(false);
                if (e.dataTransfer.files?.length) {
                  await processImageFilesToPdf(e.dataTransfer.files);
                }
              }}
              className={`p-5 rounded-lg border border-dashed cursor-pointer flex flex-col items-center justify-center text-center space-y-2 transition-all ${
                isDraggingImages
                  ? 'border-brand-400 bg-brand-600/15'
                  : 'border-slate-700 hover:border-brand-500/50 bg-slate-950/40 hover:bg-slate-800/60'
              }`}
            >
              <Upload className="w-6 h-6 text-brand-400" />
              <div>
                <span className="font-medium text-xs text-slate-200">Images to PDF</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click or drop PNG, JPG, WEBP, or BMP files to merge into one PDF
                </p>
              </div>
            </div>

            <div className="p-5 rounded-lg border border-dashed border-slate-700 hover:border-emerald-500/50 bg-slate-950/40 flex flex-col items-center justify-center text-center space-y-2.5 transition-all">
              <FileText className="w-6 h-6 text-emerald-400" />
              <div>
                <span className="font-medium text-xs text-slate-200">Text to PDF</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Import .txt / .md / .csv or paste text into a paginated PDF
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => textFileInputRef.current?.click()}
                  className="px-3 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium"
                >
                  Select Text File
                </button>
                <button
                  type="button"
                  onClick={() => setShowPasteText((v) => !v)}
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium"
                >
                  {showPasteText ? 'Hide Editor' : 'Paste Text'}
                </button>
              </div>
            </div>
          </div>

          {showPasteText && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  placeholder="Document Title"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  disabled={!pastedBody.trim() || isProcessing}
                  onClick={async () => {
                    await processTextContentToPdf(pastedBody, `${pastedTitle || 'Document'}.txt`, pastedTitle);
                    setPastedBody('');
                    setShowPasteText(false);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold"
                >
                  Create PDF from Text
                </button>
              </div>
              <textarea
                rows={5}
                value={pastedBody}
                onChange={(e) => setPastedBody(e.target.value)}
                placeholder="Paste or type plain text content here..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-100 outline-none focus:border-emerald-500 font-mono"
              />
            </div>
          )}
        </div>

        {/* Section 3: Conversion History & Output Files */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-semibold text-sm text-slate-200 flex items-center space-x-2">
              <Clock className="w-4 h-4 text-purple-400" />
              <span>Conversion Jobs &amp; Output Files</span>
            </h3>
            <div className="flex items-center space-x-3">
              <span className="text-xs text-slate-500">
                {jobs.filter((j) => j.status === 'done').length} completed
              </span>
              {jobs.length > 0 && (
                <button
                  onClick={handleClearJobs}
                  className="flex items-center space-x-1 text-[11px] text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {jobs.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              No conversion jobs executed yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center space-x-3">
                    {job.status === 'done' ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : job.status === 'processing' ? (
                      <RefreshCw className="w-4 h-4 text-purple-400 animate-spin shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <div>
                      <div>
                        <span className="font-medium text-slate-200">{job.name}</span>
                        <span className="text-slate-500 ml-2">
                          ({job.fromType} → {job.toType})
                        </span>
                      </div>
                      {job.detail && (
                        <div className="text-[11px] text-slate-400">{job.detail}</div>
                      )}
                      {job.error && (
                        <div className="text-[11px] text-red-400">{job.error}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {job.pdfBytes && job.outputs?.[0] && (
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenGeneratedPdf(job.pdfBytes!, job.outputs![0].downloadFilename)
                        }
                        className="flex items-center space-x-1.5 px-3 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 text-[11px] font-medium"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open in Editor</span>
                      </button>
                    )}

                    {job.outputs && job.outputs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDownloadAllOutputs(job.outputs!)}
                        className="flex items-center space-x-1.5 px-3 py-1 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-[11px] font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download All ({job.outputs.length})</span>
                      </button>
                    )}

                    {job.outputs &&
                      job.outputs.map((out, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleDownloadOutput(out, job.pdfBytes)}
                          className="flex items-center space-x-1.5 px-3 py-1 rounded bg-brand-600/30 text-brand-300 hover:bg-brand-600/50 border border-brand-500/40 text-[11px]"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>
                            {job.outputs!.length > 1 ? out.label : 'Download'}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
