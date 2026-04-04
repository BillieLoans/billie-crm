---
project_name: 'billie-crm'
user_name: 'Rohan'
date: '2026-04-03'
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - code_quality
  - workflow_rules
  - critical_rules
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

**CRITICAL: Use these exact versions. Do not upgrade without explicit approval.**

| Technology | Version | Notes |
| :--- | :--- | :--- |
| Next.js | 15.3.2 | App Router only, no Pages Router |
| Payload CMS | 3.45.0 | Custom views via `admin.components.views` |
| React | 19.1.0 | React 19 — `use()` hook available, but use TanStack Query instead |
| TypeScript | 5.7.3 | Strict mode enabled |
| MongoDB | 6.17.0 | Via Payload's `@payloadcms/db-mongodb` |
| @grpc/grpc-js | 1.14.1 | For Ledger service communication |
| Vitest | 3.2.3 | Unit + integration tests |
| Playwright | 1.50.0 | E2E tests |
| DOMPurify | latest | HTML sanitization for conversation messages |

**New Dependencies (to be installed):**
- `@tanstack/react-query` v5 — Server state management
- `zustand` v4/v5 — Client-side optimistic state
- `cmdk` v1 — Command palette (Cmd+K)
- `sonner` v1 — Toast notifications
- `zod` v3 — Schema validation
- `nanoid` — Idempotency key generation
- `react-hook-form` + `@hookform/resolvers` — Form handling

---

## Critical Implementation Rules

### Code Style (Prettier)

```
✅ DO: Single quotes → 'use client'
❌ NOT: Double quotes → "use client"

✅ DO: No semicolons → export const X = () => {}
❌ NOT: Semicolons → export const X = () => {};

✅ DO: Trailing commas → { a, b, c, }
✅ DO: Max line width 100 characters
```

### TypeScript Rules

- **Strict mode is ON** — No implicit `any`, null checks required
- **Path aliases:** Use `@/` for imports from `src/` (e.g., `import { X } from '@/lib/utils'`)
- **Unused vars:** Prefix with `_` to ignore (e.g., `_unused`)
- **`any` type:** Allowed but triggers warning — prefer `unknown` or proper types
- **Avoid `as` casts** — Use type guards or Zod parsing instead

### Server vs Client Components

```
Server Components (NO 'use client'):
├── Layout files (layout.tsx)
├── Page files that only fetch and pass props
├── Anything using server-only APIs (headers, cookies)
└── Static content without interactivity

Client Components ('use client' REQUIRED):
├── Anything with useState, useEffect, useRef
├── Anything with onClick, onChange, onSubmit handlers
├── Anything using TanStack Query or Zustand
├── Anything using browser APIs (localStorage, window)
└── All components in /components/ui/ and /components/LoanAccountServicing/
```

### Component Rules

```typescript
// ✅ CORRECT: Named export, 'use client', React.FC pattern
'use client'

import styles from './styles.module.css'

interface BalanceCardProps {
  loanAccountId: string
}

export const BalanceCard: React.FC<BalanceCardProps> = ({ loanAccountId }) => {
  // ...
}

// ❌ WRONG: Default export
export default function BalanceCard() {}

// ❌ WRONG: Missing 'use client' for interactive components
export const BalanceCard = () => { /* uses useState */ }
```

### State Management Rules

**Server State (TanStack Query):**
```typescript
// Query keys must be arrays
const { data } = useQuery({ 
  queryKey: ['balance', accountId],  // ✅ Array format
  queryFn: () => fetchBalance(accountId),
  staleTime: 10_000,  // 10 seconds (project default)
})
```

**Client State (Zustand):**
```typescript
// Use selectors to prevent re-renders
const balance = useOptimisticStore(s => s.getPendingAmount(accountId))  // ✅
const store = useOptimisticStore()  // ❌ Causes re-render on any change
```

### API Route Rules

- **Location:** `src/app/api/ledger/{action}/route.ts`
- **Naming:** kebab-case paths (`/api/ledger/waive-fee`, not `/api/ledger/waiveFee`)
- **Auth:** Wrap with `withAuth(role)` for protected routes
- **Role Hierarchy:** `admin` > `approver` > `support` (check LOWEST required role)
- **Errors:** Return `{ error: { code, message } }` format
- **Health:** Use `withLedgerHealth` wrapper for gRPC routes

```typescript
// ✅ CORRECT API route structure
import { withAuth } from '@/lib/api/with-auth'
import { withLedgerHealth } from '@/lib/api/with-ledger-health'

export const POST = withAuth('support')(
  withLedgerHealth(async (req) => {
    // Handler code
    return Response.json({ data: result })
  })
)
```

### Error Handling Rules

**Always use centralized error messages:**
```typescript
import { ERROR_MESSAGES } from '@/lib/errors/messages'

// ✅ Use the map
toast.error(ERROR_MESSAGES[error.code] || error.message)

// ❌ Don't hardcode strings
toast.error("You don't have permission")
```

**Error codes (exhaustive list):**
- `INSUFFICIENT_PRIVILEGES` — RBAC violation
- `VERSION_CONFLICT` — Stale data modification
- `LEDGER_UNAVAILABLE` — gRPC connection failed
- `VALIDATION_ERROR` — Form/request validation failed
- `ACCOUNT_NOT_FOUND` — Invalid account ID
- `SELF_APPROVAL_FORBIDDEN` — Approving own request

### Optimistic UI Rules

**MutationStage progression:**
```
optimistic → submitted → confirmed | failed
```

**Always generate idempotency keys for write actions:**
```typescript
import { generateIdempotencyKey } from '@/lib/utils/idempotency'

const key = generateIdempotencyKey(user.id, 'waive-fee')
// Format: {userId}-{action}-{timestamp}-{random8chars}
```

### Currency & Date Formatting

```typescript
// ✅ ALWAYS use Australian locale
const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
}).format(amount)

const date = new Date(timestamp).toLocaleString('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
```

---

## Testing Rules

### File Organization

```
tests/
├── unit/**/*.test.ts       # Fast, isolated (Vitest)
├── int/**/*.int.spec.ts    # With mocked APIs (Vitest)
└── e2e/**/*.e2e.spec.ts    # Full browser (Playwright)
```

### Test Execution

**CRITICAL:** Tests run sequentially (not in parallel) to avoid MongoDB race conditions.

```typescript
// vitest.config.mts already configured:
fileParallelism: false
sequence: { concurrent: false }
```

### Test Patterns

```typescript
// ✅ Use renderWithProviders for components with Query/Zustand
import { renderWithProviders } from '@/tests/utils/render-with-providers'

// ✅ Descriptive, behavior-focused test names
test('displays loading skeleton while balance is fetching', async () => {
  renderWithProviders(<BalanceCard accountId="123" />)
  // ...
})

// ❌ Too vague
test('loading state', () => {})

// ✅ Mock gRPC responses using factory
import { mockBalanceResponse } from '@/tests/utils/mocks/grpc-responses'
```

### Async Testing Pattern

```typescript
// ✅ Use findBy* for async elements (waits up to 1s)
const balance = await screen.findByText('$1,200.00')

// ✅ Use getBy* for sync/immediate elements
const button = screen.getByRole('button', { name: 'Waive Fee' })

// ❌ WRONG: getBy doesn't wait!
await screen.getByText('Loading...')  // This won't wait!

// ✅ Use waitFor for complex async assertions
await waitFor(() => {
  expect(screen.getByText('Fee waived')).toBeInTheDocument()
})
```

---

## Payload CMS Rules

### When to Use What

```
Use Payload Admin UI (default views) for:
├── CRUD operations on collections (Customers, LoanAccounts, Users)
├── Media uploads
├── User/role management
└── Any standard CMS operations

Use Custom Views (admin.components.views) for:
├── ServicingView — Single Customer View with real-time data
├── ApprovalsView — Approval queue with write actions
├── Any view requiring Optimistic UI or gRPC operations
└── Any view with complex financial workflows
```

### Custom Views

**ONLY use `admin.components.views` for custom pages:**
```typescript
// payload.config.ts
export default buildConfig({
  admin: {
    components: {
      views: {
        ServicingView: {
          Component: '@/components/views/ServicingView',
          path: '/servicing/:customerId',
        },
      },
    },
  },
})
```

### Collections

- **Files:** PascalCase (`LoanAccounts.ts`)
- **Slugs:** kebab-case (`loan-accounts`)
- **Fields:** camelCase (`loanAccountId`)
- **DO NOT** create new collections without explicit approval — this is a brownfield project

---

## Critical Don't-Miss Rules

### ❌ NEVER DO

1. **Never use default exports** for components
2. **Never use semicolons** (Prettier will remove them)
3. **Never use double quotes** for strings (use single quotes)
4. **Never use `any`** without a warning suppression comment
5. **Never bypass RBAC** — always use `withAuth()` wrapper
6. **Never hardcode error messages** — use `ERROR_MESSAGES` map
7. **Never fetch in useEffect** — use TanStack Query hooks
8. **Never mutate Zustand state directly** — use selectors
9. **Never approve your own requests** — self-approval check required
10. **Never skip idempotency keys** for write operations

### 🔒 PII & SECURITY RULES

```
⚠️ SENSITIVE DATA HANDLING:
├── NEVER log customer PII (name, email, phone, address)
├── NEVER include PII in error messages sent to client
├── NEVER expose raw identifiers in URLs (use customer ID only)
├── NEVER store card numbers or CVV (PCI-DSS scope reduction)
└── ALWAYS use audit logging for financial operations
```

### 📁 IMPORT BOUNDARY RULES

```
✅ ALLOWED IMPORTS:
components/ → hooks/, stores/, lib/, types/
hooks/      → stores/, lib/, types/
stores/     → lib/, types/
lib/        → types/ only

❌ FORBIDDEN IMPORTS:
lib/        → components/, hooks/, stores/  (keeps lib pure)
stores/     → components/, hooks/           (no circular deps)
types/      → anything except other types/  (types are leaf nodes)
```

### ⚠️ WATCH OUT FOR

1. **Read-Only Mode:** Check `readOnlyMode` before enabling write buttons
2. **Stale Data:** Handle `VERSION_CONFLICT` by prompting refresh
3. **Optimistic Rollback:** Always implement failure compensation
4. **gRPC Timestamps:** Convert `{ seconds, nanos }` to JS Date at API boundary
5. **Payload Auth:** Use `getPayloadUser(req)` not custom session handling

### 🏗️ ARCHITECTURE CONSTRAINTS

1. **CQRS:** Read hooks (`useBalance`) vs Mutation hooks (`useWaiveFee`) — never mix
2. **Brownfield:** Respect existing Payload collections — don't create new ones without approval
3. **gRPC Boundary:** All ledger communication goes through `/api/ledger/*` routes, never direct from client
4. **Event Sourcing:** Local MongoDB is a projection — Ledger is source of truth

---

## Conversations/Applications Feature Rules

### HTML Sanitization (CRITICAL)

```typescript
// ALL conversation message HTML MUST go through SanitizedHTML
import { SanitizedHTML } from '@/components/views/ConversationDetailView'

// ✅ CORRECT
<SanitizedHTML content={message.html} />

// ❌ NEVER use dangerouslySetInnerHTML directly for conversation content
<div dangerouslySetInnerHTML={{ __html: message.html }} />
```

### S3 Assessment Data

```
✅ DO: Fetch S3 data server-side in API routes, return parsed JSON to client
❌ NOT: Return S3 pre-signed URLs or bucket keys to the client
❌ NOT: Fetch S3 directly from browser

✅ DO: Cache with staleTime: Infinity (assessment data is immutable)
❌ NOT: Add server-side caching for assessments (unnecessary complexity)
```

### Polling Strategy

```
View-specific intervals — do NOT use a single global interval:
  - Monitoring grid (useConversations):      5s poll, 5s stale
  - Conversation detail (useConversation):   3s poll, 3s stale
  - ServicingView panel (useCustomerConversations): 30s poll, 30s stale
  - Assessment detail (useAssessment):       no poll, staleTime: Infinity

ALL polling hooks MUST set refetchIntervalInBackground: false
```

### Conversation Status Values (canonical)

```
MongoDB stores lowercase snake_case — map to display labels client-side only:
  active    → Active (green, pulsing)
  paused    → Paused (amber)
  soft_end  → Soft End (blue)
  hard_end  → Hard End (grey)
  approved  → Approved (green)
  declined  → Declined (red)
  ended     → Ended (grey)

Use STATUS_CONFIG constant for mapping — do NOT hardcode badge colours
```

### Conversations Collection — READ ONLY from Web Layer

```
⚠️ The conversations collection follows the same CQRS rule as accounts/customers:
  - Event Processor (Python) is the SOLE WRITER
  - Payload/Next.js is READ ONLY
  - Do NOT add Payload hooks or API routes that mutate conversations
```

### Conversations API Routes

```
Conversations routes live under /api/conversations/ (NOT /api/ledger/):
  - These routes read from MongoDB, not gRPC
  - Use withAuth() but NOT withLedgerHealth (no ledger dependency)
  - Assessment routes additionally require rate limiting (30 req/min/user)
```

### Event Processor — New Handler Pattern

```python
# All conversation handlers MUST:
# 1. Extract conversation_id with 3-field fallback
conversation_id = safe_str(
    event.get("cid") or event.get("conv") or event.get("conversation_id"),
    "conversation_id"
)
# 2. Use upsert=True (events may arrive out of order)
# 3. Use safe_str() from sanitize.py for all string extraction
# 4. Bind structured logger with conversation_id
```

---

## Quick Reference

### Import Patterns

```typescript
// Components
import { BalanceCard } from '@/components/LoanAccountServicing'
import { CommandBar, OptimisticToast } from '@/components/ui'

// Hooks
import { useBalance, useCustomer } from '@/hooks/queries'
import { useWaiveFee } from '@/hooks/mutations'

// Stores
import { useOptimisticStore, useUIStore } from '@/stores'

// Utilities
import { ERROR_MESSAGES } from '@/lib/errors/messages'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
```

### File Naming

| Type | Pattern | Example |
| :--- | :--- | :--- |
| Component | PascalCase.tsx | `BalanceCard.tsx` |
| Hook | camelCase.ts | `useBalance.ts` |
| Store | camelCase.ts | `optimistic.ts` |
| API Route | kebab-case/route.ts | `waive-fee/route.ts` |
| Test | {name}.test.ts | `BalanceCard.test.tsx` |
| Style | styles.module.css | `styles.module.css` |

---

_Last updated: 2026-04-03 | Refer to `docs/architecture.md` for core architecture and `_bmad-output/planning-artifacts/architecture.md` for conversations/applications architecture._
