"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Eraser, Save, Undo2 } from "lucide-react";
import "./modules.css";

type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[] };
const colors = [
  { label: "Graphite", value: "#27243a" },
  { label: "Purple", value: "#754cd1" },
  { label: "Teal", value: "#16847c" },
];

export async function readImageFile(file: File, maxBytes = 3 * 1024 * 1024) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > maxBytes) throw new Error(`Choose an image smaller than ${(maxBytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB.`);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This image could not be opened."));
    reader.onerror = () => reject(new Error("This image could not be opened."));
    reader.readAsDataURL(file);
  });
}

export function SketchPad({ onSave, disabled = false, label = "Sketch canvas" }: {
  onSave: (dataUrl: string) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(colors[0].value);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function render(draft?: Stroke) {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.fillStyle = "#fcfbff";
    context.fillRect(0, 0, element.width, element.height);
    for (const stroke of draft ? [...strokes, draft] : strokes) {
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = 3.2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      if (!rest.length) {
        context.arc(first.x, first.y, 1.6, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }

  useEffect(() => { render(current.current || undefined); });

  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * element.width / bounds.width, y: (event.clientY - bounds.top) * element.height / bounds.height };
  }

  function begin(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || saving || pointer.current !== null || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    const stroke = { color, points: [point(event)] };
    current.current = stroke;
    setSaved(false);
    render(stroke);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!current.current || pointer.current !== event.pointerId) return;
    current.current.points.push(point(event));
    render(current.current);
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (!current.current || pointer.current !== event.pointerId) return;
    const draft = current.current;
    current.current = null;
    pointer.current = null;
    setStrokes((previous) => [...previous, draft]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function save() {
    if (!canvas.current) return;
    setSaving(true);
    setError("");
    try {
      await onSave(canvas.current.toDataURL("image/png"));
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The sketch could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="sketch-pad">
    <div className="module-toolbar sketch-toolbar">
      <div className="sketch-palette" role="group" aria-label="Drawing color">
        {colors.map(({ label, value }) => <button className="sketch-swatch" type="button" key={value} aria-label={label} aria-pressed={color === value} disabled={disabled || saving} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}
      </div>
      <button className="button" type="button" disabled={disabled || saving || !strokes.length} onClick={() => { setStrokes((previous) => previous.slice(0, -1)); setSaved(false); }}><Undo2 size={15} /> Undo</button>
      <button className="button" type="button" disabled={disabled || saving || !strokes.length} onClick={() => { setStrokes([]); setSaved(false); }}><Eraser size={15} /> Clear</button>
    </div>
    <canvas role="img" aria-label={label} ref={canvas} width={1120} height={630} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      Draw with a pointer or touch, or attach an image using the upload field.
    </canvas>
    <div className="module-toolbar sketch-footer">
      <button type="button" className="button" disabled={disabled || saving || !strokes.length || saved} onClick={() => void save()}><Save size={15} /> {saving ? "Saving sketch…" : "Save sketch"}</button>
      {saved && <span role="status" className="module-confirmation">Sketch saved.</span>}
      {error && <span role="alert" className="module-error">{error}</span>}
    </div>
  </div>;
}
