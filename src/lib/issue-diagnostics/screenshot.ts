import { NO_TRACK_ATTR } from './constants'

/** Hard ceiling for the uploaded image (S3 presign + Payload payload limits) */
const MAX_BYTES = 3_000_000

/** Cap the long edge so a 4K monitor doesn't produce a 20MP JPEG */
const MAX_WIDTH = 1600

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Capture the current viewport as a JPEG blob.
 *
 * PRIVACY: every `[data-issue-no-track]` subtree is filtered out of the
 * render, so screens can opt sensitive regions out of screenshots.
 *
 * modern-screenshot is imported lazily — it is only pulled into the bundle
 * when a reporter actually asks for a screenshot. Returns null on any
 * failure or if the image cannot be squeezed under the size cap.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null

  try {
    const { domToCanvas } = await import('modern-screenshot')

    const canvas = await domToCanvas(document.body, {
      scale: Math.min(1, MAX_WIDTH / window.innerWidth),
      filter: (node) => {
        if (!(node instanceof Element)) return true
        return !(node.matches?.(`[${NO_TRACK_ATTR}]`) || node.closest?.(`[${NO_TRACK_ATTR}]`))
      },
    })

    let blob = await toBlob(canvas, 0.7)
    if (!blob) return null

    if (blob.size > MAX_BYTES) {
      blob = await toBlob(canvas, 0.5)
      if (!blob) return null
    }

    return blob.size > MAX_BYTES ? null : blob
  } catch {
    // Screenshot is optional — a failure must never block the report
    return null
  }
}
