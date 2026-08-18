import { errorsBuffer } from './buffers'

let installed = false

function record(source: 'window.onerror' | 'unhandledrejection', message: string, stack?: string) {
  try {
    errorsBuffer.push({
      at: new Date().toISOString(),
      source,
      message: String(message ?? 'Unknown error').slice(0, 500),
      stack: stack ? String(stack).slice(0, 2000) : null,
    })
  } catch {
    // Never throw from an error handler
  }
}

/**
 * Install window-level error listeners feeding the errors ring buffer.
 * Idempotent. Listeners are non-capturing and never call preventDefault, so
 * existing error reporting is unaffected.
 */
export function installErrorTracker(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    record('window.onerror', event.message || 'Script error', event.error?.stack)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled rejection'
    record('unhandledrejection', message, reason instanceof Error ? reason.stack : undefined)
  })
}
