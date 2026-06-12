import { useEffect, useRef, useState } from "react";
import { fetchProductView, TURNAROUND_ANGLES } from "../../api/views";
import { buildDepthMap } from "./depth";
import { loadProductImage } from "./loadImage";
import { ProductStage, type StageMode } from "./stage";

type StageStatus = "loading" | "stage" | "flat" | "placeholder";

/* Renders the product photo as a rotating 3D object on a WebGL2 canvas.
   When `turnaround` is set, Gemini-generated turnaround frames stream in
   from the backend and upgrade the rotation to real multi-view imagery.
   Falls back to the flat photo when the image is CORS-tainted or WebGL is
   unavailable, and to the shirt placeholder when there is no usable image. */
export function ProductStageView({
  imageUrl,
  mode,
  rimColor,
  placeholder,
  turnaround = null
}: {
  imageUrl: string | null;
  mode: StageMode;
  rimColor?: string;
  placeholder: React.ReactNode;
  /** Product title for generation context; null disables turnaround. */
  turnaround?: { title: string | null } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ProductStage | null>(null);
  const [status, setStatus] = useState<StageStatus>(imageUrl ? "loading" : "placeholder");
  const [spun, setSpun] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setStatus("placeholder");
      return;
    }
    setStatus("loading");
    let cancelled = false;
    let cleanupImage: (() => void) | null = null;

    loadProductImage(imageUrl)
      .then(({ image, cleanup }) => {
        cleanupImage = cleanup;
        if (cancelled) {
          cleanup();
          return;
        }
        const canvas = canvasRef.current;
        const map = canvas ? buildDepthMap(image) : null;
        if (!map || !canvas) {
          // Image loaded but the canvas would taint (no usable bytes): show
          // the flat photo instead of the rotating stage.
          setStatus("flat");
          return;
        }
        if (/stageDebug/.test(window.location.search)) {
          (window as unknown as { __stageMap?: unknown }).__stageMap = map;
        }
        try {
          stageRef.current = new ProductStage(canvas, map, {
            reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          });
          setStatus("stage");
        } catch {
          setStatus("flat");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("placeholder");
      });

    return () => {
      cancelled = true;
      cleanupImage?.();
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, [imageUrl]);

  useEffect(() => {
    stageRef.current?.setMode(mode);
  }, [mode, status]);

  // Stream Gemini turnaround frames into the stage. Kicked off as soon as the
  // front view is up (during the scan), so the verdict usually lands on a
  // ready full rotation. Each angle is independent; failures are non-fatal.
  useEffect(() => {
    if (status !== "stage" || !turnaround || !imageUrl) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let absoluteUrl: URL;
    try {
      absoluteUrl = new URL(imageUrl, window.location.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(absoluteUrl.protocol)) return;
    let cancelled = false;

    for (const angle of TURNAROUND_ANGLES) {
      fetchProductView(absoluteUrl.href, angle, turnaround.title)
        .then(
          (generated) =>
            new Promise<{ angle: number; image: HTMLImageElement }>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve({ angle: generated.angle, image });
              image.onerror = () => reject(new Error("generated view failed to decode"));
              image.src = generated.dataUrl;
            })
        )
        .then(({ angle: viewAngle, image }) => {
          if (cancelled) return;
          const map = buildDepthMap(image);
          if (map) stageRef.current?.addView(viewAngle, map);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [status, imageUrl, turnaround?.title]);

  useEffect(() => {
    if (rimColor) stageRef.current?.setRimColor(rimColor);
  }, [rimColor, status]);

  // Pause rendering when the panel tab is hidden or the stage scrolls away.
  useEffect(() => {
    if (status !== "stage") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let visible = true;
    let intersecting = true;
    const sync = () => stageRef.current?.setRunning(visible && intersecting);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      sync();
    };
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? true;
      sync();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    stageRef.current?.pointerDown(event.clientX);
    setSpun(true);
  }

  const showHint = mode === "orbit" && status === "stage" && !spun;

  return (
    <div className={`product-stage product-stage--${mode}`} aria-label="Product preview">
      {status === "placeholder" ? (
        <div className="product-stage-placeholder">{placeholder}</div>
      ) : null}
      {status === "flat" && imageUrl ? (
        <img className="product-stage-flat" src={imageUrl} alt="" />
      ) : null}
      <canvas
        ref={canvasRef}
        className="product-stage-canvas"
        data-active={status === "stage"}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => stageRef.current?.pointerMove(event.clientX)}
        onPointerUp={() => stageRef.current?.pointerUp()}
        onPointerCancel={() => stageRef.current?.pointerUp()}
      />
      {showHint ? (
        <span className="stage-hint" aria-hidden="true">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 7a5 5 0 0 1 9-3" />
            <path d="M11 1.6V4h-2.4" />
            <path d="M12 7a5 5 0 0 1-9 3" />
            <path d="M3 12.4V10h2.4" />
          </svg>
          <span>Drag to spin</span>
        </span>
      ) : null}
    </div>
  );
}
