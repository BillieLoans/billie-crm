/**
 * A report's headline: up to four numbers above the chart, each with its
 * change on the previous period, and one or two plain sentences that say
 * what the numbers mean. Built in code from the result, so nothing about
 * the results goes to Claude. Pure functions only.
 */
import type { HeadlineSpec, ReportColumn } from '@/lib/schemas/reports'
import {
  computeChange,
  formatValue,
  isGapLabel,
  isSmallSample,
  labelColumn,
  splitRows,
  toNumber,
  type Change,
  type ColumnView,
} from './columns'

type Row = Record<string, unknown>

export interface HeadlineTile {
  label: string
  column: string
  value: number | null
  text: string
  change: Change | null
  /** The value on the previous period, formatted, when comparing. */
  previousText?: string
}

const isCountLike = (view: ColumnView) =>
  view.format === 'integer' || view.format === 'number' || view.format === 'currency'

function values(rows: readonly Row[], column: string): number[] {
  return rows.map((r) => toNumber(r[column])).filter((v): v is number => v !== null)
}

/** One headline number from a result. Null when the result cannot give it. */
export function headlineValue(
  spec: HeadlineSpec,
  view: ColumnView | undefined,
  columns: readonly ReportColumn[],
  rows: readonly Row[],
): number | null {
  const { body, totals } = splitRows(columns, rows)
  const column = spec.column
  const list = values(body, column)
  switch (spec.value ?? 'total') {
    case 'total': {
      if (totals.length > 0) return toNumber(totals[0][column])
      // No total row: a count adds up; anything else has no honest total.
      return view && isCountLike(view) && list.length ? list.reduce((a, b) => a + b, 0) : null
    }
    case 'sum':
      return list.length ? list.reduce((a, b) => a + b, 0) : null
    case 'average':
      return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null
    case 'max':
      return list.length ? Math.max(...list) : null
    case 'min':
      return list.length ? Math.min(...list) : null
    case 'first':
      return list.length ? list[0] : null
    case 'last':
      return list.length ? list[list.length - 1] : null
    case 'ratio': {
      const source = totals.length > 0 ? totals : body
      const num = values(source, spec.numerator as string).reduce((a, b) => a + b, 0)
      const den = values(source, spec.denominator as string).reduce((a, b) => a + b, 0)
      if (den === 0) return null
      const fraction = num / den
      return view?.format === 'percent100' ? fraction * 100 : fraction
    }
  }
}

/** The headline tiles for a result, with changes when the previous period is given. */
export function computeHeadline(
  specs: readonly HeadlineSpec[],
  views: readonly ColumnView[],
  columns: readonly ReportColumn[],
  rows: readonly Row[],
  previousRows?: readonly Row[] | null,
): HeadlineTile[] {
  const names = new Set(columns.map((c) => c.name))
  return specs
    .filter((spec) => names.has(spec.column))
    .map((spec) => {
      const view = views.find((v) => v.name === spec.column)
      const format = spec.value === 'ratio' && !view ? 'percent' : (view?.format ?? 'number')
      const value = headlineValue(spec, view, columns, rows)
      const previous = previousRows ? headlineValue(spec, view, columns, previousRows) : null
      const better = spec.better ?? view?.better
      return {
        label: spec.label ?? view?.label ?? spec.column,
        column: spec.column,
        value,
        text: value === null ? '–' : formatValue(value, format),
        change:
          previousRows && value !== null && previous !== null
            ? computeChange(value, previous, format, better)
            : null,
        previousText: previousRows && previous !== null ? formatValue(previous, format) : undefined,
      }
    })
}

export interface NarrativeOptions {
  /** "the previous 30 days": how the comparison is described. */
  previousLabel?: string
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * One or two sentences that read the headline aloud: the first number and
 * its change, then the others, then, for a rate split by a category, which
 * categories were highest and lowest. Categories on small samples are left
 * out of that comparison and the sentence says so.
 */
export function buildNarrative(
  tiles: readonly HeadlineTile[],
  views: readonly ColumnView[],
  columns: readonly ReportColumn[],
  rows: readonly Row[],
  options: NarrativeOptions = {},
): string {
  const shown = tiles.filter((t) => t.value !== null)
  if (shown.length === 0) return ''
  const against = options.previousLabel ?? 'the previous period'
  const sentences: string[] = []
  const [lead, ...rest] = shown
  sentences.push(
    `${lead.label} was ${lead.text}${
      lead.change && lead.change.direction !== 'flat'
        ? `, ${lead.change.text} on ${against}`
        : lead.change
          ? `, the same as ${against}`
          : ''
    }.`,
  )
  if (rest.length) {
    sentences.push(
      rest
        .map(
          (t) =>
            `${t.label} ${t.text}${t.change && t.change.direction !== 'flat' ? ` (${t.change.text})` : ''}`,
        )
        .join('; ') + '.',
    )
  }

  // Highest and lowest category on the lead number, when it is a rate split
  // by a label column.
  const label = labelColumn(columns)
  const view = views.find((v) => v.name === lead.column)
  if (label && view && (view.format === 'percent' || view.format === 'percent100')) {
    const { body } = splitRows(columns, rows)
    const real = body.filter((r) => !isGapLabel(r[label]) && toNumber(r[view.name]) !== null)
    const solid = real.filter((r) => !isSmallSample(r, view))
    if (solid.length >= 2) {
      const sorted = [...solid].sort(
        (a, b) => (toNumber(b[view.name]) as number) - (toNumber(a[view.name]) as number),
      )
      const top = sorted[0]
      const bottom = sorted[sorted.length - 1]
      const omitted = real.length - solid.length
      sentences.push(
        `${upperFirst(String(top[label]))} was highest at ${formatValue(top[view.name], view.format)} and ${String(
          bottom[label],
        )} lowest at ${formatValue(bottom[view.name], view.format)}${
          omitted > 0
            ? `, leaving out ${omitted} ${omitted === 1 ? 'group' : 'groups'} with fewer than ${view.minBase} ${lowerFirst(
                views.find((v) => v.name === view.base)?.label ?? 'cases',
              )}`
            : ''
        }.`,
      )
    }
  }
  return sentences.join(' ')
}
