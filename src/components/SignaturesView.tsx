import React, { useRef, useState, useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { dbService } from '../services/db';
import {
  SIGNATURE_FONTS,
  SIGNATURE_INK_COLORS,
  SIGNING_REASONS,
  SignatureMode,
  SavedSignatureItem,
  computeSha256Hex,
  computeSignatureSealDigest,
  formatCertificateTimestamp,
  trimSignatureCanvas,
  renderTypedSignature,
  processUploadedSignature,
  fitSignatureDimensions,
  loadSavedSignatures,
  saveSignaturesList,
} from '../services/signatureService';
import {
  PenTool,
  Type,
  Upload,
  Check,
  RotateCcw,
  Undo2,
  ShieldCheck,
  FileSignature,
  Trash2,
  FilePlus,
  FolderOpen,
  BadgeCheck,
  X,
} from 'lucide-react';

const CERT_DEFAULTS_KEY = 'novapdfpro_certificate_defaults_v1';

interface CertificateDefaults {
  includeAuditSeal: boolean;
  signerName: string;
  signerRole: string;
  signingReason: string;
}

function loadCertificateDefaults(): CertificateDefaults {
  try {
    const raw = localStorage.getItem(CERT_DEFAULTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        includeAuditSeal: parsed.includeAuditSeal !== false,
        signerName: String(parsed.signerName || 'Authorized Signer'),
        signerRole: String(parsed.signerRole || 'AUTHORIZED SIGNER'),
        signingReason: String(parsed.signingReason || SIGNING_REASONS[0]),
      };
    }
  } catch {
    // Ignore storage read failures
  }
  return {
    includeAuditSeal: true,
    signerName: 'Authorized Signer',
    signerRole: 'AUTHORIZED SIGNER',
    signingReason: SIGNING_REASONS[0],
  };
}

interface StrokePath {
  color: string;
  lineWidth: number;
  points: Array<{ x: number; y: number }>;
}

export const SignaturesView: React.FC = () => {
  const {
    currentPage,
    pageCount,
    pageMetas,
    currentFileName,
    pdfBytes,
    pendingSignatureTarget,
    setPendingSignatureTarget,
    addImageItem,
    addAnnotation,
    updateAnnotation,
    deleteFormField,
    setStatusMessage,
    setActiveTab,
    createNewDocument,
    loadPdfBytes,
  } = useEditorStore();

  const [creationMode, setCreationMode] = useState<SignatureMode>('draw');
  const [inkColor, setInkColor] = useState<string>(SIGNATURE_INK_COLORS[0].value);
  const [penWeight, setPenWeight] = useState<number>(3.5);

  // Draw canvas state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openPdfInputRef = useRef<HTMLInputElement>(null);
  const isDrawingRef = useRef<boolean>(false);
  const strokesRef = useRef<StrokePath[]>([]);
  const activeStrokeRef = useRef<StrokePath | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  // Type signature state
  const [typedName, setTypedName] = useState<string>('Authorized Signer');
  const [typedFontId, setTypedFontId] = useState<string>(SIGNATURE_FONTS[0].id);

  // Upload signature state
  const [uploadedRawUrl, setUploadedRawUrl] = useState<string | null>(null);
  const [uploadedProcessed, setUploadedProcessed] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState<boolean>(true);

  // Digital certificate & cryptographic seal state (persisted locally)
  const initialCert = React.useMemo(() => loadCertificateDefaults(), []);
  const [includeAuditSeal, setIncludeAuditSeal] = useState<boolean>(initialCert.includeAuditSeal);
  const [signerName, setSignerName] = useState<string>(initialCert.signerName);
  const [signerRole, setSignerRole] = useState<string>(initialCert.signerRole);
  const [signingReason, setSigningReason] = useState<string>(initialCert.signingReason);
  const [certAppliedFeedback, setCertAppliedFeedback] = useState<boolean>(false);
  const [documentSha256, setDocumentSha256] = useState<string>('');
  const [lastSealDigest, setLastSealDigest] = useState<string | null>(null);

  const handleApplyCertificateSettings = async () => {
    const cleanName = signerName.trim() || 'Authorized Signer';
    const cleanRole = signerRole.trim() || 'AUTHORIZED SIGNER';
    const cleanReason = signingReason.trim() || SIGNING_REASONS[0];

    setSignerName(cleanName);
    setSignerRole(cleanRole);
    setSigningReason(cleanReason);

    try {
      localStorage.setItem(
        CERT_DEFAULTS_KEY,
        JSON.stringify({
          includeAuditSeal,
          signerName: cleanName,
          signerRole: cleanRole,
          signingReason: cleanReason,
        })
      );
    } catch {
      // Ignore storage write failures
    }

    // Update any attached SHA-256 certificate seals currently queued on the open PDF
    const currentAnns = useEditorStore.getState().annotations;
    const certAnns = currentAnns.filter((a) => a.certificateMeta);
    if (certAnns.length > 0 && pdfBytes) {
      const docHash = documentSha256 || (await computeSha256Hex(pdfBytes));
      const tsIso = new Date().toISOString();
      const recomputedDigest = await computeSignatureSealDigest({
        documentSha256: docHash,
        signerName: cleanName,
        signerRole: cleanRole,
        reason: cleanReason,
        timestampIso: tsIso,
        signatureDataUrl: lastSealDigest || docHash,
      });
      for (const ann of certAnns) {
        updateAnnotation(ann.id, {
          author: cleanName,
          certificateMeta: {
            signerName: cleanName,
            signerRole: cleanRole,
            reason: cleanReason,
            timestampIso: tsIso,
            sha256: recomputedDigest,
          },
        });
      }
      setLastSealDigest(recomputedDigest);
    }

    setCertAppliedFeedback(true);
    setStatusMessage(`Digital certificate settings applied & saved (${cleanName} • ${cleanRole})`);
    setTimeout(() => setCertAppliedFeedback(false), 2500);
  };

  // Saved library
  const [savedSignatures, setSavedSignatures] = useState<SavedSignatureItem[]>(() =>
    loadSavedSignatures()
  );

  // Compute real SHA-256 fingerprint of the active PDF bytes
  useEffect(() => {
    let cancelled = false;
    if (!pdfBytes) {
      setDocumentSha256('');
      return;
    }
    computeSha256Hex(pdfBytes)
      .then((hex) => {
        if (!cancelled) setDocumentSha256(hex);
      })
      .catch(() => {
        if (!cancelled) setDocumentSha256('');
      });
    return () => {
      cancelled = true;
    };
  }, [pdfBytes]);

  // Re-process uploaded signature whenever raw file or white-bg removal changes
  useEffect(() => {
    let cancelled = false;
    if (!uploadedRawUrl) {
      setUploadedProcessed(null);
      return;
    }
    processUploadedSignature(uploadedRawUrl, removeWhiteBg)
      .then((res) => {
        if (!cancelled) setUploadedProcessed(res);
      })
      .catch(() => {
        if (!cancelled) setUploadedProcessed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uploadedRawUrl, removeWhiteBg]);

  // Redraw all strokes smoothly onto the high-resolution draw canvas
  const redrawCanvasStrokes = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const allStrokes = activeStrokeRef.current
      ? [...strokesRef.current, activeStrokeRef.current]
      : strokesRef.current;

    for (const stroke of allStrokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  };

  // Accurate CSS-to-canvas coordinate scaling
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events may not support capture
    }
    const pt = getCanvasPoint(e);
    activeStrokeRef.current = {
      color: inkColor,
      lineWidth: penWeight,
      points: [pt],
    };
    isDrawingRef.current = true;
    redrawCanvasStrokes();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !activeStrokeRef.current) return;
    const pt = getCanvasPoint(e);
    activeStrokeRef.current.points.push(pt);
    redrawCanvasStrokes();
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (activeStrokeRef.current && activeStrokeRef.current.points.length > 0) {
      strokesRef.current.push(activeStrokeRef.current);
      activeStrokeRef.current = null;
      setStrokeCount(strokesRef.current.length);
      redrawCanvasStrokes();
    }
  };

  // Preserve drawn strokes visually when switching back to Draw tab
  useEffect(() => {
    if (creationMode === 'draw') {
      redrawCanvasStrokes();
    }
  }, [creationMode]);

  const handleClearCanvas = () => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    setStrokeCount(0);
    redrawCanvasStrokes();
  };

  const handleUndoStroke = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redrawCanvasStrokes();
  };

  const selectedFont =
    SIGNATURE_FONTS.find((f) => f.id === typedFontId) || SIGNATURE_FONTS[0];

  // Build accurate, cropped signature payload for the active creation mode
  const buildCurrentSignaturePayload = (): {
    dataUrl: string;
    width: number;
    height: number;
    label: string;
    mode: SignatureMode;
  } | null => {
    if (creationMode === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const trimmed = trimSignatureCanvas(canvas, 14);
      if (!trimmed) return null;
      return {
        ...trimmed,
        label: `${signerName.trim() || 'Handwritten'} (Drawn)`,
        mode: 'draw',
      };
    }

    if (creationMode === 'type') {
      const rendered = renderTypedSignature(typedName, selectedFont, inkColor);
      if (!rendered) return null;
      return {
        ...rendered,
        label: typedName.trim(),
        mode: 'type',
      };
    }

    if (creationMode === 'upload' && uploadedProcessed) {
      return {
        ...uploadedProcessed,
        label: `${signerName.trim() || 'Imported'} (Image)`,
        mode: 'upload',
      };
    }

    return null;
  };

  const isCreationReady =
    (creationMode === 'draw' && strokeCount > 0) ||
    (creationMode === 'type' && typedName.trim().length > 0) ||
    (creationMode === 'upload' && Boolean(uploadedProcessed));

  const handleSaveSignature = () => {
    const payload = buildCurrentSignaturePayload();
    if (!payload) {
      setStatusMessage('Please create or import a non-empty signature first.');
      return;
    }
    const newItem: SavedSignatureItem = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: payload.label,
      mode: payload.mode,
      dataUrl: payload.dataUrl,
      width: payload.width,
      height: payload.height,
      createdAt: Date.now(),
    };
    const updated = [newItem, ...savedSignatures];
    setSavedSignatures(updated);
    saveSignaturesList(updated);
    setStatusMessage(`Saved signature "${newItem.label}" to local library`);
  };

  const handleApplySignature = async (savedOverride?: SavedSignatureItem) => {
    if (!pdfBytes) {
      setStatusMessage('Open or create a PDF document before inserting a signature.');
      return;
    }

    const payload = savedOverride
      ? {
          dataUrl: savedOverride.dataUrl,
          width: savedOverride.width,
          height: savedOverride.height,
          label: savedOverride.label,
          mode: savedOverride.mode,
        }
      : buildCurrentSignaturePayload();

    if (!payload) {
      setStatusMessage('Please draw, type, or upload a non-empty signature first.');
      return;
    }

    const targetPageIndex = pendingSignatureTarget
      ? pendingSignatureTarget.pageIndex
      : Math.max(0, currentPage - 1);
    const pageMeta = pageMetas[targetPageIndex] || { width: 595, height: 842 };

    // Calculate aspect-ratio-accurate placement dimensions
    const maxW = pendingSignatureTarget ? pendingSignatureTarget.width : 190;
    const maxH = pendingSignatureTarget ? pendingSignatureTarget.height : 80;
    const fitted = fitSignatureDimensions(payload.width, payload.height, maxW, maxH);

    const placeX = pendingSignatureTarget
      ? Math.round(pendingSignatureTarget.x + (pendingSignatureTarget.width - fitted.width) / 2)
      : Math.round(Math.max(36, Math.min(80, pageMeta.width - fitted.width - 40)));
    const placeY = pendingSignatureTarget
      ? Math.round(pendingSignatureTarget.y + (pendingSignatureTarget.height - fitted.height) / 2)
      : Math.round(Math.max(40, pageMeta.height - fitted.height - 130));

    // 1. Place the transparent visual signature image
    addImageItem({
      pageIndex: targetPageIndex,
      x: placeX,
      y: placeY,
      width: fitted.width,
      height: fitted.height,
      dataUrl: payload.dataUrl,
      name: `Signature_${(signerName || 'Signer').replace(/\s+/g, '_')}.png`,
      format: 'png',
      opacity: 1,
      rotation: 0,
    });

    // If signing an interactive Signature Form placeholder, replace the placeholder cleanly
    if (pendingSignatureTarget?.fieldId) {
      deleteFormField(pendingSignatureTarget.fieldId);
      setPendingSignatureTarget(null);
    }

    // 2. Compute & attach authentic cryptographic SHA-256 digital certificate seal if enabled
    if (includeAuditSeal) {
      const docHash = documentSha256 || (await computeSha256Hex(pdfBytes));
      const timestampIso = new Date().toISOString();
      const cleanSigner = (signerName || 'Authorized Signer').trim();
      const cleanRole = (signerRole || 'AUTHORIZED SIGNER').trim();
      const cleanReason = (signingReason || 'I approve this document').trim();
      const sealDigest = await computeSignatureSealDigest({
        documentSha256: docHash,
        signerName: cleanSigner,
        signerRole: cleanRole,
        reason: cleanReason,
        timestampIso,
        signatureDataUrl: payload.dataUrl,
      });
      setLastSealDigest(sealDigest);

      const sealW = 248;
      const sealH = 68;
      const sealX =
        placeX + fitted.width + 16 + sealW <= pageMeta.width - 20
          ? placeX + fitted.width + 16
          : Math.max(24, placeX);
      const sealY =
        sealX === placeX
          ? Math.min(pageMeta.height - sealH - 20, placeY + fitted.height + 8)
          : Math.round(placeY + Math.max(0, (fitted.height - sealH) / 2));

      addAnnotation({
        pageIndex: targetPageIndex,
        type: 'stamp',
        rect: { x: sealX, y: sealY, width: sealW, height: sealH },
        color: '#0284c7',
        stampType: 'CUSTOM',
        stampLabel: 'DIGITALLY SIGNED • SHA-256',
        stampStyle: 'outline',
        rotation: 0,
        showTimestamp: true,
        opacity: 0.94,
        author: cleanSigner,
        certificateMeta: {
          signerName: cleanSigner,
          signerRole: cleanRole,
          reason: cleanReason,
          timestampIso,
          sha256: sealDigest,
        },
      });

      dbService.logAudit(
        'DIGITAL_SIGNATURE',
        `Signed page ${targetPageIndex + 1} (${cleanSigner} | ${cleanRole} | Reason: ${cleanReason} | SHA256:${sealDigest})`,
        currentFileName
      );
      setStatusMessage(
        `Applied signature with transparent SHA-256 certificate (${sealDigest.slice(0, 12)}...)`
      );
    } else {
      dbService.logAudit(
        'ELECTRONIC_SIGNATURE',
        `Placed electronic signature on page ${targetPageIndex + 1} (${signerName})`,
        currentFileName
      );
      setStatusMessage(`Signature placed cleanly on page ${targetPageIndex + 1}`);
    }

    setActiveTab('editor');
  };

  const handleUploadInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        if (url) {
          setUploadedRawUrl(url);
          setCreationMode('upload');
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleOpenPdfClick = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openPdfDialog();
      if (res) {
        await loadPdfBytes(new Uint8Array(res.data), res.name, res.filePath);
      }
    } else {
      openPdfInputRef.current?.click();
    }
  };

  const targetDisplayPage = pendingSignatureTarget
    ? pendingSignatureTarget.pageIndex + 1
    : currentPage;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 md:p-8 select-none text-slate-100">
      <input
        ref={openPdfInputRef}
        type="file"
        accept="application/pdf"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            const buf = await f.arrayBuffer();
            await loadPdfBytes(new Uint8Array(buf), f.name);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Top Studio Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
              <FileSignature className="w-5 h-5 text-brand-400" />
              <span>Electronic &amp; Digital Signature Studio</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Draw, type, or import transparent electronic signatures and attach real offline SHA-256 verification seals.
            </p>
          </div>

          {pdfBytes ? (
            <div className="flex items-center space-x-3 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs">
              <div>
                <div className="text-slate-200 font-semibold truncate max-w-[200px]">
                  {currentFileName}
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Target: Page {targetDisplayPage} of {pageCount}
                </div>
              </div>
              {documentSha256 && (
                <div className="pl-3 border-l border-slate-800 max-w-[270px]">
                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Document SHA-256</span>
                  </div>
                  <div
                    className="text-[9.5px] font-mono text-slate-300 break-all leading-tight mt-0.5 select-text"
                    title={documentSha256}
                  >
                    {documentSha256}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => createNewDocument('A4')}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
              >
                <FilePlus className="w-3.5 h-3.5 text-brand-400" />
                <span>Create Blank PDF</span>
              </button>
              <button
                onClick={handleOpenPdfClick}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Active Form-Field Target Banner */}
        {pendingSignatureTarget && (
          <div className="flex items-center justify-between bg-sky-950/50 border border-sky-700/60 rounded-xl px-4 py-2.5 text-xs">
            <div className="flex items-center space-x-2 text-sky-200">
              <BadgeCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Signing interactive Signature Field on <strong>Page {pendingSignatureTarget.pageIndex + 1}</strong> ({Math.round(pendingSignatureTarget.width)}×{Math.round(pendingSignatureTarget.height)} pt).
              </span>
            </div>
            <button
              onClick={() => setPendingSignatureTarget(null)}
              className="text-sky-300 hover:text-white flex items-center space-x-1 text-[11px]"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Target</span>
            </button>
          </div>
        )}

        {/* Main 2-Column Studio Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Electronic Signature Creation */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
            {/* Creation Mode Tabs + Ink Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setCreationMode('draw')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    creationMode === 'draw'
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Draw Signature</span>
                </button>

                <button
                  onClick={() => setCreationMode('type')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    creationMode === 'type'
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  <span>Type Signature</span>
                </button>

                <button
                  onClick={() => setCreationMode('upload')}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    creationMode === 'upload'
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Image</span>
                </button>
              </div>

              {/* Ink Color Swatches (for Draw & Type) */}
              {creationMode !== 'upload' && (
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] text-slate-400">Ink:</span>
                  {SIGNATURE_INK_COLORS.map((swatch) => (
                    <button
                      key={swatch.value}
                      type="button"
                      onClick={() => setInkColor(swatch.value)}
                      className={`w-5 h-5 rounded-full border transition-transform ${
                        inkColor === swatch.value
                          ? 'border-white scale-110 ring-2 ring-brand-500/60'
                          : 'border-slate-600 opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: swatch.value }}
                      title={swatch.label}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 1. DRAW TAB */}
            {creationMode === 'draw' && (
              <div className="space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-slate-400">
                  <div className="flex items-center space-x-2">
                    <span>Stroke Weight:</span>
                    {[
                      { label: 'Fine', value: 2 },
                      { label: 'Medium', value: 3.5 },
                      { label: 'Bold', value: 5.5 },
                    ].map((w) => (
                      <button
                        key={w.label}
                        type="button"
                        onClick={() => setPenWeight(w.value)}
                        className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                          penWeight === w.value
                            ? 'bg-brand-600/20 border-brand-500 text-brand-300 font-semibold'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={handleUndoStroke}
                      disabled={strokeCount === 0}
                      className="flex items-center space-x-1 text-slate-300 hover:text-white disabled:opacity-35"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Undo Stroke</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearCanvas}
                      disabled={strokeCount === 0}
                      className="flex items-center space-x-1 text-slate-300 hover:text-white disabled:opacity-35"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>

                <div className="relative w-full h-48 bg-white rounded-xl border-2 border-dashed border-slate-700 overflow-hidden shadow-inner">
                  {/* Signature Baseline Guide */}
                  <div className="absolute left-8 right-8 bottom-9 border-b border-slate-200 pointer-events-none" />
                  <span className="absolute left-8 bottom-4 text-[10px] text-slate-300 font-mono pointer-events-none select-none">
                    X SIGN HERE
                  </span>
                  <canvas
                    ref={canvasRef}
                    width={900}
                    height={260}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className="cursor-crosshair w-full h-full block touch-none relative z-10"
                  />
                </div>
              </div>
            )}

            {/* 2. TYPE TAB */}
            {creationMode === 'type' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">
                      Full Name / Signature Text
                    </label>
                    <input
                      type="text"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder="Enter your signature name"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 font-medium"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium">
                      Calligraphy &amp; Font Style
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {SIGNATURE_FONTS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setTypedFontId(f.id)}
                          className={`px-2 py-1.5 rounded-lg border text-[11px] truncate transition-colors ${
                            typedFontId === f.id
                              ? 'bg-brand-600/20 border-brand-500 text-brand-200 font-semibold'
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="relative w-full h-36 bg-white rounded-xl border border-slate-700 flex items-center justify-center shadow-inner px-6">
                  <div className="absolute left-8 right-8 bottom-7 border-b border-slate-200 pointer-events-none" />
                  <span
                    className={`text-4xl select-none truncate max-w-full ${
                      selectedFont.isItalic ? 'italic' : ''
                    }`}
                    style={{
                      fontFamily: selectedFont.cssFont,
                      color: inkColor,
                    }}
                  >
                    {typedName || 'Signature Preview'}
                  </span>
                </div>
              </div>
            )}

            {/* 3. UPLOAD TAB */}
            {creationMode === 'upload' && (
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleUploadInput}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={removeWhiteBg}
                      onChange={(e) => setRemoveWhiteBg(e.target.checked)}
                      className="accent-brand-500 rounded"
                    />
                    <span>Automatically remove white paper background (transparent PNG)</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium"
                  >
                    {uploadedRawUrl ? 'Choose Different Image…' : 'Browse Signature Image…'}
                  </button>
                </div>

                {uploadedProcessed ? (
                  <div className="w-full h-40 bg-white rounded-xl border border-slate-700 flex flex-col items-center justify-center p-4 relative shadow-inner">
                    <img
                      src={uploadedProcessed.dataUrl}
                      alt="Processed signature preview"
                      className="max-h-28 max-w-full object-contain"
                    />
                    <span className="text-[10px] text-slate-400 font-mono mt-1">
                      Normalized Transparent PNG • {uploadedProcessed.width}×{uploadedProcessed.height} px
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-40 rounded-xl border-2 border-dashed border-slate-700 hover:border-brand-500/70 bg-slate-950/60 flex flex-col items-center justify-center space-y-2 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <Upload className="w-6 h-6 text-brand-400" />
                    <span className="text-xs font-medium">
                      Click to import a scanned PNG/JPG handwritten signature or company stamp
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Creation Actions Bar */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleSaveSignature}
                disabled={!isCreationReady}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
              >
                Save to Signature Library
              </button>

              <button
                type="button"
                onClick={() => handleApplySignature()}
                disabled={!pdfBytes || !isCreationReady}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md disabled:opacity-40 transition-colors"
              >
                <Check className="w-4 h-4" />
                <span>
                  {pendingSignatureTarget
                    ? `Sign Field on Page ${targetDisplayPage}`
                    : `Insert Signature on Page ${targetDisplayPage}`}
                </span>
              </button>
            </div>
          </div>

          {/* Right Col: Digital Certificate & Cryptographic Seal Settings */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Digital Certificate &amp; Integrity
                </h3>
              </div>

              <label className="flex items-start space-x-2.5 text-xs text-slate-200 cursor-pointer bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={includeAuditSeal}
                  onChange={(e) => setIncludeAuditSeal(e.target.checked)}
                  className="accent-emerald-500 rounded mt-0.5"
                />
                <div>
                  <div className="font-semibold text-emerald-300">
                    Attach SHA-256 Verification Seal
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Binds document bytes, signer identity, timestamp, and signature graphic into a tamper-evident cryptographic digest.
                  </div>
                </div>
              </label>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Signer Full Name</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-brand-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Role / Title</label>
                <input
                  type="text"
                  value={signerRole}
                  onChange={(e) => setSignerRole(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-brand-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 font-medium">Signing Reason</label>
                <select
                  value={SIGNING_REASONS.includes(signingReason) ? signingReason : 'CUSTOM'}
                  onChange={(e) => {
                    if (e.target.value !== 'CUSTOM') setSigningReason(e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                >
                  {SIGNING_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleApplyCertificateSettings}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors"
                  title="Apply and save Signer Full Name, Role, and Reason"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{certAppliedFeedback ? 'Applied & Saved!' : 'Apply'}</span>
                </button>
              </div>
            </div>

            {includeAuditSeal && (
              <div className="rounded-lg border border-sky-500/70 bg-transparent px-3 py-2 text-[10px] space-y-0.5">
                <div className="flex items-center space-x-1.5 text-sky-400 font-bold uppercase tracking-wider border-b border-sky-500/30 pb-1">
                  <ShieldCheck className="w-3 h-3 shrink-0" />
                  <span>Certificate Preview (Transparent • SHA-256)</span>
                </div>
                <div className="text-slate-200 pt-0.5">
                  <span className="text-slate-400">Signer:</span>{' '}
                  <span className="font-semibold">{signerName || 'Authorized Signer'}</span>
                  <span className="text-slate-500"> • </span>
                  <span className="text-sky-300 font-medium">{signerRole || 'AUTHORIZED SIGNER'}</span>
                </div>
                <div className="text-slate-300">
                  <span className="text-slate-400">Reason:</span> {signingReason}
                </div>
                <div className="text-slate-300">
                  <span className="text-slate-400">Timestamp:</span>{' '}
                  {formatCertificateTimestamp(new Date().toISOString())}
                </div>
                <div className="font-mono text-[9.5px] text-emerald-300 break-all leading-snug pt-0.5 select-text">
                  SHA-256: {lastSealDigest || documentSha256 || 'Computed cryptographically upon signing'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Saved Signatures Gallery */}
        {savedSignatures.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-sm text-slate-200">Saved Signatures Library</h3>
              <span className="text-xs text-slate-400">
                {savedSignatures.length} stored locally (offline)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedSignatures.map((sig) => (
                <div
                  key={sig.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col justify-between space-y-2.5 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-200 truncate max-w-[160px]">
                      {sig.label}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-mono text-[9px]">
                      {sig.mode}
                    </span>
                  </div>

                  <div className="w-full h-20 bg-white rounded-lg flex items-center justify-center p-2">
                    <img
                      src={sig.dataUrl}
                      alt={sig.label}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      disabled={!pdfBytes}
                      onClick={() => handleApplySignature(sig)}
                      className="text-xs text-brand-400 hover:text-brand-300 disabled:opacity-40 font-semibold"
                    >
                      Insert on Page {targetDisplayPage}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = savedSignatures.filter((item) => item.id !== sig.id);
                        setSavedSignatures(updated);
                        saveSignaturesList(updated);
                      }}
                      className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-slate-800"
                      title="Delete saved signature"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
