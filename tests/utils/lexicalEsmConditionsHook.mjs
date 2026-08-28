/**
 * Node module-resolution hook: adds the `development` (or `production`,
 * mirroring NODE_ENV) export condition when resolving ES modules.
 *
 * Why: the lexical packages' Node ESM entrypoints (`*.node.mjs`, matched by
 * the default `node` condition) each contain a top-level
 * `await import(dev-or-prod)`. Evaluating payload.config's graph natively
 * pulls ~75 of these async modules in one go, and their dynamic imports
 * re-enter the still-evaluating graph — which deadlocks Node's async module
 * evaluation ~25-40% of the time (nodejs/node#55468 is the same class). The
 * import promise then never settles: no error, no pending I/O, just a stall.
 * Reproduced in pure Node 20.18.3 and 22.5.1 with a bare
 * `import('@payloadcms/richtext-lexical')`.
 *
 * With the extra condition, resolution lands directly on `*.dev.mjs` /
 * `*.prod.mjs` — the same files the shim would have loaded — and skips the
 * top-level-await shim entirely, making the deadlock structurally impossible.
 * Packages without a matching condition in their exports map are unaffected.
 *
 * Runs on Node's loader thread via module.register() — keep it plain JS with
 * no imports. Registered by tests/utils/registerLexicalEsmConditions.ts.
 */
const EXTRA_CONDITION = process.env.NODE_ENV === 'production' ? 'production' : 'development'

export function resolve(specifier, context, nextResolve) {
  const conditions = context.conditions ?? []
  if (conditions.includes(EXTRA_CONDITION)) return nextResolve(specifier, context)
  return nextResolve(specifier, { ...context, conditions: [...conditions, EXTRA_CONDITION] })
}
