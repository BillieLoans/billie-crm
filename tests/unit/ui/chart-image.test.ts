/**
 * "Copy chart as image": the SVG is drawn with its computed colours inlined,
 * rendered to a PNG and put on the clipboard, with a plain fallback message
 * when the browser blocks image copies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copySvgAsPng, inlineSvg } from '@/components/ReportsView/chart-image'

function drawChart(): SVGSVGElement {
  document.body.innerHTML = `
    <div data-chart-surface style="background-color: rgb(1, 2, 3)">
      <svg class="recharts-surface"><rect style="fill: rgb(10, 20, 30)"></rect></svg>
    </div>`
  const svg = document.querySelector('svg') as SVGSVGElement
  svg.getBoundingClientRect = () => ({ width: 300, height: 150 }) as DOMRect
  return svg
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D)
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

  it('says to take a screenshot when the browser blocks image copies', async () => {
    vi.stubGlobal('navigator', { clipboard: {} })

    const result = await copySvgAsPng(drawChart(), 'Loans by month')

    expect(result.copied).toBe(false)
    expect(result.message).toMatch(/blocked in this browser/)
  })
})
