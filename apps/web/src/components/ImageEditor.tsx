import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Crop as CropIcon, Loader2, Pencil, Undo2, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useBackable } from '../hooks/useBackable';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ImageEditorProps {
  file: File;
  onCancel: () => void;
  onConfirm: (edited: File) => void;
}

type Mode = 'draw' | 'crop';
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type DragKind = 'move' | Corner;

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CanvasSnapshot {
  width: number;
  height: number;
  data: ImageData;
}

// WhatsApp-style fixed palette, plus a custom color picker for anything else.
const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#000000'];

// Cap the working canvas so drawing/undo snapshots (a full ImageData copy
// each) stay cheap on phone-camera-sized photos; the true resolution is
// restored on export via EXPORT SCALE below, so quality never drops below
// the original.
const EDIT_MAX_DIM = 1600;
const HISTORY_LIMIT = 12;
const MIN_CROP_SIZE = 40; // in displayed (CSS) pixels

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export default function ImageEditor({ file, onCancel, onConfirm }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('draw');
  const [color, setColor] = useState(PALETTE[0]);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  const historyRef = useRef<CanvasSnapshot[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const exportScaleRef = useRef(1);
  const dragRef = useRef<{ kind: DragKind; startX: number; startY: number; startRect: CropRect } | null>(null);

  useBackable(true, onCancel);

  // Draw the source file onto the working canvas, downscaled to EDIT_MAX_DIM
  // if needed. exportScaleRef remembers how much to blow the result back up
  // by so the exported file isn't worse than the original.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const editScale = Math.min(1, EDIT_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * editScale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * editScale));
      exportScaleRef.current = 1 / editScale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push({ width: canvas.width, height: canvas.height, data });
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    setHistoryLen(historyRef.current.length);
  }, []);

  const initCropRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const marginX = rect.width * 0.1;
    const marginY = rect.height * 0.1;
    setCropRect({
      x: marginX,
      y: marginY,
      w: Math.max(MIN_CROP_SIZE, rect.width - marginX * 2),
      h: Math.max(MIN_CROP_SIZE, rect.height - marginY * 2),
    });
  }, []);

  useEffect(() => {
    if (mode === 'crop' && ready) initCropRect();
    else if (mode !== 'crop') setCropRect(null);
  }, [mode, ready, initCropRect]);

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const snap = historyRef.current.pop();
    if (!canvas || !ctx || !snap) return;
    setHistoryLen(historyRef.current.length);
    canvas.width = snap.width;
    canvas.height = snap.height;
    ctx.putImageData(snap.data, 0, 0);
    if (mode === 'crop') initCropRect();
  };

  const getCanvasPoint = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const strokeWidth = (canvas: HTMLCanvasElement) => Math.max(4, Math.round(canvas.width / 150));

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const pt = getCanvasPoint(e);
    if (!canvas || !ctx || !pt) return;
    canvas.setPointerCapture(e.pointerId);
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = pt;
    // A single tap/click still leaves a dot rather than nothing.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, strokeWidth(canvas) / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw' || !drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const pt = getCanvasPoint(e);
    const last = lastPointRef.current;
    if (!canvas || !ctx || !pt || !last) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth(canvas);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released — harmless.
    }
  };

  const beginDrag = (kind: DragKind) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropRect) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startRect: cropRect };
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const start = drag.startRect;
    let { x, y, w, h } = start;

    if (drag.kind === 'move') {
      x = clamp(start.x + dx, 0, Math.max(0, rect.width - w));
      y = clamp(start.y + dy, 0, Math.max(0, rect.height - h));
    } else {
      if (drag.kind.includes('n')) {
        const newY = clamp(start.y + dy, 0, start.y + start.h - MIN_CROP_SIZE);
        h = start.h - (newY - start.y);
        y = newY;
      }
      if (drag.kind.includes('s')) {
        h = clamp(start.h + dy, MIN_CROP_SIZE, rect.height - start.y);
      }
      if (drag.kind.includes('w')) {
        const newX = clamp(start.x + dx, 0, start.x + start.w - MIN_CROP_SIZE);
        w = start.w - (newX - start.x);
        x = newX;
      }
      if (drag.kind.includes('e')) {
        w = clamp(start.w + dx, MIN_CROP_SIZE, rect.width - start.x);
      }
    }
    setCropRect({ x, y, w, h });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const applyCrop = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !cropRect) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = Math.round(cropRect.x * scaleX);
    const sy = Math.round(cropRect.y * scaleY);
    const sw = Math.round(cropRect.w * scaleX);
    const sh = Math.round(cropRect.h * scaleY);
    if (sw < 1 || sh < 1) return;

    pushHistory();

    const temp = document.createElement('canvas');
    temp.width = sw;
    temp.height = sh;
    const tctx = temp.getContext('2d');
    tctx?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(temp, 0, 0);

    setMode('draw');
    setCropRect(null);
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || exporting) return;
    setExporting(true);
    try {
      // "Listo" is the single "I'm done" action — drawing has no separate
      // apply step, so a crop the user positioned but never explicitly
      // confirmed with "Aplicar recorte" must still take effect here.
      // applyCrop() mutates canvasRef.current synchronously (direct width/
      // height/drawImage calls), so the export below already sees the
      // cropped canvas even though the setMode/setCropRect state updates
      // it also triggers haven't flushed yet.
      if (mode === 'crop' && cropRect) applyCrop();
      const scale = exportScaleRef.current;
      let exportCanvas: HTMLCanvasElement = canvas;
      if (scale > 1.001) {
        const targetW = Math.max(1, Math.round(canvas.width * scale));
        const targetH = Math.max(1, Math.round(canvas.height * scale));
        const temp = document.createElement('canvas');
        temp.width = targetW;
        temp.height = targetH;
        const tctx = temp.getContext('2d');
        if (tctx) {
          tctx.imageSmoothingEnabled = true;
          tctx.imageSmoothingQuality = 'high';
          tctx.drawImage(canvas, 0, 0, targetW, targetH);
          exportCanvas = temp;
        }
      }
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = type === 'image/jpeg' ? 0.92 : undefined;
      const blob = await new Promise<Blob | null>((resolve) =>
        exportCanvas.toBlob((b) => resolve(b), type, quality),
      );
      if (!blob) return;
      onConfirm(new File([blob], file.name, { type: blob.type }));
    } finally {
      setExporting(false);
    }
  };

  const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
  const cornerClass: Record<Corner, string> = {
    nw: '-top-2 -left-2 cursor-nwse-resize',
    ne: '-top-2 -right-2 cursor-nesw-resize',
    sw: '-bottom-2 -left-2 cursor-nesw-resize',
    se: '-bottom-2 -right-2 cursor-nwse-resize',
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-stone-950">
      <div className="flex items-center justify-between p-4 border-b border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/50 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          title="Cancelar"
          aria-label="Cancelar"
          className="p-2 hover:bg-stone-200 dark:hover:bg-stone-800 rounded-full transition-all"
        >
          <X className="w-5 h-5 text-stone-500 dark:text-stone-300" />
        </button>
        <h2 className="text-sm font-bold dark:text-white">Editar imagen</h2>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!ready || exporting}
          title="Listo"
          aria-label="Listo"
          className="p-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-stone-100 dark:bg-stone-900 p-4 overflow-hidden">
        {!ready && <Loader2 className="w-8 h-8 animate-spin text-stone-400" />}
        <div
          ref={containerRef}
          className={cn('relative inline-block max-w-full max-h-full overflow-hidden', !ready && 'hidden')}
        >
          <canvas
            ref={canvasRef}
            className="block max-w-full max-h-full rounded-lg shadow-lg touch-none select-none"
            style={{ cursor: mode === 'draw' ? 'crosshair' : 'default' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {mode === 'crop' && cropRect && (
            <div
              // touch-none is load-bearing on mobile: without it, dragging
              // this box competes with the browser's native touch-scroll/
              // pinch-zoom gesture recognizer, which intermittently steals
              // or cancels the pointer sequence mid-drag — the crop box
              // would only move in short, stuck bursts instead of tracking
              // the finger smoothly. The canvas above already has this for
              // the same reason; this box and its corner handles didn't.
              className="absolute border-2 border-white touch-none select-none"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.w,
                height: cropRect.h,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                cursor: 'move',
              }}
              onPointerDown={beginDrag('move')}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {corners.map((corner) => (
                <div
                  key={corner}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    beginDrag(corner)(e);
                  }}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className={cn(
                    'absolute w-5 h-5 bg-white border-2 border-emerald-600 rounded-full shadow touch-none',
                    cornerClass[corner],
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-stone-100 dark:border-stone-800 p-3 space-y-3 bg-stone-50/50 dark:bg-stone-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('draw')}
            title="Dibujar"
            aria-label="Dibujar"
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
              mode === 'draw'
                ? 'bg-emerald-600 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700',
            )}
          >
            <Pencil className="w-4 h-4" />
            Dibujar
          </button>
          <button
            type="button"
            onClick={() => setMode('crop')}
            title="Recortar"
            aria-label="Recortar"
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
              mode === 'crop'
                ? 'bg-emerald-600 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700',
            )}
          >
            <CropIcon className="w-4 h-4" />
            Recortar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={undo}
            disabled={historyLen === 0}
            title="Deshacer"
            aria-label="Deshacer"
            className="p-2 rounded-full hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            <Undo2 className="w-5 h-5" />
          </button>
        </div>

        {mode === 'draw' && (
          <div className="flex items-center gap-2 flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                aria-label={`Color ${c}`}
                className={cn(
                  'w-7 h-7 rounded-full border-2 shrink-0 transition-transform',
                  color === c ? 'border-emerald-500 scale-110' : 'border-stone-300 dark:border-stone-600',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <label
              className="w-7 h-7 rounded-full shrink-0 border-2 border-dashed border-stone-300 dark:border-stone-600 relative overflow-hidden cursor-pointer"
              title="Color personalizado"
            >
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Color personalizado"
              />
              <span
                className="block w-full h-full rounded-full pointer-events-none"
                style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
              />
            </label>
          </div>
        )}

        {mode === 'crop' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyCrop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Check className="w-4 h-4" />
              Aplicar recorte
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
