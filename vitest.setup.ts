// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Add testing-library jest-dom matchers
import '@testing-library/jest-dom/vitest'

import { afterEach, vi } from 'vitest'

// Unmount rendered components after EVERY test. Test files here mostly use
// beforeEach(cleanup), which cleans before each test within a file but leaves
// the file's LAST render mounted — and with the shared single-fork worker
// that DOM leaks into the next file, causing order-dependent "found multiple
// elements" failures. A global afterEach(cleanup) removes the whole class.
// Guarded like scrollIntoView above so node-environment test files can share
// this setup.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
}

// Mock ResizeObserver for tests (not available in JSDOM)
// Required by cmdk and other resize-aware libraries
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock scrollIntoView for tests (not available in JSDOM)
// Required by cmdk for keyboard navigation.
// Guarded so node-environment test files (`// @vitest-environment node`) that
// have no DOM can share this setup without throwing on the missing `Element`.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = function () {}
}

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/period-close',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))
