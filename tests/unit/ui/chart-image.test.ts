/**
 * "Copy chart as image": the SVG is drawn with its computed colours inlined,
 * rendered to a PNG and put on the clipboard, with a plain fallback message
 * when the browser blocks image copies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chartSvgOf,
  copySvgAsPng,
  inlineSvg,
  layoutLegend,
} from '@/components/ReportsView/chart-image'

function drawChart(): SVGSVGElement {
  document.body.innerHTML = `
    <div data-chart-surface style="background-color: rgb(1, 2, 3)">
      <svg class="recharts-surface"><rect style="fill: rgb(10, 20, 30)"></rect></svg>
    </div>`
  const svg = document.querySelector('svg') as SVGSVGElement
  svg.getBoundingClientRect = () => ({ width: 300, height: 150 }) as DOMRect
  return svg
}

let context: Record<string, unknown> & {
  drawImage: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
}

/** jsdom never loads images or paints canvases, so stand both in. */
function stubDrawing(): void {
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  URL.createObjectURL = vi.fn(() => 'blob:chart')
  URL.revokeObjectURL = vi.fn()
  context = {
    fillRect: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 7 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }))
  })
}

describe('chart image', () => {
  beforeEach(() => {
    stubDrawing()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('inlines computed paint and the surface background into a standalone SVG', () => {
    const markup = inlineSvg(drawChart())

    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(markup).toContain('width="300"')
    expect(markup).toContain('fill: rgb(10, 20, 30)')
    expect(markup).toContain('background: rgb(1, 2, 3)')
  })

  it('puts a PNG on the clipboard and names the chart', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    )

    const result = await copySvgAsPng(drawChart(), 'Loans by month')

    expect(result).toEqual({ copied: true, message: 'Chart copied: Loans by month.' })
    const [[items]] = write.mock.calls
    expect(Object.keys(items[0].items)).toEqual(['image/png'])
  })

  it('copies the plot, not a legend icon that comes before it', () => {
    document.body.innerHTML = `
      <div id="plot">
        <ul class="recharts-legend-wrapper"><li><svg class="recharts-surface" id="icon"></svg></li></ul>
        <div class="recharts-wrapper"><svg class="recharts-surface" id="plot-svg"></svg></div>
      </div>`
    expect(chartSvgOf(document.getElementById('plot'))?.id).toBe('plot-svg')

    // Without the wrapper, the largest SVG outside the legend.
    document.body.innerHTML = `
      <div id="plot">
        <div class="recharts-legend-wrapper"><svg class="recharts-surface" id="icon"></svg></div>
        <svg class="recharts-surface" id="small"></svg><svg class="recharts-surface" id="big"></svg>
      </div>`
    const sizes: Record<string, number> = { icon: 400, small: 16, big: 300 }
    document.querySelectorAll('svg').forEach((el) => {
      el.getBoundingClientRect = () => ({ width: sizes[el.id], height: 10 }) as DOMRect
    })
    expect(chartSvgOf(document.getElementById('plot'))?.id).toBe('big')
    expect(chartSvgOf(null)).toBeNull()
  })

  it('wraps the legend onto new rows that fit the width', () => {
    const items = ['Applications', 'Approved', 'Declined', 'Previous period'].map((label) => ({
      label,
      colour: '#000',
    }))
    const { placed, height } = layoutLegend(items, 260, (t) => t.length * 7)
    expect(placed.map((p) => p.y)).toEqual([0, 0, 21, 21])
    expect(placed[0].x).toBe(16)
    expect(height).toBe(42)
    expect(layoutLegend([], 260, () => 0).height).toBe(0)
  })

  it('draws the title above the chart, then the legend and the notes below it', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockResolvedValue(undefined) } })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    )

    await copySvgAsPng(
      drawChart(),
      'Daily applications',
      [
        { label: 'Applications', colour: '#2a78d6' },
        { label: '7-day average', colour: '#2a78d6', opacity: 0.4 },
      ],
      ['Faint line: each day. Solid line: 7-day average.'],
    )

    const texts = context.fillText.mock.calls.map((c) => c[0])
    expect(texts).toEqual([
      'Daily applications',
      'Applications',
      '7-day average',
      'Faint line: each day. Solid line: 7-day average.',
    ])
    const noteY = context.fillText.mock.calls[3][2] as number
    expect(noteY).toBeGreaterThan(context.fillText.mock.calls[1][2] as number)
    const [, , chartTop, width, height] = context.drawImage.mock.calls[0]
    expect([chartTop, width, height]).toEqual([48, 300, 150])
    const legendY = context.fillText.mock.calls[1][2] as number
    expect(legendY).toBeGreaterThan(48 + 150)
  })

  it('says to take a screenshot when the browser blocks image copies', async () => {
    vi.stubGlobal('navigator', { clipboard: {} })

    const result = await copySvgAsPng(drawChart(), 'Loans by month')

    expect(result.copied).toBe(false)
    expect(result.message).toMatch(/blocked in this browser/)
  })
})
