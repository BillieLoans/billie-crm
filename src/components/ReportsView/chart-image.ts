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

/** One legend entry, drawn under the chart in the copied image. */
export interface LegendItem {
  label: string
  /** A resolved colour, not a CSS variable: the canvas cannot read those. */
  colour: string
  opacity?: number
  dashed?: boolean
}

/**
 * The chart's own SVG. Recharts draws each legend icon as a small
 * `svg.recharts-surface` too, so the first match can be an icon: take the
 * plot's SVG, else the largest one outside the legend.
 */
export function chartSvgOf(container: Element | null | undefined): SVGSVGElement | null {
  if (!container) return null
  const direct = container.querySelector('.recharts-wrapper > svg.recharts-surface')
  if (direct) return direct as SVGSVGElement
  const area = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width * r.height
  }
  const candidates = [...container.querySelectorAll('svg.recharts-surface')].filter(
    (el) => !el.closest('.recharts-legend-wrapper'),
  )
  candidates.sort((a, b) => area(b) - area(a))
  return (candidates[0] as SVGSVGElement | undefined) ?? null
}

/** The height Recharts keeps at the foot of the SVG for its HTML legend. */
function legendBandOf(svg: SVGSVGElement): number {
  const legend = svg.parentElement?.querySelector('.recharts-legend-wrapper')
  return legend ? legend.getBoundingClientRect().height : 0
}

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

const SCALE = 2
const PAD = 16
const TITLE_SIZE = 16
const LEGEND_SIZE = 13
const NOTE_SIZE = 12
const SWATCH = 16
const ITEM_GAP = 20

interface Placed {
  item: LegendItem
  x: number
  y: number
}

/** Lay the legend out in rows that fit the chart's width. */
export function layoutLegend(
  items: readonly LegendItem[],
  width: number,
  measure: (text: string) => number,
): { placed: Placed[]; height: number } {
  const lineHeight = LEGEND_SIZE + 8
  const placed: Placed[] = []
  let x = PAD
  let y = 0
  for (const item of items) {
    const w = SWATCH + 6 + measure(item.label)
    if (x > PAD && x + w > width - PAD) {
      x = PAD
      y += lineHeight
    }
    placed.push({ item, x, y })
    x += w + ITEM_GAP
  }
  return { placed, height: items.length ? y + lineHeight : 0 }
}

/**
 * Draw the chart to a PNG, with its title above and its legend and notes
 * below (both are HTML, not part of the SVG), and put it on the clipboard.
 */
export async function copySvgAsPng(
  svg: SVGSVGElement,
  title: string,
  legend: readonly LegendItem[] = [],
  notes: readonly string[] = [],
): Promise<{ copied: boolean; message: string }> {
  try {
    const markup = inlineSvg(svg)
    const rect = svg.getBoundingClientRect()
    const width = Math.round(rect.width)
    const surface = window.getComputedStyle(surfaceOf(svg))
    const background = surface.backgroundColor || '#fff'
    const text = surface.getPropertyValue('--chart-text-strong').trim() || '#111'
    const muted = surface.getPropertyValue('--chart-text').trim() || '#555'
    const font = surface.fontFamily || 'sans-serif'

    const image = new Image()
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The chart could not be drawn'))
      image.src = url
    })

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas')
    context.font = `${LEGEND_SIZE}px ${font}`
    const { placed, height: legendHeight } = layoutLegend(
      legend,
      width,
      (label) => context.measureText(label).width,
    )
    // Recharts leaves a band at the foot of the SVG for its HTML legend; the
    // copied legend goes in that band rather than below an empty strip.
    const reserved = legendHeight ? legendBandOf(svg) : 0
    const titleHeight = TITLE_SIZE + PAD
    const chartTop = PAD + titleHeight
    const legendTop = chartTop + rect.height - reserved + (legendHeight ? PAD / 2 : 0)
    const notesTop = Math.max(chartTop + rect.height, legendTop + legendHeight) + PAD / 2
    const noteLine = NOTE_SIZE + 6
    const height = Math.round(notesTop + notes.length * noteLine + PAD)

    canvas.width = width * SCALE
    canvas.height = height * SCALE
    context.scale(SCALE, SCALE)
    context.fillStyle = background
    context.fillRect(0, 0, width, height)

    context.fillStyle = text
    context.textBaseline = 'top'
    context.font = `600 ${TITLE_SIZE}px ${font}`
    context.fillText(title, PAD, PAD, width - PAD * 2)

    context.drawImage(image, 0, chartTop, rect.width, rect.height)
    URL.revokeObjectURL(url)

    context.font = `${LEGEND_SIZE}px ${font}`
    context.textBaseline = 'middle'
    for (const { item, x, y } of placed) {
      const mid = legendTop + y + LEGEND_SIZE / 2 + 2
      context.globalAlpha = item.opacity ?? 1
      context.strokeStyle = item.colour
      context.lineWidth = 3
      context.setLineDash(item.dashed ? [5, 4] : [])
      context.beginPath()
      context.moveTo(x, mid)
      context.lineTo(x + SWATCH, mid)
      context.stroke()
      context.globalAlpha = 1
      context.setLineDash([])
      context.fillStyle = text
      context.fillText(item.label, x + SWATCH + 6, mid)
    }

    context.font = `${NOTE_SIZE}px ${font}`
    context.textBaseline = 'top'
    context.fillStyle = muted
    notes.forEach((note, i) => {
      context.fillText(note, PAD, notesTop + i * noteLine, width - PAD * 2)
    })

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
