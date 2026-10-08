export interface PreparedImage {
  /** base64 JPEG (no data: prefix) — sent to the AI */
  data: string
  mimeType: 'image/jpeg'
  /** same JPEG as a Blob — stored / uploaded */
  blob: Blob
  /** data: URL for an instant preview */
  previewUrl: string
  width: number
  height: number
}

/**
 * Downscale + re-encode a photo picked from the camera or the photo library.
 * A 12–48 MP phone photo (3–15 MB, sometimes HEIC) becomes a ~1280 px JPEG of
 * roughly 150–300 KB: plenty for recognising food and for viewing on a phone,
 * fast to upload, cheap to store. EXIF orientation is applied, and re-encoding
 * also drops the photo's metadata (location etc.) before anything is uploaded.
 */
export async function prepareImage(file: File, maxSide = 1280, quality = 0.8): Promise<PreparedImage> {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h)
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const data = dataUrl.split(',')[1]
  return { data, mimeType: 'image/jpeg', blob: base64ToBlob(data, 'image/jpeg'), previewUrl: dataUrl, width: w, height: h }
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Hebrew message for a photo the browser could not open. */
export function imageErrorMessage(file: File | null): string {
  if (file && /heic|heif/i.test(file.type || file.name))
    return 'הדפדפן הזה לא פותח תמונות HEIC. אפשר לבחור תמונה אחרת, או לצלם ישירות מהאפליקציה.'
  return 'לא הצלחתי לקרוא את התמונה. אפשר לנסות תמונה אחרת או לכתוב מה אכלת.'
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall back to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
