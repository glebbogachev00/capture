"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draw on a photo before it goes into a capture.
 *
 * Strokes are held as normalised 0..1 points so they stay put when the canvas
 * is re-laid-out or the image is rotated, and the whole thing is repainted
 * from scratch on every change rather than accumulating.
 */
export function Markup({
  src,
  onSave,
  onClose,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#C4452B");
  const [rot, setRot] = useState(0);
  const draw = useRef(false);
  const strokes = useRef<{ c: string; p: { x: number; y: number }[] }[]>([]);
  const img = useRef<HTMLImageElement | null>(null);

  const paint = useCallback(() => {
    const c = ref.current;
    if (!c || !img.current) return;
    const im = img.current;
    const swap = rot % 180 !== 0;
    const w = swap ? im.height : im.width;
    const h = swap ? im.width : im.height;
    const scale = Math.min(1, 1100 / Math.max(w, h));
    c.width = w * scale;
    c.height = h * scale;

    const x = c.getContext("2d");
    if (!x) return;
    x.save();
    x.translate(c.width / 2, c.height / 2);
    x.rotate((rot * Math.PI) / 180);
    x.drawImage(
      im,
      (-im.width * scale) / 2,
      (-im.height * scale) / 2,
      im.width * scale,
      im.height * scale
    );
    x.restore();

    x.lineCap = "round";
    x.lineJoin = "round";
    strokes.current.forEach((s) => {
      x.strokeStyle = s.c;
      x.lineWidth = Math.max(3, c.width / 190);
      x.beginPath();
      s.p.forEach((pt, i) =>
        i
          ? x.lineTo(pt.x * c.width, pt.y * c.height)
          : x.moveTo(pt.x * c.width, pt.y * c.height)
      );
      x.stroke();
    });
  }, [rot]);

  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      img.current = im;
      paint();
    };
    im.src = src;
  }, [src, paint]);

  useEffect(() => {
    paint();
  }, [rot, paint]);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const p = "touches" in e ? e.touches[0] : e;
    return { x: (p.clientX - r.left) / r.width, y: (p.clientY - r.top) / r.height };
  };
  const down = (e: React.MouseEvent | React.TouchEvent) => {
    draw.current = true;
    strokes.current.push({ c: color, p: [pos(e)] });
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draw.current) return;
    e.preventDefault();
    strokes.current[strokes.current.length - 1].p.push(pos(e));
    paint();
  };
  const up = () => {
    draw.current = false;
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-in" onClick={(e) => e.stopPropagation()}>
        <canvas
          ref={ref}
          onMouseDown={down}
          onMouseMove={move}
          onMouseUp={up}
          onMouseLeave={up}
          onTouchStart={down}
          onTouchMove={move}
          onTouchEnd={up}
        />
        <div className="tools">
          {["#C4452B", "#2F5D3F", "#1B3F7A", "#191D19"].map((c) => (
            <button
              key={c}
              className={"swatch" + (c === color ? " on" : "")}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={"Draw in " + c}
            />
          ))}
          <button
            className="icon-btn"
            onClick={() => setRot((r) => (r + 90) % 360)}
            aria-label="Rotate"
          >
            ⟳
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              strokes.current.pop();
              paint();
            }}
            aria-label="Undo"
          >
            ↶
          </button>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="capture-btn"
            onClick={() => onSave(ref.current!.toDataURL("image/jpeg", 0.82))}
          >
            Save markup
          </button>
        </div>
      </div>
    </div>
  );
}
