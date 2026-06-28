/* Loads a product photo into an HTMLImageElement that is safe to draw to a
   canvas (i.e. won't taint it), even when the source is a remote retailer CDN
   that sends no CORS headers.

   In the MV3 side panel the extension has `host_permissions: ["<all_urls>"]`,
   so a privileged `fetch` reads the bytes cross-origin without CORS; wrapping
   them in a same-origin `blob:` URL means the resulting image never taints the
   canvas. We fall back to a direct `crossOrigin="anonymous"` load (works for
   already-same-origin assets, e.g. the bundled preview fixture, and for CDNs
   that do send CORS headers) and finally to no-crossorigin for plain display. */

export type LoadedImage = {
  image: HTMLImageElement;
  /** Releases any object URL created for this image. Always safe to call. */
  cleanup: () => void;
};

export async function loadProductImage(url: string): Promise<LoadedImage> {
  // data:/blob: URLs are already same-origin and never taint.
  if (/^(data|blob):/i.test(url)) {
    const image = await decode(url, null);
    return { image, cleanup: () => {} };
  }

  // Preferred path: read bytes via the extension's privileged fetch, then load
  // them from a same-origin blob URL so the canvas stays clean.
  try {
    const response = await fetch(url);
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 0 && blob.type.startsWith("image/")) {
        const objectUrl = URL.createObjectURL(blob);
        try {
          const image = await decode(objectUrl, null);
          return { image, cleanup: () => URL.revokeObjectURL(objectUrl) };
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          throw error;
        }
      }
    }
  } catch {
    // Fall through to the direct-load attempts below.
  }

  // CORS-enabled direct load (untainted when the host returns CORS headers).
  try {
    const image = await decode(url, "anonymous");
    return { image, cleanup: () => {} };
  } catch {
    // Last resort: plain load. Usable for <img> display, but drawing it to a
    // canvas would taint it, so callers treat a null depth map as "flat".
    const image = await decode(url, null);
    return { image, cleanup: () => {} };
  }
}

function decode(src: string, crossOrigin: "anonymous" | null): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image failed to load: ${src.slice(0, 64)}`));
    image.src = src;
  });
}
