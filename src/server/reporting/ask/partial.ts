/**
 * Reads what Claude has written so far of a definition (an unfinished JSON
 * object) for the parts worth showing early: the title, the plan and the
 * assumptions, and whether it has reached the SQL. Only complete strings
 * are taken, so nothing half-written is shown.
 */

export interface PartialDraft {
  title?: string
  plan: string[]
  assumptions: string[]
  /** Claude has started writing the SQL. */
  writingSql: boolean
}

const STRING = '"(?:[^"\\\\]|\\\\.)*"'

function readString(literal: string): string | undefined {
  try {
    const value = JSON.parse(literal) as unknown
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** The complete strings in the array that starts after `"key": [`. */
function readStringArray(text: string, key: string): string[] {
  const start = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text)
  if (!start) return []
  const rest = text.slice(start.index + start[0].length)
  const out: string[] = []
  const item = new RegExp(`^\\s*(${STRING})\\s*(,|\\])?`)
  let remaining = rest
  for (;;) {
    const match = item.exec(remaining)
    if (!match) break
    const value = readString(match[1])
    if (value !== undefined) out.push(value)
    if (match[2] !== ',') break
    remaining = remaining.slice(match[0].length)
  }
  return out
}

export function readPartialDraft(text: string): PartialDraft {
  const title = new RegExp(`"title"\\s*:\\s*(${STRING})`).exec(text)
  return {
    title: title ? readString(title[1]) : undefined,
    plan: readStringArray(text, 'plan'),
    assumptions: readStringArray(text, 'assumptions'),
    writingSql: /"sql"\s*:/.test(text),
  }
}
