/**
 * Guards the lexical ESM-conditions resolution hook (2026-08-28).
 *
 * Without it, importing @payload-config natively evaluates ~75 lexical
 * `*.node.mjs` top-level-await shims and deadlocks Node's async module
 * evaluation ~25-40% of the time — the historical "globalSetup import did not
 * settle" stall. See tests/utils/lexicalEsmConditionsHook.mjs for the full
 * story. The deadlock itself is probabilistic, so these tests assert the fix
 * is INSTALLED rather than trying to reproduce a 1-in-4 race.
 */
import { describe, it, expect } from 'vitest'
import { resolve } from '../../utils/lexicalEsmConditionsHook.mjs'

describe('lexical ESM conditions hook', () => {
  it('is registered in pool workers via vitest.setup.ts', () => {
    // Set by registerLexicalEsmConditions(); if this fails, the call was
    // removed from vitest.setup.ts and the import stall is back for any test
    // that imports @payload-config.
    expect(globalThis.__lexicalEsmConditionsRegistered).toBe(true)
  })

  it('adds the development condition exactly once', () => {
    const seen: string[][] = []
    const next = (specifier: string, context: { conditions?: readonly string[] }) => {
      seen.push([...(context.conditions ?? [])])
      return { url: `file:///${specifier}`, shortCircuit: true }
    }
    resolve('x', { conditions: ['node', 'import'] }, next)
    expect(seen[0]).toEqual(['node', 'import', 'development'])
    resolve('x', { conditions: ['node', 'import', 'development'] }, next)
    expect(seen[1]).toEqual(['node', 'import', 'development'])
  })

  it('tolerates a context with no conditions', () => {
    const next = (_s: string, context: { conditions?: readonly string[] }) => context.conditions
    expect(resolve('x', {}, next)).toEqual(['development'])
  })
})
