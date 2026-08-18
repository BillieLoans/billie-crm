import type { InteractionEvent } from '@/lib/schemas/issues'
import { interactionsBuffer } from './buffers'
import { describeElement } from './sanitize'

/** Elements worth attributing an interaction to */
const INTERESTING_SELECTOR = 'button, a, [role="button"], input, select, textarea, label'

let installed = false

function handle(type: InteractionEvent['type']) {
  return (event: Event) => {
    try {
      const target = event.target
      if (!(target instanceof Element)) return

      const el = target.closest(INTERESTING_SELECTOR) ?? target
      const described = describeElement(el)
      // null = password field or inside a [data-issue-no-track] subtree
      if (!described) return

      interactionsBuffer.push({
        at: new Date().toISOString(),
        type,
        target: described.target,
        label: described.label,
      })
    } catch {
      // Tracking must never interfere with the app
    }
  }
}

/**
 * Install capture-phase, passive listeners recording recent user
 * interactions as element identity only (see sanitize.describeElement).
 * Idempotent.
 */
export function installInteractionTracker(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  const options: AddEventListenerOptions = { capture: true, passive: true }
  document.addEventListener('click', handle('click'), options)
  document.addEventListener('change', handle('change'), options)
  document.addEventListener('submit', handle('submit'), options)
}
