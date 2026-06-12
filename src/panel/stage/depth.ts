/* Builds a colour texture + depth field from a single product photo.
   No network calls: background colour is estimated from border pixels, the
   foreground mask comes from colour distance, and depth is the mask "puffed"
   by iterated box blurs into a soft pillow profile, plus a high-pass luminance
   term so fabric folds read as relief. */

export type DepthMap = {
  /** Padded square-ish colour texture, product centred with a margin. */
  color: HTMLCanvasElement;
  /** Depth field aligned with `color`, row-major, 0..1. */
  depth: Float32Array;
  depthWidth: number;
  depthHeight: number;
  /** Mask bounding box in texture UV space, for framing the object. */
  bounds: { cx: number; cy: number; hw: number; hh: number };
  /** Fraction of pixels considered foreground. */
  coverage: number;
  /** True when silhouette extraction looked reliable; false means slab mode. */
  silhouette: boolean;
};

const DEPTH_RES = 176;
const TEXTURE_RES = 512;
/** Margin around the product inside the texture, as a fraction of one side. */
const PAD = 0.09;

export function buildDepthMap(image: HTMLImageElement): DepthMap | null {
  const aspect = image.naturalWidth / image.naturalHeight || 1;
  // Inner (unpadded) working grid: segmentation runs on the bare photo.
  const iw = aspect >= 1 ? DEPTH_RES : Math.max(48, Math.round(DEPTH_RES * aspect));
  const ih = aspect >= 1 ? Math.max(48, Math.round(DEPTH_RES / aspect)) : DEPTH_RES;

  const work = document.createElement("canvas");
  work.width = iw;
  work.height = ih;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  if (!workCtx) return null;
  workCtx.drawImage(image, 0, 0, iw, ih);

  let data: Uint8ClampedArray;
  try {
    data = workCtx.getImageData(0, 0, iw, ih).data;
  } catch {
    return null; // CORS-tainted: caller falls back to a plain <img>.
  }

  const background = estimateBackground(data, iw, ih);
  const luminance = new Float32Array(iw * ih);
  const bgDistance = new Float32Array(iw * ih);
  const alphaChannel = new Float32Array(iw * ih);

  for (let i = 0; i < iw * ih; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    alphaChannel[i] = data[i * 4 + 3] / 255;
    bgDistance[i] = Math.sqrt(
      (r - background.r) ** 2 + (g - background.g) ** 2 + (b - background.b) ** 2
    ) / 255;
    luminance[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  const mask = floodMask(bgDistance, luminance, alphaChannel, iw, ih, background.spread);
  let coverageCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0.5) coverageCount++;
  }

  const coverage = coverageCount / (iw * ih);
  const silhouette = coverage > 0.06 && coverage < 0.88;

  if (!silhouette) {
    fillSlabMask(mask, iw, ih);
  }

  // Puff the mask into a pillow at two scales: the small radius rounds each
  // part (sleeves, collar) individually; the large radius gives the body its
  // overall volume. Mixing both keeps interior shape instead of a flat plateau.
  const puffFine = Float32Array.from(mask);
  const fineRadius = Math.max(1, Math.round(Math.min(iw, ih) / 56));
  for (let pass = 0; pass < 3; pass++) boxBlur(puffFine, iw, ih, fineRadius);
  const puffBroad = Float32Array.from(mask);
  const broadRadius = Math.max(2, Math.round(Math.min(iw, ih) / 22));
  for (let pass = 0; pass < 4; pass++) boxBlur(puffBroad, iw, ih, broadRadius);

  // Folds: band-passed luminance (smoothed minus broad) so fabric shading
  // becomes gentle relief without carving jagged trenches at dark details.
  const smoothLuminance = Float32Array.from(luminance);
  boxBlur(smoothLuminance, iw, ih, 1);
  const lowLuminance = Float32Array.from(luminance);
  boxBlur(lowLuminance, iw, ih, 3);
  boxBlur(lowLuminance, iw, ih, 3);

  const innerDepth = new Float32Array(iw * ih);
  let maxDepth = 0;
  for (let i = 0; i < innerDepth.length; i++) {
    const pillow = 0.45 * Math.pow(puffFine[i], 0.85) + 0.55 * Math.pow(puffBroad[i], 0.75);
    const folds = silhouette
      ? Math.max(-0.045, Math.min(0.045, (smoothLuminance[i] - lowLuminance[i]) * 0.18)) * mask[i]
      : 0;
    innerDepth[i] = Math.max(0, mask[i] * pillow + folds);
  }
  // A final light blur softens vertex steps along the silhouette rim.
  boxBlur(innerDepth, iw, ih, 1);
  for (let i = 0; i < innerDepth.length; i++) {
    if (innerDepth[i] > maxDepth) maxDepth = innerDepth[i];
  }
  if (maxDepth > 0) {
    for (let i = 0; i < innerDepth.length; i++) innerDepth[i] /= maxDepth;
  }

  // Place the inner field into the padded output grid that matches the
  // padded colour texture (margin keeps displacement off the texture edge).
  const inner = 1 - PAD * 2;
  const dw = Math.round(iw / inner);
  const dh = Math.round(ih / inner);
  const ox = Math.round((dw - iw) / 2);
  const oy = Math.round((dh - ih) / 2);
  const depth = new Float32Array(dw * dh);
  const paddedMask = silhouette ? new Float32Array(dw * dh) : null;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      depth[(y + oy) * dw + (x + ox)] = innerDepth[y * iw + x];
      if (paddedMask) paddedMask[(y + oy) * dw + (x + ox)] = mask[y * iw + x];
    }
  }

  // Mask bounding box in padded UV space, used to centre and zoom the object.
  let minX = iw;
  let maxX = 0;
  let minY = ih;
  let maxY = 0;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      if (mask[y * iw + x] > 0.5) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX) {
    minX = 0;
    maxX = iw - 1;
    minY = 0;
    maxY = ih - 1;
  }
  const bounds = {
    cx: (ox + (minX + maxX) / 2) / dw,
    cy: (oy + (minY + maxY) / 2) / dh,
    hw: Math.max(0.04, ((maxX - minX) / 2) / dw),
    hh: Math.max(0.04, ((maxY - minY) / 2) / dh)
  };

  return {
    color: buildColorTexture(image, aspect, paddedMask, dw, dh),
    depth,
    depthWidth: dw,
    depthHeight: dh,
    bounds,
    coverage,
    silhouette
  };
}

/* Background = pixels connected to the image border through flat, low-gradient
   colour. This survives white-on-white studio photography (a global colour
   threshold does not): the soft shadow gradient around the garment acts as a
   barrier the flood cannot cross. */
function floodMask(
  bgDistance: Float32Array,
  luminance: Float32Array,
  alpha: Float32Array,
  w: number,
  h: number,
  spread: number
): Float32Array {
  const gradient = sobel(luminance, w, h);
  const colourTolerance = Math.max(0.03, spread * 1.6);
  const gradientBarrier = 0.042;

  const isBackgroundish = (i: number) =>
    alpha[i] < 0.04 || (bgDistance[i] < colourTolerance && gradient[i] < gradientBarrier);

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!visited[i] && isBackgroundish(i)) {
      visited[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }

  // Morphological close (dilate, then erode) heals ragged edges and small
  // leaks along soft silhouettes, then a light blur gives a soft 1-2px rim.
  const mask = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = visited[i] ? 0 : 1;
  }
  boxBlur(mask, w, h, 2);
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] > 0.18 ? 1 : 0;
  boxBlur(mask, w, h, 2);
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] > 0.82 ? 1 : 0;
  boxBlur(mask, w, h, 1);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = smoothstep(0.25, 0.75, mask[i]);
  }
  return mask;
}

function sobel(values: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        values[i - w + 1] + 2 * values[i + 1] + values[i + w + 1] -
        (values[i - w - 1] + 2 * values[i - 1] + values[i + w - 1]);
      const gy =
        values[i + w - 1] + 2 * values[i + w] + values[i + w + 1] -
        (values[i - w - 1] + 2 * values[i - w] + values[i - w + 1]);
      out[i] = Math.hypot(gx, gy) / 4;
    }
  }
  return out;
}

/** Median border colour plus its spread, so busy backgrounds raise the threshold. */
function estimateBackground(data: Uint8ClampedArray, w: number, h: number) {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const pad = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = pad; x < w - pad; x += 2) {
    sample(x, pad);
    sample(x, h - 1 - pad);
  }
  for (let y = pad; y < h - pad; y += 2) {
    sample(pad, y);
    sample(w - 1 - pad, y);
  }
  const r = median(rs);
  const g = median(gs);
  const b = median(bs);
  let spreadSum = 0;
  for (let i = 0; i < rs.length; i++) {
    spreadSum += Math.sqrt((rs[i] - r) ** 2 + (gs[i] - g) ** 2 + (bs[i] - b) ** 2) / 255;
  }
  return { r, g, b, spread: spreadSum / Math.max(1, rs.length) };
}

/** Rounded-slab fallback so unreadable photos still rotate as a soft card. */
function fillSlabMask(mask: Float32Array, w: number, h: number) {
  const margin = PAD + 0.015;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      const dx = Math.min(u - margin, 1 - margin - u) / 0.1;
      const dy = Math.min(v - margin, 1 - margin - v) / 0.1;
      mask[y * w + x] = clamp01(Math.min(dx, dy) + 0.5) > 0.5 ? 1 : clamp01(Math.min(dx, dy) + 0.5);
    }
  }
}

function buildColorTexture(
  image: HTMLImageElement,
  aspect: number,
  mask: Float32Array | null,
  maskWidth: number,
  maskHeight: number
): HTMLCanvasElement {
  const tw = aspect >= 1 ? TEXTURE_RES : Math.round(TEXTURE_RES * aspect);
  const th = aspect >= 1 ? Math.round(TEXTURE_RES / aspect) : TEXTURE_RES;
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d")!;
  const inner = 1 - PAD * 2;
  // Mild clarity boost so soft studio photography keeps its detail once lit.
  ctx.filter = "contrast(1.12) saturate(1.06)";
  ctx.drawImage(image, tw * PAD, th * PAD, tw * inner, th * inner);
  ctx.filter = "none";

  if (mask) {
    // Bake the (upscaled, slightly dilated) mask into the alpha channel so the
    // shader can cut the silhouette without re-deriving it at texture res.
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext("2d")!;
    const maskImage = maskCtx.createImageData(maskWidth, maskHeight);
    for (let i = 0; i < mask.length; i++) {
      const v = Math.round(clamp01(mask[i] * 1.35) * 255);
      maskImage.data[i * 4] = 255;
      maskImage.data[i * 4 + 1] = 255;
      maskImage.data[i * 4 + 2] = 255;
      maskImage.data[i * 4 + 3] = v;
    }
    maskCtx.putImageData(maskImage, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(maskCanvas, 0, 0, tw, th);
    ctx.globalCompositeOperation = "source-over";
  }

  return canvas;
}

function boxBlur(values: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(values.length);
  const window = radius * 2 + 1;
  // Horizontal.
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) sum += values[row + clampIndex(x, w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / window;
      sum += values[row + clampIndex(x + radius + 1, w)] - values[row + clampIndex(x - radius, w)];
    }
  }
  // Vertical.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clampIndex(y, h) * w + x];
    for (let y = 0; y < h; y++) {
      values[y * w + x] = sum / window;
      sum += tmp[clampIndex(y + radius + 1, h) * w + x] - tmp[clampIndex(y - radius, h) * w + x];
    }
  }
}

function clampIndex(i: number, max: number): number {
  return i < 0 ? 0 : i >= max ? max - 1 : i;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
