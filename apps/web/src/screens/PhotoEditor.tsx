import { useEffect, useRef, useState } from "react";
import {
  MAX_ZOOM,
  drawFraming,
  initialFraming,
  panFraming,
  renderAvatar,
  rotateFraming,
  zoomFraming,
  type Framing,
} from "../design/avatars";
import { Icon } from "../design/icons";
import { Modal } from "../design/Modal";

/** Side of the square the person drags and zooms in, in CSS pixels. */
const VIEW = 280;
const KEY_STEP = 12;

/**
 * Lets the person frame a profile photo before it is sent: drag to move, zoom
 * with the slider, the wheel or +/-, turn it by quarter turns. What the canvas
 * shows is drawn by the same code that makes the final photo.
 */
export function PhotoEditor({
  file,
  onCancel,
  onSave,
}: {
  file: File;
  onCancel: () => void;
  onSave: (photo: Blob) => Promise<void>;
}) {
  const [image, setImage] = useState<ImageBitmap | "failed" | null>(null);
  const [framing, setFraming] = useState<Framing>(initialFraming);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const bitmap = typeof image === "object" && image !== null ? image : null;

  useEffect(() => {
    let current: ImageBitmap | null = null;
    let cancelled = false;
    createImageBitmap(file)
      .then((loaded) => {
        if (cancelled) loaded.close();
        else {
          current = loaded;
          setImage(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) setImage("failed");
      });
    return () => {
      cancelled = true;
      current?.close();
    };
  }, [file]);

  useEffect(() => {
    const element = canvas.current;
    if (bitmap === null || element === null) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(VIEW * ratio);
    element.height = Math.round(VIEW * ratio);
    const frame = requestAnimationFrame(() => {
      const context = element.getContext("2d");
      if (context !== null)
        drawFraming(context, bitmap, framing, element.width);
    });
    return () => cancelAnimationFrame(frame);
  }, [bitmap, framing]);

  const zoomBy = (factor: number) =>
    setFraming((current) => zoomFraming(current, current.zoom * factor));

  // A wheel listener has to be non-passive to stop the page from scrolling.
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY / 300));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [bitmap]);

  const move = (dx: number, dy: number) => {
    if (bitmap === null) return;
    setFraming((current) =>
      panFraming(bitmap.width, bitmap.height, current, dx, dy, VIEW),
    );
  };

  async function save() {
    if (bitmap === null) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave(await renderAvatar(bitmap, framing));
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onCancel} width="400px">
      <div className="dh">
        <h2 id="dlgt">Ajustar foto de perfil</h2>
      </div>
      <div className="dbd col gap12">
        {image === "failed" ? (
          <p className="muted" role="alert">
            Não foi possível abrir essa imagem. Tente outro arquivo (JPG, PNG ou
            WebP).
          </p>
        ) : (
          <>
            <div className="photo-view" style={{ width: VIEW, height: VIEW }}>
              <canvas
                aria-label="Foto de perfil. Arraste para mover; use as setas para mover e + ou - para ampliar."
                onKeyDown={(event) => {
                  const keys: Record<string, [number, number]> = {
                    ArrowLeft: [KEY_STEP, 0],
                    ArrowRight: [-KEY_STEP, 0],
                    ArrowUp: [0, KEY_STEP],
                    ArrowDown: [0, -KEY_STEP],
                  };
                  const step = keys[event.key];
                  if (step !== undefined) move(step[0], step[1]);
                  else if (event.key === "+" || event.key === "=") zoomBy(1.1);
                  else if (event.key === "-") zoomBy(1 / 1.1);
                  else return;
                  event.preventDefault();
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerMove={(event) => {
                  const last = drag.current;
                  if (last === null) return;
                  drag.current = { x: event.clientX, y: event.clientY };
                  move(event.clientX - last.x, event.clientY - last.y);
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                ref={canvas}
                role="img"
                style={{ width: VIEW, height: VIEW }}
                tabIndex={0}
              />
              <span aria-hidden="true" className="photo-mask" />
              {bitmap === null ? (
                <span className="photo-wait">Abrindo…</span>
              ) : null}
            </div>
            <div className="row gap8 photo-tools">
              <button
                aria-label="Girar para a esquerda"
                className="btn sm ghost photo-left"
                disabled={bitmap === null}
                onClick={() => setFraming((c) => rotateFraming(c, -1))}
                type="button"
              >
                <Icon name="rot" />
              </button>
              <button
                aria-label="Reduzir"
                className="btn sm ghost"
                disabled={bitmap === null}
                onClick={() => zoomBy(1 / 1.15)}
                type="button"
              >
                −
              </button>
              <input
                aria-label="Zoom"
                className="photo-zoom"
                disabled={bitmap === null}
                max={MAX_ZOOM}
                min={1}
                onChange={(event) =>
                  setFraming((c) => zoomFraming(c, Number(event.target.value)))
                }
                step={0.01}
                type="range"
                value={framing.zoom}
              />
              <button
                aria-label="Ampliar"
                className="btn sm ghost"
                disabled={bitmap === null}
                onClick={() => zoomBy(1.15)}
                type="button"
              >
                +
              </button>
              <button
                aria-label="Girar para a direita"
                className="btn sm ghost"
                disabled={bitmap === null}
                onClick={() => setFraming((c) => rotateFraming(c, 1))}
                type="button"
              >
                <Icon name="rot" />
              </button>
            </div>
            <p className="xs muted">
              Arraste a foto para enquadrar. O círculo mostra como ela aparece
              para a equipe.
            </p>
            {failed ? (
              <p className="xs st-danger" role="alert">
                Não foi possível enviar a foto. Tente de novo.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="dft">
        <button className="btn" onClick={onCancel} type="button">
          Cancelar
        </button>
        <button
          className={`btn primary${saving ? " loading" : ""}`}
          disabled={bitmap === null || saving}
          onClick={() => void save()}
          type="button"
        >
          Salvar foto
        </button>
      </div>
    </Modal>
  );
}
