'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCollectionsCase } from '@/hooks/queries/useCollectionsCase'
import { useCustomer } from '@/hooks/queries/useCustomer'
import { useFlagHardship } from '@/hooks/mutations/useFlagHardship'
import { useResumeHardship } from '@/hooks/mutations/useResumeHardship'
import { useApplyStopContact } from '@/hooks/mutations/useApplyStopContact'
import { useAdvanceToNextStep } from '@/hooks/mutations/useAdvanceToNextStep'
import { ContactNotesPanel } from '@/components/ServicingView/ContactNotes'
import type { CollectionsCaseRow } from '@/types/collections'
import { STATE_CONFIG } from './CollectionsView'
import styles from './styles.module.css'

// =============================================================================
// Local types — mirror src/server/collections-service-client.ts. Redeclared
// here (rather than imported) so this client component doesn't pull in that
// module's node-only (`@grpc/grpc-js`, `path`) imports — same pattern as the
// `EconomicsSortItem`/`EconomicsSortResponse` types in CollectionsView.tsx.
// =============================================================================

type GateStatus = 'GATE_UNSPECIFIED' | 'PASS' | 'FAIL' | 'NOT_APPLICABLE'

interface GateResult {
  status: GateStatus
  reason: string
}

interface CostLedgerEntry {
  label: string
  amount: string
  category: 'production' | 'hard'
  recoverable: boolean
}

interface NextStepPreview {
  rung: number
  channel: string
  template: string
  subject: string
  body: string
}

interface CaseEconomics {
  accountId: string
  amountOwed: string
  costOfNextStep: string
  expectedNetRecovery: string
  gateResult: GateResult
  costLedger: CostLedgerEntry[]
  nextStepPreview: NextStepPreview | null
}

interface ContactCapStatus {
  sent7d: number
  cap7d: number
  sentMonth: number
  capMonth: number
}

interface ContactLogEntry {
  sentAt: string | null
  channel: string
  template: string
  outcome: string
}

interface ContactLog {
  accountId: string
  entries: ContactLogEntry[]
  contactCapStatus: ContactCapStatus
}

interface EconomicsResponse {
  economics: CaseEconomics | null
  unavailable?: boolean
}

interface ContactLogResponse {
  contactLog: ContactLog | null
  unavailable?: boolean
}

// =============================================================================
// Fetchers
// =============================================================================

async function fetchEconomics(accountId: string): Promise<EconomicsResponse> {
  const res = await fetch(`/api/collections/cases/${encodeURIComponent(accountId)}/economics`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Economics fetch failed: ${res.status}`)
  }
  return res.json()
}

async function fetchContactLog(accountId: string): Promise<ContactLogResponse> {
  const res = await fetch(`/api/collections/cases/${encodeURIComponent(accountId)}/contact-log`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Contact log fetch failed: ${res.status}`)
  }
  return res.json()
}

// =============================================================================
// Rung ladder (rungs 0–6 per the collections playbook — 0 "Pre-due" through
// the automated reminder cadence (steps 1–5, `overdue_rules.steps` in
// config.*.json, matching the queue's "Step X/5") to 6 "Enforcement", the
// not-yet-built legal-track terminus (Stream D)).
// =============================================================================

const RUNG_LADDER: Array<{ rung: number; label: string }> = [
  { rung: 0, label: 'Pre-due' },
  { rung: 1, label: 'Reminder 1' },
  { rung: 2, label: 'Reminder 2' },
  { rung: 3, label: 'Reminder 3' },
  { rung: 4, label: 'Reminder 4' },
  { rung: 5, label: 'Reminder 5' },
  { rung: 6, label: 'Enforcement' },
]

/** Rung position `awaiting_human` (exhausted, needs a human) is pinned to. */
const AWAITING_HUMAN_RUNG = 3

const LIFECYCLE_FIELDS: Array<{
  key: 'openedAt' | 'pausedAt' | 'resumedAt' | 'stopContactAt' | 'curedAt' | 'exhaustedAt'
  label: string
}> = [
  { key: 'openedAt', label: 'Opened' },
  { key: 'pausedAt', label: 'Paused' },
  { key: 'resumedAt', label: 'Resumed' },
  { key: 'stopContactAt', label: 'Stop-contact applied' },
  { key: 'curedAt', label: 'Cured' },
  { key: 'exhaustedAt', label: 'Exhausted' },
]

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'short', timeStyle: 'short' }).format(d)
}

function RungLadder({ caseRow }: { caseRow: CollectionsCaseRow }) {
  const isCured = caseRow.state === 'cured'
  const isAwaitingHuman = caseRow.state === 'awaiting_human'
  const currentRung = isAwaitingHuman
    ? AWAITING_HUMAN_RUNG
    : Math.max(0, Math.min(6, caseRow.rung ?? 0))

  return (
    <>
      <ol className={styles.rungLadder} aria-label="Collections rung ladder">
        {RUNG_LADDER.map(({ rung, label }) => {
          const isCurrent = !isCured && rung === currentRung
          const isDone = isCured || rung < currentRung
          const classNames = [
            styles.rungStep,
            isDone ? styles.rungStepDone : '',
            isCurrent ? styles.rungStepCurrent : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <li key={rung} className={classNames} data-testid={`rung-step-${rung}`}>
              <span className={styles.rungDot} />
              <span className={styles.rungLabel}>{label}</span>
              {isCurrent && isAwaitingHuman && (
                <span className={styles.rungTag} data-testid="escalation-candidate-tag">
                  Escalation candidate
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {isCured && <span className={styles.rungCuredNote}>Case closed — cured</span>}
    </>
  )
}

// =============================================================================
// Dialogs — minimal inline modals following the repo's existing modal
// conventions (src/components/BlockClear/ClearBlockModal.tsx,
// src/components/LoanAccountServicing/WaiveFeeModal.tsx): overlay + card,
// role="dialog", disabled-while-pending, click-outside/✕ to close.
// =============================================================================

function FlagHardshipDialog({
  onClose,
  onSubmit,
  isLoading,
}: {
  onClose: () => void
  onSubmit: (reason: string) => void
  isLoading: boolean
}) {
  const [reason, setReason] = useState('')

  return (
    <div
      className={styles.modalOverlay}
      onClick={isLoading ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="flag-hardship-title"
      data-testid="flag-hardship-dialog"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="flag-hardship-title" className={styles.modalTitle}>
            Flag hardship
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="hardship-reason">
              Reason *
            </label>
            <textarea
              id="hardship-reason"
              className={styles.formTextarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this case being paused for hardship?"
              disabled={isLoading}
              data-testid="hardship-reason-input"
            />
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnSubmit}
            disabled={isLoading || !reason.trim()}
            onClick={() => onSubmit(reason.trim())}
            data-testid="hardship-submit-button"
          >
            {isLoading ? 'Flagging…' : 'Flag hardship'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StopContactDialog({
  onClose,
  onSubmit,
  isLoading,
}: {
  onClose: () => void
  onSubmit: (reason: string) => void
  isLoading: boolean
}) {
  const [reason, setReason] = useState('')

  return (
    <div
      className={styles.modalOverlay}
      onClick={isLoading ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-contact-title"
      data-testid="stop-contact-dialog"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="stop-contact-title" className={styles.modalTitle}>
            Stop contact
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <p>This halts all further collection contact for this case.</p>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="stop-contact-reason">
              Reason (optional)
            </label>
            <textarea
              id="stop-contact-reason"
              className={styles.formTextarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. dispute, deceased, legal"
              disabled={isLoading}
              data-testid="stop-contact-reason-input"
            />
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnSubmit}
            disabled={isLoading}
            onClick={() => onSubmit(reason.trim())}
            data-testid="stop-contact-submit-button"
          >
            {isLoading ? 'Stopping…' : 'Stop contact'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdvanceConfirmModal({
  preview,
  onClose,
  onConfirm,
  isLoading,
}: {
  preview: NextStepPreview
  onClose: () => void
  onConfirm: () => void
  isLoading: boolean
}) {
  return (
    <div
      className={styles.modalOverlay}
      onClick={isLoading ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="advance-title"
      data-testid="advance-confirm-modal"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="advance-title" className={styles.modalTitle}>
            Advance to next step
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <p>What the customer will experience at rung {preview.rung}:</p>
          <div className={styles.previewCard} data-testid="advance-preview-card">
            <div>
              <strong>Channel:</strong> {preview.channel || '—'}
            </div>
            <div>
              <strong>Template:</strong> {preview.template || '—'}
            </div>
            {preview.subject && (
              <div>
                <strong>Subject:</strong> {preview.subject}
              </div>
            )}
            {preview.body && <div className={styles.previewBody}>{preview.body}</div>}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnSubmit}
            disabled={isLoading}
            onClick={onConfirm}
            data-testid="advance-confirm-button"
          >
            {isLoading ? 'Advancing…' : 'Confirm advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export interface CollectionsCaseViewProps {
  accountId: string
  /** Current user's role — gates the Advance button (mirrors ApprovalsView's
   * `userRole` prop, populated by `CollectionsViewWithTemplate` from the
   * authenticated Payload user, same as `ApprovalsViewWithTemplate`). */
  userRole?: 'admin' | 'supervisor' | 'operations' | 'readonly'
}

/**
 * Dedicated collections case view — three panels (Operational, Accounting +
 * Economics, Contact + Actions) for a single account_id.
 *
 * BTB-197 WS4
 */
export function CollectionsCaseView({ accountId, userRole }: CollectionsCaseViewProps) {
  const { data: caseRow, isLoading: isCaseLoading } = useCollectionsCase(accountId)

  const economicsQuery = useQuery({
    queryKey: ['collections-economics', accountId],
    queryFn: () => fetchEconomics(accountId),
    enabled: !!caseRow,
    refetchInterval: 60_000,
  })

  const contactLogQuery = useQuery({
    queryKey: ['collections-contact-log', accountId],
    queryFn: () => fetchContactLog(accountId),
    enabled: !!caseRow,
    refetchInterval: 30_000,
  })

  const customerId = caseRow?.customerId ?? null
  // Real LoanAccountData[] for ContactNotesPanel (its `selectedAccountId`
  // is matched against `accounts[].loanAccountId`, and note submission
  // resolves to `accounts[].id` — a fabricated single-item array would
  // send the wrong relationship id, so this reuses the same customer fetch
  // ServicingView uses rather than faking the shape).
  const customerQuery = useCustomer(customerId ?? '')

  const accountLabel = caseRow?.accountNumber || accountId
  const { flagHardshipAsync, isLoading: isFlagging } = useFlagHardship(accountLabel)
  const { resumeHardship, isLoading: isResuming } = useResumeHardship(accountLabel)
  const { applyStopContactAsync, isLoading: isStopping } = useApplyStopContact(accountLabel)
  const { advanceToNextStepAsync, isLoading: isAdvancing } = useAdvanceToNextStep(accountLabel)

  const [hardshipDialogOpen, setHardshipDialogOpen] = useState(false)
  const [stopContactDialogOpen, setStopContactDialogOpen] = useState(false)
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false)

  const isSupervisor = userRole === 'admin' || userRole === 'supervisor'

  if (isCaseLoading && !caseRow) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Loading case...</span>
        </div>
      </div>
    )
  }

  if (!caseRow) {
    return (
      <div className={styles.container}>
        <div className={styles.notFound} data-testid="case-not-found">
          <h2 className={styles.emptyTitle}>No collections case for this account</h2>
          <Link href="/admin/collections-queue" className={styles.backLink}>
            ← Back to queue
          </Link>
        </div>
      </div>
    )
  }

  const economics = economicsQuery.data?.economics ?? null
  const economicsUnavailable = !!economicsQuery.data?.unavailable
  const gateStatus = economics?.gateResult?.status
  const economicsPending =
    economicsQuery.isSuccess && (economicsUnavailable || gateStatus === 'NOT_APPLICABLE')
  const preview = economics?.nextStepPreview ?? null

  let advanceDisabledReason: string | null = null
  if (!isSupervisor) {
    advanceDisabledReason = 'Advancing a case requires supervisor approval'
  } else if (caseRow.state === 'cured') {
    advanceDisabledReason = 'Case is cured'
  } else if (caseRow.state === 'awaiting_human') {
    advanceDisabledReason = 'Case is awaiting human escalation — automatic reminders exhausted'
  } else if (economicsQuery.isLoading) {
    advanceDisabledReason = 'Loading economics…'
  } else if (economicsPending) {
    advanceDisabledReason = 'Economics pending'
  } else if (gateStatus === 'FAIL') {
    advanceDisabledReason = economics?.gateResult?.reason || 'Economic gate failed'
  } else if (!preview) {
    advanceDisabledReason = 'No next step available'
  } else if (isAdvancing) {
    advanceDisabledReason = 'Advancing…'
  }

  const stateInfo = STATE_CONFIG[caseRow.state]
  const contactLog = contactLogQuery.data?.contactLog ?? null
  const contactLogUnavailable = !!contactLogQuery.data?.unavailable || (!contactLogQuery.isLoading && !contactLog)

  return (
    <div className={styles.container}>
      <Link href="/admin/collections-queue" className={styles.backLink}>
        ← Back to queue
      </Link>

      <div className={styles.caseHeader}>
        <div className={styles.caseTitleRow}>
          <h1 className={styles.title}>{caseRow.accountNumber || caseRow.accountId}</h1>
          <span className={`${styles.stateBadge} ${stateInfo.className}`}>{stateInfo.label}</span>
        </div>
      </div>

      <div className={styles.panelGrid}>
        {/* Operational panel */}
        <section className={styles.panel} aria-label="Operational">
          <h2 className={styles.panelTitle}>Operational</h2>
          <RungLadder caseRow={caseRow} />
          <ul className={styles.lifecycleList}>
            {LIFECYCLE_FIELDS.filter(({ key }) => caseRow[key]).map(({ key, label }) => (
              <li key={key} className={styles.lifecycleItem}>
                <span className={styles.lifecycleLabel}>{label}</span>
                <span className={styles.lifecycleValue}>{formatDateTime(caseRow[key])}</span>
              </li>
            ))}
          </ul>
          <div className={styles.flagsRow}>
            {caseRow.hardshipPaused && <span className={styles.flagChip}>Hardship</span>}
            {caseRow.stoppedContact && <span className={styles.flagChip}>Stop contact</span>}
            {!caseRow.hardshipPaused && !caseRow.stoppedContact && <span>—</span>}
          </div>
        </section>

        {/* Accounting + economics panel */}
        <section className={styles.panel} aria-label="Accounting and economics">
          <h2 className={styles.panelTitle}>Accounting + Economics</h2>
          {economicsQuery.isLoading ? (
            <div className={styles.pendingPlaceholder}>Loading economics…</div>
          ) : economicsPending ? (
            <div className={styles.pendingPlaceholder} data-testid="economics-pending">
              Economics pending
              {economics?.gateResult?.reason && (
                <span className={styles.gateReason}>{economics.gateResult.reason}</span>
              )}
            </div>
          ) : economics ? (
            <>
              <div className={styles.economicsGrid}>
                <div className={styles.economicsItem}>
                  <span className={styles.economicsLabel}>Amount owed (frozen)</span>
                  <span className={styles.economicsValue}>{economics.amountOwed}</span>
                </div>
                <div className={styles.economicsItem}>
                  <span className={styles.economicsLabel}>Live ledger balance</span>
                  <span className={styles.economicsValue}>{caseRow.aging?.totalOverdue ?? '—'}</span>
                </div>
                <div className={styles.economicsItem}>
                  <span className={styles.economicsLabel}>Cost of next step</span>
                  <span className={styles.economicsValue}>{economics.costOfNextStep}</span>
                </div>
                <div className={styles.economicsItem}>
                  <span className={styles.economicsLabel}>Expected net recovery</span>
                  <span className={styles.economicsValue}>{economics.expectedNetRecovery}</span>
                </div>
              </div>

              <div>
                <span
                  className={`${styles.gateBadge} ${
                    economics.gateResult.status === 'PASS'
                      ? styles.gatePass
                      : economics.gateResult.status === 'FAIL'
                        ? styles.gateFail
                        : ''
                  }`}
                  data-testid="gate-badge"
                >
                  {economics.gateResult.status}
                </span>
                {economics.gateResult.reason && (
                  <span className={styles.gateReason}>{economics.gateResult.reason}</span>
                )}
              </div>

              {economics.costLedger.length > 0 && (
                <table className={styles.table} data-testid="cost-ledger-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Amount</th>
                      <th>Category</th>
                      <th>Recoverable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {economics.costLedger.map((entry, idx) => (
                      <tr key={`${entry.label}-${idx}`}>
                        <td>{entry.label}</td>
                        <td>{entry.amount}</td>
                        <td>{entry.category}</td>
                        <td>{entry.recoverable ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className={styles.pendingPlaceholder}>Economics unavailable</div>
          )}
        </section>

        {/* Contact + actions panel */}
        <section className={styles.panel} aria-label="Contact and actions">
          <h2 className={styles.panelTitle}>Contact + Actions</h2>

          {contactLogQuery.isLoading ? (
            <div className={styles.pendingPlaceholder}>Loading contact log…</div>
          ) : contactLogUnavailable ? (
            <div className={styles.pendingPlaceholder} data-testid="contact-log-unavailable">
              Contact log unavailable
            </div>
          ) : (
            contactLog && (
              <>
                <table className={styles.table} data-testid="contact-log-table">
                  <thead>
                    <tr>
                      <th>Sent</th>
                      <th>Channel</th>
                      <th>Template</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactLog.entries.map((entry, idx) => (
                      <tr key={idx}>
                        <td>{formatDateTime(entry.sentAt)}</td>
                        <td>{entry.channel}</td>
                        <td>{entry.template}</td>
                        <td>{entry.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={styles.capLine} data-testid="contact-cap-line">
                  {contactLog.contactCapStatus.sent7d} of {contactLog.contactCapStatus.cap7d} this week ·{' '}
                  {contactLog.contactCapStatus.sentMonth} of {contactLog.contactCapStatus.capMonth} this month
                </p>
              </>
            )
          )}

          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setHardshipDialogOpen(true)}
              disabled={isFlagging}
              data-testid="flag-hardship-button"
            >
              Flag hardship
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => resumeHardship({ accountId })}
              disabled={isResuming}
              data-testid="resume-button"
            >
              Resume
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setStopContactDialogOpen(true)}
              disabled={isStopping}
              data-testid="stop-contact-button"
            >
              Stop contact
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
              onClick={() => setAdvanceModalOpen(true)}
              disabled={!!advanceDisabledReason}
              title={advanceDisabledReason ?? undefined}
              data-testid="advance-button"
            >
              Advance to next step
            </button>
          </div>

          {customerId && (
            <div className={styles.contactNotesWrapper}>
              <ContactNotesPanel
                customerId={customerId}
                customerName={caseRow.customerName ?? undefined}
                selectedAccountId={accountId}
                accounts={customerQuery.data?.loanAccounts ?? []}
              />
            </div>
          )}
        </section>
      </div>

      {hardshipDialogOpen && (
        <FlagHardshipDialog
          isLoading={isFlagging}
          onClose={() => setHardshipDialogOpen(false)}
          onSubmit={async (reason) => {
            try {
              await flagHardshipAsync({ accountId, reason })
              setHardshipDialogOpen(false)
            } catch {
              // Error is surfaced by the mutation hook's onError toast; keep dialog open.
            }
          }}
        />
      )}

      {stopContactDialogOpen && (
        <StopContactDialog
          isLoading={isStopping}
          onClose={() => setStopContactDialogOpen(false)}
          onSubmit={async (reason) => {
            try {
              await applyStopContactAsync({ accountId, reason: reason || undefined })
              setStopContactDialogOpen(false)
            } catch {
              // Error is surfaced by the mutation hook's onError toast; keep dialog open.
            }
          }}
        />
      )}

      {advanceModalOpen && preview && (
        <AdvanceConfirmModal
          preview={preview}
          isLoading={isAdvancing}
          onClose={() => setAdvanceModalOpen(false)}
          onConfirm={async () => {
            try {
              await advanceToNextStepAsync({ accountId })
              setAdvanceModalOpen(false)
            } catch {
              // Error is surfaced by the mutation hook's onError toast; keep dialog open.
            }
          }}
        />
      )}
    </div>
  )
}

export default CollectionsCaseView
