import React, { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useLicenseStore } from '../stores/licenseStore';
import { pdfEngine, RenderPageResult } from '../services/pdfEngine';
import { Point, Rect, StampType } from '../types';
import { STAMP_TEMPLATES, calculateStampDimensions } from '../constants/stamps';
import { formatCertificateTimestamp } from '../services/signatureService';
import {
  Sparkles,
  X,
  Trash2,
  MessageSquare,
  Stamp,
  Edit3,
  Check,
  FileSignature,
  ShieldCheck,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';

export const PDFViewer: React.FC = () => {
  const {
    pdfBytes,
    pdfDocProxy,
    currentPage,
    zoom,
    activeTool,
    activeColor,
    activeFontSize,
    activeFontFamily,
    activeStrokeWidth,
    activeOpacity,
    textItems,
    imageItems,
    annotations,
    formFields,
    watermark,
    headerFooter,
    selectedItemId,
    selectedItemType,
    selectItem,
    addTextItem,
    updateTextItem,
    deleteTextItem,
    updateImageItem,
    deleteImageItem,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addFormField,
    updateFormField,
    deleteFormField,
    setStatusMessage,
    zoomIn,
    zoomOut,
  } = useEditorStore();
  const { hasEntitlement, openLicenseModal } = useLicenseStore();
  const isReadOnly = !hasEntitlement('text_edit');

  // Keep active tool read-only safe when license is FREE / expired trial
  useEffect(() => {
    if (isReadOnly && activeTool !== 'hand' && activeTool !== 'select') {
      useEditorStore.getState().setActiveTool('select');
    }
  }, [isReadOnly, activeTool]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [pageRenderData, setPageRenderData] = useState<RenderPageResult | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  // Pan / Hand Tool State
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Reset panOffset when switching page or document
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [currentPage, pdfDocProxy]);

  // Keep inline editors and floating popovers tidy when switching tools
  useEffect(() => {
    if (activeTool !== 'stamp' && floatingStampCoords) {
      setFloatingStampCoords(null);
    }
    if (
      activeTool !== 'select' &&
      activeTool !== 'text-add' &&
      activeTool !== 'text-edit'
    ) {
      if (editingTextId) {
        const cur = useEditorStore.getState().textItems.find((t) => t.id === editingTextId);
        if (cur && editingTextVal.trim()) {
          updateTextItem(editingTextId, { text: editingTextVal });
        }
        setEditingTextId(null);
      }
      if (editingStampId) {
        const curStamp = useEditorStore.getState().annotations.find((a) => a.id === editingStampId);
        if (curStamp && editingStampVal.trim()) {
          updateAnnotation(editingStampId, { stampLabel: editingStampVal.trim().toUpperCase() });
        }
        setEditingStampId(null);
      }
    }
  }, [activeTool]);

  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  const toCssFontFamily = (family?: string) => {
    if (family === 'TimesRoman') return '"Times New Roman", Times, serif';
    if (family === 'Courier') return '"Courier New", Courier, monospace';
    return 'Helvetica, Arial, sans-serif';
  };

  const computeArrowGeometry = (p0: Point, p1: Point, strokeW: number) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const headLen = Math.min(Math.max(8, strokeW * 3.5), Math.max(6, len * 0.6));
    const headHalfW = headLen * 0.45;
    const baseX = p1.x - ux * headLen;
    const baseY = p1.y - uy * headLen;
    return {
      shaftEndX: p1.x - ux * (headLen * 0.65),
      shaftEndY: p1.y - uy * (headLen * 0.65),
      polyPoints: `${p1.x},${p1.y} ${baseX - uy * headHalfW},${baseY + ux * headHalfW} ${baseX + uy * headHalfW},${baseY - ux * headHalfW}`,
    };
  };

  const snapLineEndpoint = (anchor: Point, target: Point, shiftKey: boolean): Point => {
    if (!shiftKey) return target;
    const dx = target.x - anchor.x;
    const dy = target.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return target;
    const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return {
      x: anchor.x + Math.cos(snappedAngle) * dist,
      y: anchor.y + Math.sin(snappedAngle) * dist,
    };
  };

  // Item Drag-to-Move State
  const [draggingItem, setDraggingItem] = useState<{
    id: string;
    type: 'text' | 'image' | 'annotation' | 'form';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialPoints?: Point[];
  } | null>(null);

  // Line / Arrow Endpoint Drag State
  const [draggingEndpoint, setDraggingEndpoint] = useState<{
    id: string;
    endIndex: 0 | 1;
    fixedPoint: Point;
  } | null>(null);

  // Image & Stamp Resize State
  const [resizingImage, setResizingImage] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);
  const [resizingAnnotation, setResizingAnnotation] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);

  // Text Paragraph Resize State
  const [resizingText, setResizingText] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight?: number;
    mode: 'width' | 'both';
  } | null>(null);

  const dragMovedRef = useRef(false);

  // Inline Text Editor State
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextVal, setEditingTextVal] = useState<string>('');

  const handleCommitText = (id: string, overrideVal?: string) => {
    const val = overrideVal !== undefined ? overrideVal : editingTextVal;
    const stillExists = useEditorStore.getState().textItems.some((t) => t.id === id);
    if (stillExists) {
      if (val.trim() === '') {
        deleteTextItem(id);
        selectItem(null, null);
      } else {
        updateTextItem(id, { text: val });
      }
    }
    setEditingTextId(null);
    if (activeTool === 'text-add' || activeTool === 'text-edit') {
      useEditorStore.getState().setActiveTool('select');
    }
  };

  // Floating Stamp Dropdown & Custom Stamp State
  const [floatingStampCoords, setFloatingStampCoords] = useState<Point | null>(null);
  const [editingStampId, setEditingStampId] = useState<string | null>(null);
  const [editingStampVal, setEditingStampVal] = useState<string>('');
  const [customStampLabel, setCustomStampLabel] = useState<string>('');
  const [customStampColor, setCustomStampColor] = useState<string>('#10b981');
  const [customStampAngled, setCustomStampAngled] = useState<boolean>(true);

  const scale = zoom * 1.5;

  // Render the current page on canvas
  useEffect(() => {
    if (!pdfDocProxy || !canvasRef.current) return;

    let isCancelled = false;
    setIsRendering(true);

    pdfEngine
      .renderPageToCanvas(pdfDocProxy, currentPage, canvasRef.current, scale)
      .then((res) => {
        if (!isCancelled) {
          setPageRenderData(res);
          setIsRendering(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('Page render error:', err);
          setIsRendering(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [pdfDocProxy, currentPage, zoom]);

  // Ctrl + Wheel Zoom Handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomIn, zoomOut]);

  // Coordinate conversion helper
  const getCanvasCoords = (e: React.MouseEvent): Point => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  // --- Hand / Pan Tool Handlers on Container ---
  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1) {
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current?.scrollLeft || 0,
        scrollTop: containerRef.current?.scrollTop || 0,
        offsetX: panOffset.x,
        offsetY: panOffset.y,
      });
    }
  };

  const applyPanDelta = (clientX: number, clientY: number) => {
    if (!panStart || !containerRef.current) return;
    const dx = clientX - panStart.x;
    const dy = clientY - panStart.y;

    containerRef.current.scrollLeft = panStart.scrollLeft - dx;
    containerRef.current.scrollTop = panStart.scrollTop - dy;

    const consumedX = panStart.scrollLeft - containerRef.current.scrollLeft;
    const consumedY = panStart.scrollTop - containerRef.current.scrollTop;

    setPanOffset({
      x: panStart.offsetX + (dx - consumedX),
      y: panStart.offsetY + (dy - consumedY),
    });
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (isPanning && panStart && containerRef.current) {
      applyPanDelta(e.clientX, e.clientY);
    }
  };

  const handleContainerMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  };

  // Window-level mouse listeners for buttery-smooth panning without boundary escape
  useEffect(() => {
    if (!isPanning || !panStart) return;

    const onGlobalMouseMove = (e: MouseEvent) => {
      applyPanDelta(e.clientX, e.clientY);
    };

    const onGlobalMouseUp = () => {
      setIsPanning(false);
      setPanStart(null);
    };

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', onGlobalMouseMove);
      window.removeEventListener('mouseup', onGlobalMouseUp);
    };
  }, [isPanning, panStart]);

  // Mouse Down handler on Overlay
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1) {
      handleContainerMouseDown(e);
      return;
    }

    if (isReadOnly) {
      if (e.target === overlayRef.current) {
        selectItem(null, null);
      }
      return;
    }

    // If an inline text editor, stamp editor, or floating stamp menu is open,
    // clicking outside on the canvas closes/commits it FIRST without creating a double entry!
    if (editingTextId) {
      const currentItem = useEditorStore.getState().textItems.find((t) => t.id === editingTextId);
      if (currentItem) {
        if (editingTextVal.trim() === '') {
          deleteTextItem(editingTextId);
        } else {
          updateTextItem(editingTextId, { text: editingTextVal });
        }
      }
      setEditingTextId(null);
      selectItem(null, null);
      if (activeTool === 'text-add') {
        useEditorStore.getState().setActiveTool('select');
      }
      return;
    }

    if (editingStampId) {
      const stillExists = useEditorStore.getState().annotations.some((a) => a.id === editingStampId);
      if (stillExists) {
        const cleanVal = editingStampVal.trim();
        if (cleanVal) {
          updateAnnotation(editingStampId, { stampLabel: cleanVal.toUpperCase() });
        }
      }
      setEditingStampId(null);
      selectItem(null, null);
      return;
    }

    if (floatingStampCoords) {
      setFloatingStampCoords(null);
      return;
    }

    const coords = getCanvasCoords(e);
    const pageIndex = currentPage - 1;

    // Deselect if clicking on empty background
    if (e.target === overlayRef.current) {
      selectItem(null, null);
    }

    // 1. ADD NEW TEXT (Direct edit with immediate focus)
    if (activeTool === 'text-add') {
      const newText = 'Type your paragraph here...';
      const roundX = Math.round(coords.x);
      const roundY = Math.round(coords.y);
      const pageMeta = useEditorStore.getState().pageMetas[pageIndex];
      const maxAvail = pageMeta ? Math.max(140, pageMeta.width - roundX - 36) : 260;
      const initialWidth = Math.min(260, maxAvail);

      addTextItem({
        pageIndex,
        x: roundX,
        y: roundY,
        width: initialWidth,
        text: newText,
        fontSize: activeFontSize,
        fontFamily: activeFontFamily,
        color: activeColor === '#ffeb3b' ? '#000000' : activeColor,
        lineHeight: 1.25,
        align: 'left',
      });

      // Synchronously enter edit mode immediately to prevent race conditions or double entry
      const latest = useEditorStore.getState().textItems.slice(-1)[0];
      if (latest) {
        selectItem(latest.id, 'text');
        setEditingTextId(latest.id);
        setEditingTextVal(newText);
      }
      return;
    }

    // 2. STAMP TOOL (Show floating dropdown list at click coordinates)
    if (activeTool === 'stamp') {
      setFloatingStampCoords(coords);
      return;
    }

    // 3. ADD FORM FIELDS
    if (activeTool.startsWith('form-')) {
      const fieldType = activeTool.replace('form-', '') as any;
      const width = fieldType === 'checkbox' ? 20 : fieldType === 'signature' ? 190 : 150;
      const height = fieldType === 'checkbox' ? 20 : fieldType === 'signature' ? 64 : 28;

      addFormField({
        pageIndex,
        type: fieldType,
        name: `${fieldType}_${Date.now().toString().slice(-4)}`,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        width,
        height,
        defaultValue: fieldType === 'checkbox' ? 'false' : '',
        options: fieldType === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : undefined,
      });
      useEditorStore.getState().setActiveTool('select');
      return;
    }

    // 4. ANNOTATIONS & SHAPES DRAG START
    if (
      [
        'highlight',
        'underline',
        'strikethrough',
        'shape-rect',
        'shape-circle',
        'shape-line',
        'shape-arrow',
        'redact',
        'draw',
        'note',
      ].includes(activeTool)
    ) {
      setIsDrawing(true);
      setDragStart(coords);
      setDragEnd(coords);

      if (activeTool === 'draw') {
        setCurrentPoints([coords]);
      } else if (activeTool === 'note') {
        // Direct note creation with auto-opened editor
        addAnnotation({
          pageIndex,
          type: 'note',
          rect: { x: Math.round(coords.x), y: Math.round(coords.y), width: 26, height: 26 },
          color: '#fbbf24',
          text: '',
          opacity: 1,
        });
        setIsDrawing(false);
        setTimeout(() => {
          const latestAnn = useEditorStore.getState().annotations.slice(-1)[0];
          if (latestAnn) {
            selectItem(latestAnn.id, 'annotation');
          }
        }, 40);
      } else {
        setCurrentRect({ x: coords.x, y: coords.y, width: 0, height: 0 });
      }
    }
  };

  // Mouse Move handler
  const handleMouseMove = (e: React.MouseEvent) => {
    // 1. Handle image resizing
    if (resizingImage) {
      const coords = getCanvasCoords(e);
      const deltaW = coords.x - resizingImage.startX;
      const deltaH = coords.y - resizingImage.startY;
      const newW = Math.max(25, Math.round(resizingImage.initialWidth + deltaW));
      const newH = Math.max(25, Math.round(resizingImage.initialHeight + deltaH));
      updateImageItem(resizingImage.id, { width: newW, height: newH });
      return;
    }

    // 1b. Handle stamp / annotation resizing
    if (resizingAnnotation) {
      const coords = getCanvasCoords(e);
      const ann = annotations.find((a) => a.id === resizingAnnotation.id);
      if (ann) {
        const deltaW = coords.x - resizingAnnotation.startX;
        const deltaH = coords.y - resizingAnnotation.startY;
        const minW = ann.type === 'stamp' ? 96 : 12;
        const minH = ann.type === 'stamp' ? 32 : 8;
        const newW = Math.max(minW, Math.round(resizingAnnotation.initialWidth + deltaW));
        const newH = Math.max(minH, Math.round(resizingAnnotation.initialHeight + deltaH));
        updateAnnotation(resizingAnnotation.id, {
          rect: { ...ann.rect, width: newW, height: newH },
        });
      }
      return;
    }

    // 1c. Handle text paragraph width/dimension resizing
    if (resizingText) {
      const coords = getCanvasCoords(e);
      const deltaW = coords.x - resizingText.startX;
      const newW = Math.max(60, Math.round(resizingText.initialWidth + deltaW));
      if (resizingText.mode === 'both' && resizingText.initialHeight) {
        const deltaH = coords.y - resizingText.startY;
        const newH = Math.max(20, Math.round(resizingText.initialHeight + deltaH));
        updateTextItem(resizingText.id, { width: newW, height: newH });
      } else {
        updateTextItem(resizingText.id, { width: newW });
      }
      return;
    }

    // 1c. Handle line/arrow endpoint dragging
    if (draggingEndpoint) {
      const rawCoords = getCanvasCoords(e);
      const movedPt = snapLineEndpoint(draggingEndpoint.fixedPoint, rawCoords, e.shiftKey);
      const p0 = draggingEndpoint.endIndex === 0 ? movedPt : draggingEndpoint.fixedPoint;
      const p1 = draggingEndpoint.endIndex === 1 ? movedPt : draggingEndpoint.fixedPoint;
      const minX = Math.min(p0.x, p1.x);
      const minY = Math.min(p0.y, p1.y);
      const width = Math.max(4, Math.abs(p1.x - p0.x));
      const height = Math.max(4, Math.abs(p1.y - p0.y));
      updateAnnotation(draggingEndpoint.id, {
        rect: { x: minX, y: minY, width, height },
        points: [
          { x: p0.x - minX, y: p0.y - minY },
          { x: p1.x - minX, y: p1.y - minY },
        ],
      });
      return;
    }

    // 2. Handle item dragging to move
    if (draggingItem) {
      const coords = getCanvasCoords(e);
      const deltaX = coords.x - draggingItem.startX;
      const deltaY = coords.y - draggingItem.startY;
      if (Math.hypot(deltaX, deltaY) > 3) {
        dragMovedRef.current = true;
      }
      const newX = Math.round(draggingItem.initialX + deltaX);
      const newY = Math.round(draggingItem.initialY + deltaY);

      if (draggingItem.type === 'text') {
        updateTextItem(draggingItem.id, { x: newX, y: newY });
      } else if (draggingItem.type === 'image') {
        updateImageItem(draggingItem.id, { x: newX, y: newY });
      } else if (draggingItem.type === 'form') {
        updateFormField(draggingItem.id, { x: newX, y: newY });
      } else if (draggingItem.type === 'annotation') {
        const ann = annotations.find((a) => a.id === draggingItem.id);
        if (ann) {
          const shiftX = newX - draggingItem.initialX;
          const shiftY = newY - draggingItem.initialY;
          updateAnnotation(draggingItem.id, {
            rect: { ...ann.rect, x: newX, y: newY },
            ...(ann.type === 'freehand' && draggingItem.initialPoints
              ? {
                  points: draggingItem.initialPoints.map((pt) => ({
                    x: pt.x + shiftX,
                    y: pt.y + shiftY,
                  })),
                }
              : {}),
          });
        }
      }
      return;
    }

    // 3. Handle active annotation drawing
    if (!isDrawing || !dragStart) return;

    const coords = getCanvasCoords(e);

    if (activeTool === 'draw') {
      setCurrentPoints((prev) => [...prev, coords]);
    } else if (activeTool === 'shape-line' || activeTool === 'shape-arrow') {
      const snapped = snapLineEndpoint(dragStart, coords, e.shiftKey);
      setDragEnd(snapped);
      const x = Math.min(dragStart.x, snapped.x);
      const y = Math.min(dragStart.y, snapped.y);
      const width = Math.abs(snapped.x - dragStart.x);
      const height = Math.abs(snapped.y - dragStart.y);
      setCurrentRect({ x, y, width, height });
    } else {
      setDragEnd(coords);
      const x = Math.min(dragStart.x, coords.x);
      const y = Math.min(dragStart.y, coords.y);
      const width = Math.abs(coords.x - dragStart.x);
      const height = Math.abs(coords.y - dragStart.y);
      setCurrentRect({ x, y, width, height });
    }
  };

  // Mouse Up handler
  const handleMouseUp = () => {
    if (resizingImage) {
      setResizingImage(null);
      return;
    }

    if (resizingAnnotation) {
      setResizingAnnotation(null);
      return;
    }

    if (resizingText) {
      setResizingText(null);
      return;
    }

    if (draggingEndpoint) {
      setDraggingEndpoint(null);
      return;
    }

    if (draggingItem) {
      setDraggingItem(null);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    const pageIndex = currentPage - 1;

    if (activeTool === 'draw' && currentPoints.length >= 1) {
      const strokePts =
        currentPoints.length === 1
          ? [currentPoints[0], { x: currentPoints[0].x + 0.5, y: currentPoints[0].y }]
          : currentPoints;
      const xs = strokePts.map((p) => p.x);
      const ys = strokePts.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      addAnnotation({
        pageIndex,
        type: 'freehand',
        rect: {
          x: minX,
          y: minY,
          width: Math.max(4, maxX - minX),
          height: Math.max(4, maxY - minY),
        },
        color: activeColor === '#ffeb3b' ? '#ef4444' : activeColor,
        strokeWidth: activeStrokeWidth || 2,
        opacity: activeOpacity,
        points: strokePts,
      });
      setCurrentPoints([]);
      return;
    }

    if (
      (activeTool === 'shape-line' || activeTool === 'shape-arrow') &&
      dragStart &&
      dragEnd &&
      Math.hypot(dragEnd.x - dragStart.x, dragEnd.y - dragStart.y) > 4
    ) {
      const minX = Math.min(dragStart.x, dragEnd.x);
      const minY = Math.min(dragStart.y, dragEnd.y);
      const rawW = Math.abs(dragEnd.x - dragStart.x);
      const rawH = Math.abs(dragEnd.y - dragStart.y);
      const rect: Rect = {
        x: minX,
        y: minY,
        width: Math.max(4, rawW),
        height: Math.max(4, rawH),
      };
      addAnnotation({
        pageIndex,
        type: activeTool === 'shape-arrow' ? 'arrow' : 'line',
        rect,
        points: [
          { x: dragStart.x - minX, y: dragStart.y - minY },
          { x: dragEnd.x - minX, y: dragEnd.y - minY },
        ],
        color: activeColor === '#ffeb3b' ? '#111827' : activeColor,
        strokeWidth: activeStrokeWidth || 2,
        opacity: activeOpacity,
      });
    } else if (
      currentRect &&
      ((['highlight', 'underline', 'strikethrough'].includes(activeTool) && currentRect.width > 5) ||
        (currentRect.width > 3 && currentRect.height > 3))
    ) {
      const normTextBandRect: Rect =
        ['highlight', 'underline', 'strikethrough'].includes(activeTool) && currentRect.height < 10 && dragStart
          ? {
              x: currentRect.x,
              y: dragStart.y - 7,
              width: currentRect.width,
              height: 14,
            }
          : currentRect;

      if (activeTool === 'redact') {
        addAnnotation({
          pageIndex,
          type: 'redaction',
          rect: currentRect,
          color: '#000000',
          opacity: 1,
          isPermanentRedaction: true,
        });
      } else if (activeTool === 'highlight') {
        addAnnotation({
          pageIndex,
          type: 'highlight',
          rect: normTextBandRect,
          color: activeColor || '#ffeb3b',
          opacity: 0.35,
        });
      } else if (activeTool === 'strikethrough') {
        addAnnotation({
          pageIndex,
          type: 'strikethrough',
          rect: normTextBandRect,
          color: activeColor === '#ffeb3b' ? '#ef4444' : activeColor,
          strokeWidth: activeStrokeWidth || 2,
          opacity: 1,
        });
        setStatusMessage('Applied strikethrough');
      } else if (activeTool === 'shape-rect') {
        addAnnotation({
          pageIndex,
          type: 'rectangle',
          rect: currentRect,
          color: activeColor === '#ffeb3b' ? '#2563eb' : activeColor,
          strokeWidth: activeStrokeWidth || 2,
          opacity: activeOpacity,
        });
      } else if (activeTool === 'shape-circle') {
        addAnnotation({
          pageIndex,
          type: 'circle',
          rect: currentRect,
          color: activeColor === '#ffeb3b' ? '#2563eb' : activeColor,
          strokeWidth: activeStrokeWidth || 2,
          opacity: activeOpacity,
        });
      } else if (activeTool === 'underline') {
        addAnnotation({
          pageIndex,
          type: 'underline',
          rect: normTextBandRect,
          color: activeColor === '#ffeb3b' ? '#2563eb' : activeColor,
          strokeWidth: activeStrokeWidth || 2,
          opacity: 1,
        });
        setStatusMessage('Applied underline');
      }
    }

    setCurrentRect(null);
    setDragStart(null);
    setDragEnd(null);
  };

  // Click on existing extracted PDF text
  const handleExistingTextClick = (
    item: {
      str: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fontName: string;
      fontSize: number;
    },
    forceEdit: boolean = false
  ) => {
    if (isReadOnly) {
      openLicenseModal('Edit PDF Text (Currently Free Read-Only)');
      return;
    }
    const pageIndex = currentPage - 1;

    // Strikethrough existing text directly
    if (!forceEdit && activeTool === 'strikethrough') {
      addAnnotation({
        pageIndex,
        type: 'strikethrough',
        rect: {
          x: item.x / scale,
          y: item.y / scale,
          width: item.width / scale,
          height: item.height / scale,
        },
        color: activeColor === '#ffeb3b' ? '#ef4444' : activeColor,
        strokeWidth: activeStrokeWidth || 2,
        opacity: 1,
      });
      setStatusMessage(`Applied strikethrough to "${item.str}"`);
      return;
    }

    // Underline existing text directly
    if (!forceEdit && activeTool === 'underline') {
      addAnnotation({
        pageIndex,
        type: 'underline',
        rect: {
          x: item.x / scale,
          y: item.y / scale,
          width: item.width / scale,
          height: item.height / scale,
        },
        color: activeColor === '#ffeb3b' ? '#3b82f6' : activeColor,
        strokeWidth: activeStrokeWidth || 2,
        opacity: 1,
      });
      setStatusMessage(`Applied underline to "${item.str}"`);
      return;
    }

    // Highlight existing text directly
    if (!forceEdit && activeTool === 'highlight') {
      addAnnotation({
        pageIndex,
        type: 'highlight',
        rect: {
          x: item.x / scale,
          y: item.y / scale,
          width: item.width / scale,
          height: item.height / scale,
        },
        color: activeColor || '#ffeb3b',
        opacity: 0.35,
      });
      setStatusMessage(`Highlighted "${item.str}"`);
      return;
    }

    // Existing text edit (or double-click in select mode)
    if (forceEdit || activeTool === 'text-edit') {
      const exactFontSize = Math.max(6, Math.round((item.fontSize / scale) * 10) / 10);
      const baselinePt = (item.y + item.fontSize) / scale;
      const targetX = item.x / scale;
      const targetY = baselinePt - 0.85 * exactFontSize;

      // Prevent duplicate replacement items for the same PDF text block
      const existingReplacement = useEditorStore
        .getState()
        .textItems.find(
          (t) =>
            t.pageIndex === pageIndex &&
            Math.abs(t.x - targetX) < 5 &&
            Math.abs(t.y - targetY) < 5
        );

      if (existingReplacement) {
        selectItem(existingReplacement.id, 'text');
        setEditingTextId(existingReplacement.id);
        setEditingTextVal(existingReplacement.text);
        setStatusMessage(`Editing text block: "${existingReplacement.text}"`);
        return;
      }

      const initialText = item.str;
      const origWidth = Math.max(60, Math.round((item.width / scale) * 10) / 10);
      const origHeight = Math.max(12, Math.round((item.height / scale) * 10) / 10);

      addTextItem({
        pageIndex,
        x: targetX,
        y: targetY,
        width: Math.max(origWidth, 120),
        height: origHeight,
        text: initialText,
        originalText: initialText,
        fontSize: exactFontSize,
        fontFamily: item.fontName.toLowerCase().includes('times')
          ? 'TimesRoman'
          : item.fontName.toLowerCase().includes('courier')
          ? 'Courier'
          : 'Helvetica',
        color: '#000000',
        lineHeight: 1.25,
        align: 'left',
        isRedactionReplacement: true,
        boundingBox: {
          x: targetX,
          y: item.y / scale,
          width: origWidth,
          height: origHeight,
        },
      });

      const latest = useEditorStore.getState().textItems.slice(-1)[0];
      if (latest) {
        selectItem(latest.id, 'text');
        setEditingTextId(latest.id);
        setEditingTextVal(initialText);
      }
      setStatusMessage(`Editing text block: "${initialText.slice(0, 30)}..."`);
      setStatusMessage(`Editing text block: "${initialText}"`);
    }
  };

  // Keyboard Delete & Escape Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingTextId) {
          setEditingTextId(null);
          return;
        }
        if (editingStampId) {
          setEditingStampId(null);
          return;
        }
        if (floatingStampCoords) {
          setFloatingStampCoords(null);
          return;
        }
        selectItem(null, null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA' ||
          editingTextId ||
          editingStampId
        ) {
          return;
        }

        if (selectedItemId) {
          if (selectedItemType === 'text') deleteTextItem(selectedItemId);
          if (selectedItemType === 'image') deleteImageItem(selectedItemId);
          if (selectedItemType === 'annotation') deleteAnnotation(selectedItemId);
          if (selectedItemType === 'form') deleteFormField(selectedItemId);
          selectItem(null, null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemId, selectedItemType, editingTextId, editingStampId, floatingStampCoords]);

  if (!pdfBytes) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-400 select-none p-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-brand-400 mb-4 shadow-xl">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">No Document Open</h2>
        <p className="text-sm text-slate-400 text-center max-w-md mb-6">
          Open a local PDF file or create a clean new document to start editing, annotating, and signing offline.
        </p>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => useEditorStore.getState().createNewDocument('A4')}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition-colors"
          >
            <span>+ Create Blank Document</span>
          </button>
          <button
            onClick={async () => {
              if (window.electronAPI) {
                const res = await window.electronAPI.openPdfDialog();
                if (res) useEditorStore.getState().loadPdfBytes(new Uint8Array(res.data), res.name, res.filePath);
              } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/pdf';
                input.onchange = async (e: any) => {
                  const f = e.target?.files?.[0];
                  if (f) {
                    const buf = await f.arrayBuffer();
                    useEditorStore.getState().loadPdfBytes(new Uint8Array(buf), f.name);
                  }
                };
                input.click();
              }
            }}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs transition-colors shadow-md shadow-brand-600/20"
          >
            <span>Open Local PDF</span>
          </button>
        </div>
      </div>
    );
  }

  const pageIndex = currentPage - 1;
  const pageTexts = textItems.filter((t) => t.pageIndex === pageIndex);
  const pageImages = imageItems.filter((i) => i.pageIndex === pageIndex);
  const pageAnnotations = annotations.filter((a) => a.pageIndex === pageIndex);
  const pageForms = formFields.filter((f) => f.pageIndex === pageIndex);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={handleContainerMouseUp}
      className={`flex-1 overflow-auto bg-slate-950 p-8 flex relative select-none ${
        activeTool === 'hand'
          ? isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
          : 'cursor-default'
      }`}
    >
      {/* Centered Page Document Wrapper */}
      <div
        className="relative shadow-2xl rounded bg-white border border-slate-700/60 m-auto shrink-0"
        style={{
          width: pageRenderData?.viewportWidth || 595 * scale,
          height: pageRenderData?.viewportHeight || 842 * scale,
          transform:
            panOffset.x !== 0 || panOffset.y !== 0
              ? `translate(${panOffset.x}px, ${panOffset.y}px)`
              : undefined,
        }}
      >
        {/* PDF.js Page Canvas */}
        <canvas ref={canvasRef} className="block rounded pointer-events-none" />

        {/* Live Watermark Overlay (Real-time preview during editing) */}
        {watermark?.text &&
          watermark.text.trim() !== '' &&
          !(watermark.excludeFirstPage && currentPage === 1 && (pdfDocProxy?.numPages || 1) > 1) && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden select-none z-10"
              style={{ opacity: watermark.opacity ?? 0.25 }}
            >
              <div
                style={{
                  transform: `rotate(${-(watermark.rotationDegrees ?? 45)}deg)`,
                  transformOrigin: 'center center',
                  fontSize: `${(watermark.fontSize || 48) * scale}px`,
                  color: watermark.colorHex || '#94a3b8',
                  fontWeight: 800,
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.08em',
                  userSelect: 'none',
                  lineHeight: 1,
                  textShadow: '0 0 1px rgba(0,0,0,0.05)',
                }}
              >
                {watermark.text}
              </div>
            </div>
          )}

        {/* Live Header & Footer Overlay (Real-time preview during editing) */}
        {headerFooter &&
          !(headerFooter.excludeFirstPage && currentPage === 1 && (pdfDocProxy?.numPages || 1) > 1) && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-10 font-sans">
              {/* Header row */}
              {(headerFooter.headerLeft || headerFooter.headerCenter || headerFooter.headerRight) && (
                <div
                  className="absolute top-0 inset-x-0 flex items-center justify-between px-8"
                  style={{
                    top: `${20 * scale}px`,
                    fontSize: `${(headerFooter.fontSize || 9) * scale}px`,
                    color: headerFooter.colorHex || '#475569',
                  }}
                >
                  <div className="flex-1 text-left truncate">
                    {(headerFooter.headerLeft || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                  <div className="flex-1 text-center font-medium truncate">
                    {(headerFooter.headerCenter || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                  <div className="flex-1 text-right truncate">
                    {(headerFooter.headerRight || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                </div>
              )}

              {/* Footer row */}
              {(headerFooter.footerLeft || headerFooter.footerCenter || headerFooter.footerRight) && (
                <div
                  className="absolute bottom-0 inset-x-0 flex items-center justify-between px-8"
                  style={{
                    bottom: `${20 * scale}px`,
                    fontSize: `${(headerFooter.fontSize || 9) * scale}px`,
                    color: headerFooter.colorHex || '#475569',
                  }}
                >
                  <div className="flex-1 text-left truncate">
                    {(headerFooter.footerLeft || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                  <div className="flex-1 text-center font-mono truncate">
                    {(headerFooter.footerCenter || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                  <div className="flex-1 text-right truncate">
                    {(headerFooter.footerRight || '')
                      .replace(/{page}/gi, String(currentPage))
                      .replace(/{total}/gi, String(pdfDocProxy?.numPages || 1))}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Interactive Overlay Layer */}
        <div
          ref={overlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={`absolute inset-0 z-20 pointer-events-auto overflow-hidden ${
            activeTool === 'hand'
              ? isPanning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : activeTool === 'text-add' || activeTool === 'text-edit'
              ? 'cursor-text'
              : ''
          }`}
        >
          {/* 0. Existing Extracted PDF Text Layer (inside overlayRef so it receives clicks!) */}
          {(activeTool === 'text-edit' ||
            activeTool === 'strikethrough' ||
            activeTool === 'underline' ||
            activeTool === 'highlight' ||
            activeTool === 'select') &&
            pageRenderData &&
            pageRenderData.textItems.map((item, idx) => {
              // Hide underlying click box if already replaced by an edited TextItem
              const isReplaced = pageTexts.some(
                (t) =>
                  t.isRedactionReplacement &&
                  Math.abs(t.x - item.x / scale) < 5 &&
                  Math.abs(t.y - item.y / scale) < 5
              );
              if (isReplaced) return null;

              return (
                <div
                  key={`pdf_txt_${idx}`}
                  onMouseDown={(e) => {
                    if (e.button === 1) return;
                    if (activeTool !== 'select') {
                      e.stopPropagation();
                    }
                  }}
                  onClick={(e) => {
                    if (activeTool === 'select') return;
                    e.stopPropagation();
                    handleExistingTextClick(item, false);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleExistingTextClick(item, true);
                  }}
                  className={`absolute rounded transition-all z-10 ${
                    activeTool === 'strikethrough'
                      ? 'cursor-pointer hover:bg-red-400/30 hover:outline hover:outline-1 hover:outline-red-500'
                      : activeTool === 'underline'
                      ? 'cursor-pointer hover:bg-blue-400/30 hover:outline hover:outline-1 hover:outline-blue-500'
                      : activeTool === 'highlight'
                      ? 'cursor-pointer hover:bg-amber-300/40 hover:outline hover:outline-1 hover:outline-amber-400'
                      : activeTool === 'text-edit'
                      ? 'cursor-text border border-dashed border-sky-400/50 bg-sky-400/5 hover:bg-sky-400/25 hover:border-sky-500'
                      : 'cursor-pointer hover:bg-sky-400/15 hover:outline hover:outline-1 hover:outline-dashed hover:outline-sky-400/60'
                  }`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: Math.max(12, item.width),
                    height: Math.max(12, item.height),
                  }}
                  title={
                    activeTool === 'strikethrough'
                      ? `Click to strike through: "${item.str}"`
                      : activeTool === 'underline'
                      ? `Click to underline: "${item.str}"`
                      : activeTool === 'highlight'
                      ? `Click to highlight: "${item.str}"`
                      : activeTool === 'text-edit'
                      ? `Click to edit text: "${item.str}"`
                      : `Double-click to edit text: "${item.str}"`
                  }
                />
              );
            })}

          {/* 1. Added & Modified Text Items */}
          {pageTexts.map((text) => {
            const isSelected = selectedItemId === text.id;
            const isEditing = editingTextId === text.id;

            return (
              <div
                key={text.id}
                onMouseDown={(e) => {
                  if (activeTool === 'hand' || e.button === 1) {
                    handleContainerMouseDown(e);
                    return;
                  }
                  // Always stop propagation on existing text items so overlayRef never creates a double entry!
                  e.stopPropagation();
                  selectItem(text.id, 'text');

                  if (!isReadOnly && !isEditing) {
                    const coords = getCanvasCoords(e);
                    setDraggingItem({
                      id: text.id,
                      type: 'text',
                      startX: coords.x,
                      startY: coords.y,
                      initialX: text.x,
                      initialY: text.y,
                    });
                  }
                }}
                onClick={(e) => {
                  if (activeTool === 'hand') return;
                  e.stopPropagation();
                  selectItem(text.id, 'text');
                  if (!isReadOnly && !isEditing && (activeTool === 'text-edit' || activeTool === 'text-add')) {
                    setEditingTextId(text.id);
                    setEditingTextVal(text.text);
                  }
                }}
                onDoubleClick={(e) => {
                  if (activeTool === 'hand') return;
                  e.stopPropagation();
                  if (isReadOnly) {
                    openLicenseModal('Edit PDF Text (Currently Free Read-Only)');
                    return;
                  }
                  selectItem(text.id, 'text');
                  if (!isEditing) {
                    setEditingTextId(text.id);
                    setEditingTextVal(text.text);
                  }
                }}
                className={`absolute select-none p-0 rounded transition-shadow ${
                  isEditing
                    ? 'ring-2 ring-brand-500 bg-white/95 shadow-2xl z-40'
                    : isSelected
                    ? 'ring-2 ring-brand-500 bg-brand-50/20 cursor-move z-30'
                    : 'hover:ring-1 hover:ring-brand-400/60 cursor-pointer z-20'
                }`}
                style={{
                  left: text.x * scale,
                  top: text.y * scale,
                  width: text.width ? `${text.width * scale}px` : undefined,
                  fontSize: text.fontSize * scale,
                  lineHeight: text.lineHeight || 1.25,
                  fontFamily: toCssFontFamily(text.fontFamily),
                  color: text.color,
                  fontWeight: text.isBold ? 'bold' : 'normal',
                  fontStyle: text.isItalic ? 'italic' : 'normal',
                  textDecoration: text.isUnderline ? 'underline' : 'none',
                  textAlign: text.align || 'left',
                  backgroundColor: text.isRedactionReplacement ? '#ffffff' : undefined,
                  boxShadow: text.isRedactionReplacement ? '0 0 0 2px #ffffff' : undefined,
                  minWidth:
                    text.isRedactionReplacement && text.boundingBox
                      ? `${text.boundingBox.width * scale}px`
                      : text.width
                      ? `${text.width * scale}px`
                      : undefined,
                  minHeight:
                    text.isRedactionReplacement && text.boundingBox
                      ? `${text.boundingBox.height * scale}px`
                      : undefined,
                }}
              >
                {isEditing ? (
                  <div className="relative flex flex-col w-full">
                    {/* Floating Paragraph Quick Action Toolbar right above the active text block */}
                    <div
                      className="absolute -top-11 left-0 flex items-center space-x-1 bg-slate-900/95 border border-slate-700/90 shadow-2xl rounded-lg px-2 py-1 text-slate-200 z-50 backdrop-blur select-none"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleCommitText(text.id)}
                        className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shadow transition-colors"
                        title="Done / Save paragraph (Ctrl+Enter)"
                      >
                        <Check className="w-3 h-3 stroke-[2.5]" />
                        <span>Done</span>
                      </button>

                      <div className="h-4 w-px bg-slate-700 mx-1" />

                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { isBold: !text.isBold })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          text.isBold ? 'text-brand-400 bg-slate-800' : 'text-slate-400'
                        }`}
                        title="Bold"
                      >
                        <Bold className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { isItalic: !text.isItalic })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          text.isItalic ? 'text-brand-400 bg-slate-800' : 'text-slate-400'
                        }`}
                        title="Italic"
                      >
                        <Italic className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { isUnderline: !text.isUnderline })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          text.isUnderline ? 'text-brand-400 bg-slate-800' : 'text-slate-400'
                        }`}
                        title="Underline"
                      >
                        <Underline className="w-3 h-3" />
                      </button>

                      <div className="h-4 w-px bg-slate-700 mx-1" />

                      <button
                        type="button"
                        onClick={() =>
                          updateTextItem(text.id, {
                            fontSize: Math.max(6, Math.round(text.fontSize - 1)),
                          })
                        }
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono hover:bg-slate-800 text-slate-300"
                        title="Decrease Font Size"
                      >
                        A-
                      </button>
                      <span className="text-[10px] font-mono text-slate-400">
                        {Math.round(text.fontSize)}pt
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateTextItem(text.id, {
                            fontSize: Math.min(96, Math.round(text.fontSize + 1)),
                          })
                        }
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono hover:bg-slate-800 text-slate-300"
                        title="Increase Font Size"
                      >
                        A+
                      </button>

                      <div className="h-4 w-px bg-slate-700 mx-1" />

                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { align: 'left' })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          !text.align || text.align === 'left'
                            ? 'text-brand-400 bg-slate-800'
                            : 'text-slate-400'
                        }`}
                        title="Align Left"
                      >
                        <AlignLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { align: 'center' })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          text.align === 'center' ? 'text-brand-400 bg-slate-800' : 'text-slate-400'
                        }`}
                        title="Align Center"
                      >
                        <AlignCenter className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTextItem(text.id, { align: 'right' })}
                        className={`p-1 rounded hover:bg-slate-800 ${
                          text.align === 'right' ? 'text-brand-400 bg-slate-800' : 'text-slate-400'
                        }`}
                        title="Align Right"
                      >
                        <AlignRight className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Auto-growing multi-line textarea */}
                    <textarea
                      ref={(el) => {
                        if (el) {
                          el.style.height = 'auto';
                          el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
                        }
                      }}
                      value={editingTextVal}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        setEditingTextVal(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.max(e.target.scrollHeight, 28)}px`;
                      }}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault();
                          handleCommitText(text.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCommitText(text.id);
                        }
                      }}
                      onBlur={() => handleCommitText(text.id)}
                      autoFocus
                      rows={1}
                      placeholder="Type text or enter paragraph..."
                      className="w-full bg-white text-slate-900 border border-brand-500 rounded p-1.5 outline-none font-inherit resize-none focus:ring-2 focus:ring-brand-500/40"
                      style={{
                        fontSize: text.fontSize * scale,
                        lineHeight: text.lineHeight || 1.25,
                        fontFamily: toCssFontFamily(text.fontFamily),
                        color: text.color,
                        fontWeight: text.isBold ? 'bold' : 'normal',
                        fontStyle: text.isItalic ? 'italic' : 'normal',
                        textDecoration: text.isUnderline ? 'underline' : 'none',
                        textAlign: text.align || 'left',
                        minWidth: text.width ? `${text.width * scale}px` : '140px',
                        minHeight: `${Math.max(26, text.fontSize * scale * 1.3)}px`,
                      }}
                    />

                    {/* Drag handle to adjust paragraph wrap width live while editing */}
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const coords = getCanvasCoords(e);
                        setResizingText({
                          id: text.id,
                          startX: coords.x,
                          startY: coords.y,
                          initialWidth: text.width || (text.boundingBox?.width ?? 180),
                          mode: 'width',
                        });
                      }}
                      className="absolute top-1/2 -right-2 -translate-y-1/2 w-2.5 h-6 rounded-full bg-brand-500 border border-white cursor-ew-resize z-50 shadow hover:scale-110 transition-transform"
                      title="Drag to adjust paragraph wrap width"
                    />
                  </div>
                ) : (
                  <div
                    className="whitespace-pre-wrap break-words rounded select-text"
                    style={{
                      width: text.width ? `${text.width * scale}px` : undefined,
                      fontSize: text.fontSize * scale,
                      lineHeight: text.lineHeight || 1.25,
                      fontFamily: toCssFontFamily(text.fontFamily),
                      color: text.color,
                      fontWeight: text.isBold ? 'bold' : 'normal',
                      fontStyle: text.isItalic ? 'italic' : 'normal',
                      textDecoration: text.isUnderline ? 'underline' : 'none',
                      textAlign: text.align || 'left',
                    }}
                  >
                    {text.text}
                  </div>
                )}

                {/* Quick Edit Pencil Button when selected but not editing */}
                {isSelected && !isEditing && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingTextId(text.id);
                      setEditingTextVal(text.text);
                    }}
                    className="absolute -top-3 right-3 w-5 h-5 rounded-full bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                    title="Edit paragraph / text content"
                  >
                    <Edit3 className="w-2.5 h-2.5 stroke-[2.5]" />
                  </button>
                )}

                {/* Direct Close / Delete 'X' Button on Text Box */}
                {(isSelected || isEditing) && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (editingTextId === text.id) setEditingTextId(null);
                      deleteTextItem(text.id);
                      selectItem(null, null);
                      if (activeTool === 'text-add' || activeTool === 'text-edit') {
                        useEditorStore.getState().setActiveTool('select');
                      }
                    }}
                    className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                    title="Delete text (X)"
                  >
                    <X className="w-3 h-3 stroke-[2.5]" />
                  </button>
                )}

                {/* Paragraph Width Resize Handle (East) when selected */}
                {isSelected && !isEditing && (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const coords = getCanvasCoords(e);
                      setResizingText({
                        id: text.id,
                        startX: coords.x,
                        startY: coords.y,
                        initialWidth: text.width || (text.boundingBox?.width ?? 180),
                        mode: 'width',
                      });
                    }}
                    className="absolute top-1/2 -right-2 -translate-y-1/2 w-2 h-5 rounded-full bg-brand-500 border border-white cursor-ew-resize z-40 shadow hover:scale-110 transition-transform"
                    title="Drag to adjust paragraph wrap width"
                  />
                )}

                {/* Corner Resize Handle (NWSE) when selected */}
                {isSelected && !isEditing && (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const coords = getCanvasCoords(e);
                      setResizingText({
                        id: text.id,
                        startX: coords.x,
                        startY: coords.y,
                        initialWidth: text.width || (text.boundingBox?.width ?? 180),
                        initialHeight: text.height || 30,
                        mode: 'both',
                      });
                    }}
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-sm bg-brand-500 border border-white cursor-nwse-resize z-40 shadow hover:scale-110 transition-transform"
                    title="Drag to resize text box"
                  />
                )}
              </div>
            );
          })}

          {/* 2. Embedded Images */}
          {pageImages.map((img) => {
            const isSelected = selectedItemId === img.id;
            return (
              <div
                key={img.id}
                onMouseDown={(e) => {
                  if (activeTool === 'hand' || e.button === 1) {
                    handleContainerMouseDown(e);
                    return;
                  }
                  e.stopPropagation();
                  selectItem(img.id, 'image');
                  const coords = getCanvasCoords(e);
                  setDraggingItem({
                    id: img.id,
                    type: 'image',
                    startX: coords.x,
                    startY: coords.y,
                    initialX: img.x,
                    initialY: img.y,
                  });
                }}
                onClick={(e) => {
                  if (activeTool === 'hand') return;
                  e.stopPropagation();
                  selectItem(img.id, 'image');
                }}
                className={`absolute cursor-move p-0 rounded z-20 ${
                  isSelected ? 'ring-2 ring-brand-500 shadow-lg z-30' : 'hover:ring-1 hover:ring-brand-300'
                }`}
                style={{
                  left: img.x * scale,
                  top: img.y * scale,
                  width: img.width * scale,
                  height: img.height * scale,
                  opacity: img.opacity ?? 1,
                  transform: `rotate(${img.rotation || 0}deg)`,
                  transformOrigin: 'center center',
                }}
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-contain pointer-events-none rounded"
                />

                {isSelected && (
                  <>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteImageItem(img.id);
                        selectItem(null, null);
                      }}
                      className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow z-40 transition-transform hover:scale-110"
                      title="Delete image (X)"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const coords = getCanvasCoords(e);
                        setResizingImage({
                          id: img.id,
                          startX: coords.x,
                          startY: coords.y,
                          initialWidth: img.width,
                          initialHeight: img.height,
                        });
                      }}
                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-brand-500 border border-white rounded-full cursor-nwse-resize z-40"
                      title="Drag to resize image"
                    />
                  </>
                )}
              </div>
            );
          })}

          {/* 3. Annotations, Shapes, Notes & Stamps */}
          {pageAnnotations.map((ann) => {
            const isSelected = selectedItemId === ann.id;
            const isEditingStamp = editingStampId === ann.id;

            if (ann.type === 'freehand' && ann.points && ann.points.length > 0) {
              const svgPoints = ann.points.map((p) => `${p.x * scale},${p.y * scale}`).join(' ');
              const xs = ann.points.map((p) => p.x * scale);
              const ys = ann.points.map((p) => p.y * scale);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);

              return (
                <React.Fragment key={ann.id}>
                  <svg
                    onMouseDown={(e) => {
                      if (activeTool === 'hand' || e.button === 1) {
                        handleContainerMouseDown(e);
                        return;
                      }
                      e.stopPropagation();
                      selectItem(ann.id, 'annotation');
                      const coords = getCanvasCoords(e);
                      setDraggingItem({
                        id: ann.id,
                        type: 'annotation',
                        startX: coords.x,
                        startY: coords.y,
                        initialX: ann.rect.x,
                        initialY: ann.rect.y,
                        initialPoints: ann.points ? ann.points.map((pt) => ({ ...pt })) : undefined,
                      });
                    }}
                    onClick={(e) => {
                      if (activeTool === 'hand') return;
                      e.stopPropagation();
                      selectItem(ann.id, 'annotation');
                    }}
                    className="absolute inset-0 pointer-events-none w-full h-full z-20"
                  >
                    <polyline
                      points={svgPoints}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(14, (ann.strokeWidth || 2) * scale + 10)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-auto cursor-move"
                    />
                    <polyline
                      points={svgPoints}
                      fill="none"
                      stroke={ann.color}
                      strokeWidth={(ann.strokeWidth || 2) * scale}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={ann.opacity ?? 1}
                      className="pointer-events-none"
                    />
                  </svg>
                  {isSelected && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteAnnotation(ann.id);
                        selectItem(null, null);
                      }}
                      style={{ left: Math.max(8, maxX - 6), top: Math.max(8, minY - 14) }}
                      className="absolute w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                      title="Delete drawing (X)"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                  )}
                </React.Fragment>
              );
            }

            const stampStyle = ann.stampStyle || 'classic';
            const stampScaleFont = Math.max(8, Math.min(15 * scale, (ann.rect.height * scale) * 0.32));
            const stampLabelText = (ann.stampLabel || ann.stampType || 'APPROVED').toUpperCase();
            const showStampMeta = ann.showTimestamp !== false;

            const commitStampEdit = () => {
              const stillExists = useEditorStore.getState().annotations.some((a) => a.id === ann.id);
              if (stillExists) {
                const cleanLabel = editingStampVal.trim().toUpperCase();
                if (cleanLabel) {
                  const minDims = calculateStampDimensions(cleanLabel, showStampMeta);
                  updateAnnotation(ann.id, {
                    stampLabel: cleanLabel,
                    rect: {
                      ...ann.rect,
                      width: Math.max(ann.rect.width, minDims.width),
                    },
                  });
                }
              }
              setEditingStampId(null);
            };

            return (
              <div
                key={ann.id}
                onMouseDown={(e) => {
                  if (activeTool === 'hand' || e.button === 1) {
                    handleContainerMouseDown(e);
                    return;
                  }
                  e.stopPropagation();
                  dragMovedRef.current = false;
                  selectItem(ann.id, 'annotation');
                  if (ann.type !== 'freehand' && !isEditingStamp) {
                    const coords = getCanvasCoords(e);
                    setDraggingItem({
                      id: ann.id,
                      type: 'annotation',
                      startX: coords.x,
                      startY: coords.y,
                      initialX: ann.rect.x,
                      initialY: ann.rect.y,
                    });
                  }
                }}
                onClick={(e) => {
                  if (activeTool === 'hand') return;
                  e.stopPropagation();
                  selectItem(ann.id, 'annotation');
                }}
                className={`absolute cursor-pointer transition-shadow z-20 ${
                  isSelected && ann.type !== 'line' && ann.type !== 'arrow'
                    ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-transparent z-30'
                    : isSelected
                    ? 'z-30'
                    : ''
                }`}
                style={{
                  left: ann.rect.x * scale,
                  top: ann.rect.y * scale,
                  width: ann.rect.width * scale,
                  height: ann.rect.height * scale,
                  backgroundColor:
                    ann.type === 'highlight'
                      ? ann.color
                      : ann.type === 'redaction'
                      ? '#000000'
                      : 'transparent',
                  border:
                    ann.type === 'rectangle'
                      ? `${(ann.strokeWidth || 2) * scale}px solid ${ann.color}`
                      : ann.type === 'circle'
                      ? `${(ann.strokeWidth || 2) * scale}px solid ${ann.color}`
                      : 'none',
                  borderBottom:
                    ann.type === 'underline'
                      ? `${(ann.strokeWidth || 2) * scale}px solid ${ann.color}`
                      : undefined,
                  borderRadius:
                    ann.type === 'circle' ? '50%' : ann.type === 'underline' ? '0px' : '3px',
                  opacity: ann.type === 'highlight' ? ann.opacity || 0.35 : ann.opacity ?? 1,
                  transform:
                    ann.type === 'stamp' && ann.rotation
                      ? `rotate(${ann.rotation}deg)`
                      : undefined,
                  transformOrigin: 'center center',
                }}
              >
                {/* Strikethrough Authentic Horizontal Line */}
                {ann.type === 'strikethrough' && (
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{
                      top: '50%',
                      height: `${Math.max(1, (ann.strokeWidth || 2) * scale)}px`,
                      backgroundColor: ann.color || '#ef4444',
                      transform: 'translateY(-50%)',
                    }}
                  />
                )}

                {/* Line & Arrow Annotation SVG with Hit Area & Draggable Endpoints */}
                {(ann.type === 'line' || ann.type === 'arrow') && (() => {
                  const sw = (ann.strokeWidth || 2) * scale;
                  const relP0 = ann.points && ann.points.length >= 2 ? ann.points[0] : { x: 0, y: 0 };
                  const relP1 =
                    ann.points && ann.points.length >= 2
                      ? ann.points[1]
                      : { x: ann.rect.width, y: ann.rect.height };
                  const p0 = { x: relP0.x * scale, y: relP0.y * scale };
                  const p1 = { x: relP1.x * scale, y: relP1.y * scale };
                  const arrowGeom = computeArrowGeometry(p0, p1, sw);
                  const shaftEndX = ann.type === 'arrow' ? arrowGeom.shaftEndX : p1.x;
                  const shaftEndY = ann.type === 'arrow' ? arrowGeom.shaftEndY : p1.y;

                  return (
                    <>
                      <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
                        <line
                          x1={p0.x}
                          y1={p0.y}
                          x2={p1.x}
                          y2={p1.y}
                          stroke="transparent"
                          strokeWidth={Math.max(14, sw + 10)}
                          strokeLinecap="round"
                          className="pointer-events-auto cursor-move"
                        />
                        <line
                          x1={p0.x}
                          y1={p0.y}
                          x2={shaftEndX}
                          y2={shaftEndY}
                          stroke={ann.color || '#000000'}
                          strokeWidth={sw}
                          strokeLinecap="round"
                        />
                        {ann.type === 'arrow' && (
                          <polygon points={arrowGeom.polyPoints} fill={ann.color || '#000000'} />
                        )}
                      </svg>
                      {isSelected && (
                        <>
                          {([0, 1] as const).map((endIdx) => {
                            const pt = endIdx === 0 ? p0 : p1;
                            const otherRel = endIdx === 0 ? relP1 : relP0;
                            return (
                              <div
                                key={endIdx}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDraggingEndpoint({
                                    id: ann.id,
                                    endIndex: endIdx,
                                    fixedPoint: {
                                      x: ann.rect.x + otherRel.x,
                                      y: ann.rect.y + otherRel.y,
                                    },
                                  });
                                }}
                                style={{ left: pt.x - 5, top: pt.y - 5 }}
                                className="absolute w-2.5 h-2.5 rounded-full bg-white border-2 border-brand-500 shadow cursor-crosshair z-40 hover:scale-125 transition-transform"
                                title="Drag endpoint (Hold Shift to snap 45°)"
                              />
                            );
                          })}
                        </>
                      )}
                    </>
                  );
                })()}

                {/* Redaction label */}
                {ann.type === 'redaction' && (
                  <span className="text-[10px] text-white font-mono font-bold px-1 select-none">
                    [REDACTED]
                  </span>
                )}

                {/* Stamp & Digital Certificate Annotation Rendering */}
                {ann.type === 'stamp' && (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (ann.certificateMeta || isReadOnly) return;
                      setEditingStampId(ann.id);
                      setEditingStampVal(stampLabelText);
                    }}
                    className={`w-full h-full flex flex-col relative select-none ${
                      ann.certificateMeta ? 'justify-between rounded-[4px]' : 'items-center justify-center rounded-[3px]'
                    }`}
                    style={{
                      border: ann.certificateMeta
                        ? `${Math.max(1, 1.25 * scale)}px solid ${ann.color}`
                        : stampStyle === 'solid'
                        ? `${Math.max(1.5, 1.5 * scale)}px solid ${ann.color}`
                        : `${Math.max(2, 2.2 * scale)}px solid ${ann.color}`,
                      backgroundColor: ann.certificateMeta
                        ? 'transparent'
                        : stampStyle === 'solid'
                        ? ann.color
                        : stampStyle === 'classic'
                        ? 'rgba(255, 255, 255, 0.92)'
                        : 'transparent',
                      padding: ann.certificateMeta
                        ? `${Math.max(2, 3.5 * scale)}px ${Math.max(4, 6 * scale)}px`
                        : `${Math.max(2, 3 * scale)}px`,
                    }}
                  >
                    {ann.certificateMeta ? (
                      <div className="w-full h-full flex flex-col justify-between leading-tight">
                        <div
                          className="flex items-center space-x-1 font-bold uppercase tracking-wider border-b pb-0.5"
                          style={{
                            color: ann.color,
                            borderColor: ann.color,
                            fontSize: `${Math.max(6, Math.min(9.5, 6.8 * scale))}px`,
                          }}
                        >
                          <ShieldCheck
                            className="shrink-0"
                            style={{ width: `${Math.max(7, 8 * scale)}px`, height: `${Math.max(7, 8 * scale)}px` }}
                          />
                          <span>DIGITALLY SIGNED • SHA-256</span>
                        </div>
                        <div
                          className="text-slate-900 font-semibold leading-tight"
                          style={{ fontSize: `${Math.max(6, Math.min(9.5, 6.8 * scale))}px` }}
                        >
                          {ann.certificateMeta.signerName} ({ann.certificateMeta.signerRole})
                        </div>
                        <div
                          className="text-slate-800 leading-tight"
                          style={{ fontSize: `${Math.max(5.5, Math.min(9, 6.2 * scale))}px` }}
                        >
                          Reason: {ann.certificateMeta.reason}
                        </div>
                        <div
                          className="text-slate-800 leading-tight font-mono"
                          style={{ fontSize: `${Math.max(5.5, Math.min(8.5, 6 * scale))}px` }}
                        >
                          Time: {formatCertificateTimestamp(ann.certificateMeta.timestampIso)}
                        </div>
                        <div
                          className="font-mono text-slate-900 leading-[1.12] break-all"
                          style={{ fontSize: `${Math.max(5, Math.min(8, 5.4 * scale))}px` }}
                          title={`SHA-256: ${ann.certificateMeta.sha256}`}
                        >
                          SHA-256: {ann.certificateMeta.sha256}
                        </div>
                      </div>
                    ) : (
                      <>
                    {/* Inner rubber-stamp frame for Classic style */}
                    {stampStyle === 'classic' && (
                      <div
                        className="absolute pointer-events-none rounded-[1px]"
                        style={{
                          inset: `${Math.max(2, 3 * scale)}px`,
                          border: `${Math.max(0.75, 0.75 * scale)}px solid ${ann.color}`,
                          opacity: 0.7,
                        }}
                      />
                    )}

                    <div className="relative z-10 w-full flex flex-col items-center justify-center px-1.5">
                      {isEditingStamp ? (
                        <input
                          type="text"
                          value={editingStampVal}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => setEditingStampVal(e.target.value)}
                          onBlur={commitStampEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitStampEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingStampId(null);
                            }
                          }}
                          autoFocus
                          className="text-center font-black tracking-widest uppercase bg-transparent border-b border-dashed outline-none w-full"
                          style={{
                            color: stampStyle === 'solid' ? '#ffffff' : ann.color,
                            borderColor: stampStyle === 'solid' ? '#ffffff' : ann.color,
                            fontSize: `${stampScaleFont}px`,
                          }}
                        />
                      ) : (
                        <span
                          className="font-black tracking-widest uppercase text-center leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full"
                          style={{
                            color: stampStyle === 'solid' ? '#ffffff' : ann.color,
                            fontSize: `${stampScaleFont}px`,
                          }}
                          title="Double-click or click Edit to customize stamp label"
                        >
                          {stampLabelText}
                        </span>
                      )}

                      {showStampMeta && (
                        <span
                          className="font-mono leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full mt-0.5"
                          style={{
                            fontSize: `${Math.max(6.5, 7.5 * scale)}px`,
                            color: stampStyle === 'solid' ? 'rgba(255,255,255,0.88)' : ann.color,
                            opacity: 0.85,
                          }}
                        >
                          {new Date(ann.createdAt).toLocaleDateString()} • {ann.author || 'VERIFIED'}
                        </span>
                      )}
                    </div>
                      </>
                    )}

                    {/* Confirm / Done button while inline editing stamp */}
                    {isEditingStamp && !ann.certificateMeta && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          commitStampEdit();
                        }}
                        className="absolute -top-3 right-3 w-5 h-5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                        title="Commit Stamp Label (Enter)"
                      >
                        <Check className="w-3 h-3 stroke-[2.5]" />
                      </button>
                    )}

                    {/* Quick Edit Pencil Badge when selected */}
                    {isSelected && !isEditingStamp && !ann.certificateMeta && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingStampId(ann.id);
                          setEditingStampVal(stampLabelText);
                        }}
                        className="absolute -top-3 right-3 w-5 h-5 rounded-full bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                        title="Edit stamp label"
                      >
                        <Edit3 className="w-2.5 h-2.5 stroke-[2.5]" />
                      </button>
                    )}

                    {/* Direct Close / Delete 'X' on Stamp (visible when selected or editing) */}
                    {(isSelected || isEditingStamp) && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (editingStampId === ann.id) setEditingStampId(null);
                          deleteAnnotation(ann.id);
                          selectItem(null, null);
                        }}
                        className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                        title="Delete stamp (X)"
                      >
                        <X className="w-3 h-3 stroke-[2.5]" />
                      </button>
                    )}

                    {/* Resize Handle on Selected Stamp */}
                    {isSelected && !isEditingStamp && (
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const coords = getCanvasCoords(e);
                          setResizingAnnotation({
                            id: ann.id,
                            startX: coords.x,
                            startY: coords.y,
                            initialWidth: ann.rect.width,
                            initialHeight: ann.rect.height,
                          });
                        }}
                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-brand-500 border border-white rounded-full cursor-nwse-resize z-40 shadow"
                        title="Drag to resize stamp"
                      />
                    )}
                  </div>
                )}

                {/* Sticky Note Annotation with Direct Editing & Close 'X' */}
                {ann.type === 'note' && (
                  <div className="relative w-full h-full">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        selectItem(ann.id, 'annotation');
                      }}
                      style={{ backgroundColor: ann.color || '#fbbf24' }}
                      className="w-full h-full rounded-md hover:brightness-105 border border-amber-800/60 flex items-center justify-center shadow-lg text-xs font-bold text-slate-900 cursor-pointer transition-transform hover:scale-105"
                      title={ann.text || 'Click to edit sticky note'}
                    >
                      💬
                    </div>

                    {/* Direct Close / Delete 'X' Button on Closed Pin */}
                    {!isSelected && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteAnnotation(ann.id);
                          selectItem(null, null);
                        }}
                        className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow z-30 transition-transform hover:scale-110"
                        title="Delete note (X)"
                      >
                        <X className="w-2.5 h-2.5 stroke-[2.5]" />
                      </button>
                    )}

                    {/* Expanded Note Card with Immediate Direct Edit */}
                    {isSelected && (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className={`absolute -top-2 w-64 bg-amber-50 border-2 border-amber-400 rounded-lg shadow-2xl p-3 z-40 text-slate-900 text-xs animate-in fade-in zoom-in-95 duration-150 ${
                          ann.rect.x * scale + 285 > (pageRenderData?.viewportWidth || 892)
                            ? 'right-8'
                            : 'left-8'
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-amber-200 pb-1.5 mb-2">
                          <div className="flex items-center space-x-1.5 font-bold text-amber-900">
                            <MessageSquare className="w-3.5 h-3.5 text-amber-700" />
                            <span>Sticky Note</span>
                          </div>
                          {/* Prominent Remove / Close 'X' Button */}
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteAnnotation(ann.id);
                              selectItem(null, null);
                            }}
                            className="w-5 h-5 rounded-full bg-amber-200 hover:bg-red-500 hover:text-white text-amber-900 flex items-center justify-center transition-colors shadow-sm"
                            title="Remove Note (Delete X)"
                          >
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                        </div>

                        {/* Direct Note Textarea */}
                        <textarea
                          autoFocus
                          value={ann.text || ''}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => updateAnnotation(ann.id, { text: e.target.value })}
                          placeholder="Type note or comment here..."
                          rows={3}
                          className="w-full bg-amber-100/60 border border-amber-300 rounded p-1.5 text-xs text-amber-950 placeholder-amber-700/60 outline-none focus:ring-1 focus:ring-amber-500 resize-none font-sans"
                        />

                        {/* Note Actions Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-amber-200 mt-2 text-[10px]">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteAnnotation(ann.id);
                              selectItem(null, null);
                            }}
                            className="flex items-center space-x-1 text-red-700 hover:text-red-900 font-medium transition-colors"
                            title="Delete this note"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete Note</span>
                          </button>

                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              selectItem(null, null);
                            }}
                            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-amber-950 font-bold transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Remove & Resize buttons for other selected annotations */}
                {isSelected && ann.type !== 'note' && ann.type !== 'stamp' && (
                  <>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteAnnotation(ann.id);
                        selectItem(null, null);
                      }}
                      className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-md z-40 transition-transform hover:scale-110"
                      title="Delete annotation (X)"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                    {['highlight', 'underline', 'strikethrough', 'rectangle', 'circle', 'redaction'].includes(
                      ann.type
                    ) && (
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const coords = getCanvasCoords(e);
                          setResizingAnnotation({
                            id: ann.id,
                            startX: coords.x,
                            startY: coords.y,
                            initialWidth: ann.rect.width,
                            initialHeight: ann.rect.height,
                          });
                        }}
                        className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-brand-500 border border-white rounded-full cursor-nwse-resize z-40 shadow"
                        title="Drag to resize"
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* 4. Form Fields */}
          {pageForms.map((field) => {
            const isSelected = selectedItemId === field.id;
            return (
              <div
                key={field.id}
                onMouseDown={(e) => {
                  if (activeTool === 'hand' || e.button === 1) {
                    handleContainerMouseDown(e);
                    return;
                  }
                  e.stopPropagation();
                  selectItem(field.id, 'form');
                  const coords = getCanvasCoords(e);
                  setDraggingItem({
                    id: field.id,
                    type: 'form',
                    startX: coords.x,
                    startY: coords.y,
                    initialX: field.x,
                    initialY: field.y,
                  });
                }}
                onClick={(e) => {
                  if (activeTool === 'hand') return;
                  e.stopPropagation();
                  selectItem(field.id, 'form');
                }}
                className={`absolute rounded p-0 cursor-move z-20 ${
                  isSelected ? 'ring-2 ring-brand-500 z-30' : 'ring-1 ring-blue-400/60'
                }`}
                style={{
                  left: field.x * scale,
                  top: field.y * scale,
                  width: field.width * scale,
                  height: field.height * scale,
                }}
              >
                {isSelected && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteFormField(field.id);
                      selectItem(null, null);
                    }}
                    className="absolute -top-3 -right-3 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow z-30 transition-transform hover:scale-110"
                    title="Delete form field (X)"
                  >
                    <X className="w-3 h-3 stroke-[2.5]" />
                  </button>
                )}
                {field.type === 'signature' ? (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const st = useEditorStore.getState();
                      st.setPendingSignatureTarget({
                        fieldId: field.id,
                        pageIndex: field.pageIndex,
                        x: field.x,
                        y: field.y,
                        width: field.width,
                        height: field.height,
                      });
                      st.setActiveTab('signatures');
                    }}
                    className="w-full h-full bg-sky-50/90 border-2 border-dashed border-sky-500 rounded flex items-center justify-between px-2.5 text-sky-900 select-none"
                  >
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <FileSignature className="w-4 h-4 text-sky-600 shrink-0" />
                      <span className="text-[11px] font-bold tracking-wide truncate">
                        SIGNATURE FIELD
                      </span>
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const st = useEditorStore.getState();
                        st.setPendingSignatureTarget({
                          fieldId: field.id,
                          pageIndex: field.pageIndex,
                          x: field.x,
                          y: field.y,
                          width: field.width,
                          height: field.height,
                        });
                        st.setActiveTab('signatures');
                      }}
                      className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-semibold shrink-0 shadow-sm"
                    >
                      Sign
                    </button>
                  </div>
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={field.value === true}
                    onChange={(e) => updateFormField(field.id, { value: e.target.checked })}
                    className="w-full h-full cursor-pointer accent-brand-600"
                  />
                ) : field.type === 'dropdown' ? (
                  <select
                    value={String(field.value || '')}
                    onChange={(e) => updateFormField(field.id, { value: e.target.value })}
                    className="w-full h-full text-xs bg-blue-50/90 text-slate-900 border border-blue-400 rounded px-1 outline-none"
                  >
                    {field.options?.map((opt, i) => (
                      <option key={i} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'date' ? 'date' : 'text'}
                    placeholder={field.name}
                    value={String(field.value || '')}
                    onChange={(e) => updateFormField(field.id, { value: e.target.value })}
                    className="w-full h-full text-xs bg-blue-50/90 text-slate-900 border border-blue-400 rounded px-1.5 outline-none font-medium"
                  />
                )}
              </div>
            );
          })}

          {/* Active drawing rubberband preview */}
          {activeTool === 'draw' && isDrawing && currentPoints.length > 0 ? (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
              <polyline
                points={currentPoints.map((p) => `${p.x * scale},${p.y * scale}`).join(' ')}
                fill="none"
                stroke={activeColor === '#ffeb3b' ? '#ef4444' : activeColor}
                strokeWidth={(activeStrokeWidth || 2) * scale}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={activeOpacity}
              />
            </svg>
          ) : (activeTool === 'shape-line' || activeTool === 'shape-arrow') && isDrawing && dragStart && dragEnd ? (
            (() => {
              const p0 = { x: dragStart.x * scale, y: dragStart.y * scale };
              const p1 = { x: dragEnd.x * scale, y: dragEnd.y * scale };
              const sw = (activeStrokeWidth || 2) * scale;
              const strokeColor = activeColor === '#ffeb3b' ? '#111827' : activeColor || '#000000';
              const geom = computeArrowGeometry(p0, p1, sw);
              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
                  <line
                    x1={p0.x}
                    y1={p0.y}
                    x2={activeTool === 'shape-arrow' ? geom.shaftEndX : p1.x}
                    y2={activeTool === 'shape-arrow' ? geom.shaftEndY : p1.y}
                    stroke={strokeColor}
                    strokeWidth={sw}
                    strokeLinecap="round"
                  />
                  {activeTool === 'shape-arrow' && (
                    <polygon points={geom.polyPoints} fill={strokeColor} />
                  )}
                </svg>
              );
            })()
          ) : currentRect && (
            <div
              className="absolute border border-dashed border-brand-400 pointer-events-none"
              style={{
                left: currentRect.x * scale,
                top: currentRect.y * scale,
                width: Math.max(4, currentRect.width * scale),
                height: Math.max(
                  ['underline', 'strikethrough', 'highlight'].includes(activeTool) ? 14 * scale : 2,
                  currentRect.height * scale
                ),
                borderBottom:
                  activeTool === 'underline'
                    ? `${(activeStrokeWidth || 2) * scale}px solid ${
                        activeColor === '#ffeb3b' ? '#2563eb' : activeColor
                      }`
                    : undefined,
                borderRadius: activeTool === 'shape-circle' ? '50%' : activeTool === 'underline' ? '0px' : '2px',
                backgroundColor:
                  activeTool === 'redact'
                    ? '#000000'
                    : activeTool === 'highlight'
                    ? activeColor
                    : activeTool === 'strikethrough' || activeTool === 'underline'
                    ? 'transparent'
                    : 'rgba(56, 189, 248, 0.15)',
                opacity: activeTool === 'highlight' ? 0.35 : 0.85,
              }}
            >
              {/* Live line preview for strikethrough tool */}
              {activeTool === 'strikethrough' && (
                <div
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top: '50%',
                    height: `${Math.max(1, (activeStrokeWidth || 2) * scale)}px`,
                    backgroundColor: activeColor === '#ffeb3b' ? '#ef4444' : activeColor,
                    transform: 'translateY(-50%)',
                  }}
                />
              )}
            </div>
          )}

          {/* 5. Floating Stamp Selection Popover (Presets + Custom Stamp Builder) */}
          {floatingStampCoords && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute z-50 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-3 w-72 animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: Math.max(
                  10,
                  Math.min(
                    floatingStampCoords.x * scale,
                    (pageRenderData?.viewportWidth || 500) - 300
                  )
                ),
                top: Math.max(
                  10,
                  Math.min(
                    floatingStampCoords.y * scale,
                    (pageRenderData?.viewportHeight || 700) - 335
                  )
                ),
              }}
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
                <span className="text-xs font-bold text-slate-100 flex items-center space-x-1.5">
                  <Stamp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Insert Enterprise Stamp</span>
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => setFloatingStampCoords(null)}
                  className="w-5 h-5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                {STAMP_TEMPLATES.map((tmpl) => (
                  <button
                    key={`${tmpl.type}_${tmpl.label}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      const dims = calculateStampDimensions(tmpl.label, true);
                      const pageIdx = currentPage - 1;
                      addAnnotation({
                        pageIndex: pageIdx,
                        type: 'stamp',
                        rect: {
                          x: Math.round(floatingStampCoords.x),
                          y: Math.round(floatingStampCoords.y),
                          width: dims.width,
                          height: dims.height,
                        },
                        color: tmpl.color,
                        stampType: tmpl.type,
                        stampLabel: tmpl.label,
                        stampStyle: tmpl.defaultStyle,
                        rotation: tmpl.defaultRotation,
                        showTimestamp: true,
                        opacity: 0.95,
                      });
                      setFloatingStampCoords(null);
                    }}
                    className="group px-2 py-2 rounded-lg border border-slate-800 bg-slate-950/70 hover:bg-slate-800 hover:border-slate-600 flex items-center justify-center transition-all"
                  >
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase truncate max-w-full"
                      style={{
                        color: tmpl.defaultStyle === 'solid' ? '#ffffff' : tmpl.color,
                        backgroundColor:
                          tmpl.defaultStyle === 'solid' ? tmpl.color : 'transparent',
                        border: `1.5px solid ${tmpl.color}`,
                      }}
                    >
                      {tmpl.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Inline Custom Stamp Creator */}
              <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Custom Stamp
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => setCustomStampAngled((v) => !v)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      customStampAngled
                        ? 'bg-brand-600/20 border-brand-500/60 text-brand-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                    title="Toggle rubber-stamp tilt angle"
                  >
                    {customStampAngled ? '-10° Tilt' : '0° Flat'}
                  </button>
                </div>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    value={customStampLabel}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setCustomStampLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customStampLabel.trim()) {
                        e.preventDefault();
                        const label = customStampLabel.trim().toUpperCase();
                        const dims = calculateStampDimensions(label, true);
                        addAnnotation({
                          pageIndex: currentPage - 1,
                          type: 'stamp',
                          rect: {
                            x: Math.round(floatingStampCoords.x),
                            y: Math.round(floatingStampCoords.y),
                            width: dims.width,
                            height: dims.height,
                          },
                          color: customStampColor,
                          stampType: 'CUSTOM',
                          stampLabel: label,
                          stampStyle: 'classic',
                          rotation: customStampAngled ? -10 : 0,
                          showTimestamp: true,
                          opacity: 0.95,
                        });
                        setCustomStampLabel('');
                        setFloatingStampCoords(null);
                      }
                    }}
                    placeholder="e.g. URGENT, VERIFIED"
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 uppercase outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    disabled={!customStampLabel.trim()}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      const label = customStampLabel.trim().toUpperCase();
                      if (!label) return;
                      const dims = calculateStampDimensions(label, true);
                      addAnnotation({
                        pageIndex: currentPage - 1,
                        type: 'stamp',
                        rect: {
                          x: Math.round(floatingStampCoords.x),
                          y: Math.round(floatingStampCoords.y),
                          width: dims.width,
                          height: dims.height,
                        },
                        color: customStampColor,
                        stampType: 'CUSTOM',
                        stampLabel: label,
                        stampStyle: 'classic',
                        rotation: customStampAngled ? -10 : 0,
                        showTimestamp: true,
                        opacity: 0.95,
                      });
                      setCustomStampLabel('');
                      setFloatingStampCoords(null);
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                  >
                    Apply
                  </button>
                </div>
                <div className="flex items-center space-x-1.5">
                  {['#10b981', '#ef4444', '#2563eb', '#f59e0b', '#8b5cf6'].map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => setCustomStampColor(swatch)}
                      className={`w-4 h-4 rounded-full border transition-transform ${
                        customStampColor === swatch
                          ? 'border-white scale-110 ring-1 ring-white/50'
                          : 'border-slate-700 opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: swatch }}
                      title={`Select color ${swatch}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
