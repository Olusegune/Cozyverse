import { useEffect, useRef, useState } from "react";
import { Eraser, Undo2 } from "lucide-react";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; size: number };

const BRUSH_COLORS = ["#1a1a1a", "#e2725b", "#4a90d9", "#5cb85c", "#f0ad4e", "#ffffff"];

/**
 * A rough freehand layout canvas — the "Sketch" half of Assemble Cozies. The
 * user isn't drawing a finished picture, just outlining where things go
 * (a box for the sofa, a circle for the rug); GPT Image 2.5's edit endpoint
 * treats the exported PNG as a compositional reference, the same way
 * ChatGPT's own @Sketch tool works. Redraws from a stroke list (not a raw
 * bitmap) so Undo and canvas resizing both stay correct.
 */
export function SketchCanvas({
  width = 640,
  height = 400,
  onChange,
}: {
  width?: number;
  height?: number;
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(BRUSH_COLORS[0]);
  const [size, setSize] = useState(4);
  const drawingRef = useRef<Stroke | null>(null);

  const redraw = (allStrokes: Stroke[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  };

  useEffect(() => {
    redraw(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = { points: [pointFromEvent(event)], color, size };
    drawingRef.current = stroke;
    setStrokes((prev) => [...prev, stroke]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    stroke.points.push(pointFromEvent(event));
    redraw(strokes.slice(0, -1).concat(stroke));
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = null;
    emit();
  };

  const undo = () => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    redraw(next);
    onChange(canvasRef.current?.toDataURL("image/png") ?? "");
  };

  const clear = () => {
    setStrokes([]);
    redraw([]);
    onChange(canvasRef.current?.toDataURL("image/png") ?? "");
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full touch-none rounded-md border border-base-600 bg-white"
        style={{ aspectRatio: `${width} / ${height}`, cursor: "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex flex-wrap items-center gap-2">
        {BRUSH_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Brush color ${c}`}
            className="h-5 w-5 rounded-full border transition"
            style={{ backgroundColor: c, borderColor: color === c ? "#f5a623" : "#3a3d45", borderWidth: color === c ? 2 : 1 }}
          />
        ))}
        <input
          type="range"
          min={1}
          max={16}
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
          className="w-20"
          aria-label="Brush size"
        />
        <button
          type="button"
          onClick={undo}
          disabled={strokes.length === 0}
          className="ml-auto flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-40"
        >
          <Undo2 size={12} /> Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={strokes.length === 0}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-40"
        >
          <Eraser size={12} /> Clear
        </button>
      </div>
    </div>
  );
}
