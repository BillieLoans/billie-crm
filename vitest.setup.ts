// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Add testing-library jest-dom matchers
import '@testing-library/jest-dom/vitest'

import { vi } from 'vitest'

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
