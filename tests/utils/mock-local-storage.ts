import { afterAll } from 'vitest'

/**
 * Swap `window.localStorage` for a test double for the duration of the calling
 * test file, then hand jsdom's real `Storage` back.
 *
 * Every test file shares one jsdom `window` (`singleFork` + `fileParallelism:
 * false`), so a bare `Object.defineProperty(window, 'localStorage', { value })`
 * leaks into every later file — and leaves the property non-configurable, so
 * whichever file defines it first wins for the rest of the run. Suites that
 * spy on `Storage.prototype` then patch a method nothing calls: the spy never
 * fires and the assertion it guards silently stops testing anything. Same
 * family of order-dependent breakage as the global `afterEach(cleanup)` in
 * vitest.setup.ts.
 *
 * Call at module scope — before importing any module that reads localStorage
 * on import — and the restore registers itself as a file-level `afterAll`.
 */
export function installMockLocalStorage<T extends object>(mock: T): T {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')

  Object.defineProperty(window, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  })

  afterAll(() => {
    if (original) {
      Object.defineProperty(window, 'localStorage', original)
    } else {
      delete (window as unknown as { localStorage?: unknown }).localStorage
    }
  })

  return mock
}
