/**
 * Copy a drawn chart to the clipboard as a PNG, for pasting into Slack, a
 * deck or an email. The chart's colours are CSS variables, which mean
 * nothing outside the page, so each element's computed colours are written
 * onto a copy of the SVG before it is drawn to a canvas.
 */

const PAINT_PROPERTIES = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'font-size',
  'font-family',
  'font-weight',
] as const

/** The element that paints the chart's background. */
function surfaceOf(svg: SVGSVGElement): Element {
  return svg.closest('[data-chart-surface]') ?? svg
}

/** A standalone copy of the SVG with computed paint inlined. */
export function inlineSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const source = svg.querySelectorAll('*')
  const target = copy.querySelectorAll('*')
  source.forEach((el, i) => {
    const computed = window.getComputedStyle(el)
    const out = target[i] as SVGElement
    for (const prop of PAINT_PROPERTIES) {
      const value = computed.getPropertyValue(prop)
      if (value) out.style.setProperty(prop, value)
    }
  })
  const rect = svg.getBoundingClientRect()
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('width', String(Math.round(rect.width)))
  copy.setAttribute('height', String(Math.round(rect.height)))
  const background = window.getComputedStyle(surfaceOf(svg)).backgroundColor
  copy.style.setProperty('background', background || '#ffffff')
  return new XMLSerializer().serializeToString(copy)
}

/** Draw the chart to a PNG and put it on the clipboard. */
export async function copySvgAsPng(
  svg: SVGSVGElement,
  title: string,
): Promise<{ copied: boolean; message: string }> {
  try {
    const markup = inlineSvg(svg)
    const rect = svg.getBoundingClientRect()
    const scale = 2
    const image = new Image()
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The chart could not be drawn'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(rect.width * scale)
    canvas.height = Math.round(rect.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas')
    context.fillStyle = window.getComputedStyle(surfaceOf(svg)).backgroundColor || '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(scale, scale)
    context.drawImage(image, 0, 0)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      return {
        copied: false,
        message: 'Copying images is blocked in this browser. Take a screenshot instead.',
      }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return { copied: true, message: `Chart copied: ${title}.` }
  } catch {
    return { copied: false, message: 'The chart could not be copied. Take a screenshot instead.' }
  }
}
