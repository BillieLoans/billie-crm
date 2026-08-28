import { register } from 'node:module'

declare global {
  var __lexicalEsmConditionsRegistered: boolean | undefined
}

/**
 * Register the lexical ESM-conditions resolution hook for this process —
 * see tests/utils/lexicalEsmConditionsHook.mjs for why it exists.
 *
 * Called from BOTH globalSetup (the main vitest process, whose import of
 * payload.config is where the stall was always observed) and vitest.setup.ts
 * (each pool worker — integration tests import @payload-config too). Doing it
 * in code rather than via NODE_OPTIONS='--conditions=…' keeps every
 * invocation style safe, including a bare `pnpm exec vitest run <file>`.
 */
export function registerLexicalEsmConditions(): void {
  if (globalThis.__lexicalEsmConditionsRegistered) return
  register('./lexicalEsmConditionsHook.mjs', import.meta.url)
  globalThis.__lexicalEsmConditionsRegistered = true
}
