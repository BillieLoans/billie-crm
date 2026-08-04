'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { useGateStatus, useReleases, useSetGateMode } from '@/hooks'
import type { GateStatus } from '@/hooks'
import { isAdmin } from '@/lib/access'
import { formatDateShort } from '@/lib/formatters'
import { MarketingSubnav } from './MarketingSubnav'
import { Modal } from './Modal'
import { NewReleaseModal } from './NewReleaseModal'
import styles from './styles.module.css'

const TYPE_LABELS: Record<string, string> = {
  waitlist: 'Waitlist next-N',
  phone_list: 'Phone list',
  open_quota: 'Open quota',
}

type GateMode = GateStatus['mode']

const GATE_MODE_LABELS: Record<GateMode, string> = {
  open: 'Open',
  gated: 'Gated',
  closed: 'Closed',
}

const GATE_MODE_CONSEQUENCE: Record<'open' | 'gated', string> = {
  open: 'Open: gate off, everyone can apply.',
  gated: 'Gated: only released applicants can start applications.',
}

const GATE_CLOSE_CONSEQUENCE =
  'Blocks ALL new applications — customers, grants and walk-ups — until reopened.'

const CLOSE_CONFIRM_PHRASE = 'CLOSE'

function gateModeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to change gate mode'
}

/**
 * Admin-only gate-mode controls (spec §6 "Gate control") — a second command
 * surface alongside the ops CLI break-glass path (which remains the
 * break-glass path if the CRM is unreachable). Non-admins see only the mode
 * banners below, no buttons. This slot always renders for admins regardless
 * of the current mode — fixed layout, so the controls don't jump around as
 * the gate flips.
 */
const GateControl: React.FC<{ gate: GateStatus | undefined }> = ({ gate }) => {
  const { user } = useAuth()
  const [confirmMode, setConfirmMode] = useState<GateMode | null>(null)
  const [pendingMode, setPendingMode] = useState<GateMode | null>(null)
  const setGateMode = useSetGateMode()

  const currentMode: GateMode = gate?.mode ?? 'open'
  // Derived, not effect-driven: once useGateStatus (polled + lag-invalidated)
  // reflects the mode we asked for, the "applying…" hint disappears on its
  // own — no need to imperatively clear pendingMode.
  const applyingMode = pendingMode && pendingMode !== currentMode ? pendingMode : null

  if (!isAdmin(user)) return null

  const openConfirm = (mode: GateMode) => {
    setPendingMode(null)
    setConfirmMode(mode)
  }

  const handleConfirm = () => {
    if (!confirmMode) return
    const requested = confirmMode
    setGateMode.mutate(
      { mode: requested },
      {
        onSuccess: () => {
          setPendingMode(requested)
          setConfirmMode(null)
        },
      },
    )
  }

  return (
    <div className={styles.gateControl} data-testid="gate-control">
      <span className={styles.gateControlLabel}>
        Gate mode: <strong>{GATE_MODE_LABELS[currentMode]}</strong>
        {applyingMode && (
          <span className={styles.formHint}> — applying {GATE_MODE_LABELS[applyingMode]}…</span>
        )}
      </span>
      <div className={styles.gateControlActions}>
        {(['open', 'gated', 'closed'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            data-testid={`gate-btn-${mode}`}
            className={mode === 'closed' ? styles.btnDanger : styles.btnCancel}
            onClick={() => openConfirm(mode)}
            disabled={setGateMode.isPending || currentMode === mode}
          >
            Set {GATE_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {(confirmMode === 'open' || confirmMode === 'gated') && (
        <Modal
          title={`Set gate to ${GATE_MODE_LABELS[confirmMode]}`}
          onClose={() => setConfirmMode(null)}
        >
          <div className={styles.modalBody}>
            {setGateMode.isError && (
              <div className={styles.errorMessage}>{gateModeErrorMessage(setGateMode.error)}</div>
            )}
            <p>{GATE_MODE_CONSEQUENCE[confirmMode]}</p>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={() => setConfirmMode(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnSubmit}
              disabled={setGateMode.isPending}
              onClick={handleConfirm}
            >
              {setGateMode.isPending
                ? 'Applying…'
                : `Confirm — set ${GATE_MODE_LABELS[confirmMode]}`}
            </button>
          </div>
        </Modal>
      )}

      {confirmMode === 'closed' && (
        <CloseGateConfirmModal
          isPending={setGateMode.isPending}
          errorMessage={setGateMode.isError ? gateModeErrorMessage(setGateMode.error) : null}
          onCancel={() => setConfirmMode(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}

interface CloseGateConfirmModalProps {
  isPending: boolean
  errorMessage: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Typed-confirmation dialog for the CLOSED kill switch (ux-standards
 * irreversible-action pattern, mirroring EraseContactModal / the release
 * RevokeReleaseModal): typing CLOSE exactly is required to enable the
 * button, since closing the gate blocks every new applicant instantly.
 */
const CloseGateConfirmModal: React.FC<CloseGateConfirmModalProps> = ({
  isPending,
  errorMessage,
  onCancel,
  onConfirm,
}) => {
  const [confirmation, setConfirmation] = useState('')
  const canSubmit = confirmation.trim() === CLOSE_CONFIRM_PHRASE && !isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm()
  }

  return (
    <Modal title="Close the gate — kill switch" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
          <div className={styles.errorMessage}>{GATE_CLOSE_CONSEQUENCE}</div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="gate-close-confirmation">
              Type <strong>{CLOSE_CONFIRM_PHRASE}</strong> to confirm
            </label>
            <input
              id="gate-close-confirmation"
              autoFocus
              type="text"
              className={styles.formInput}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={CLOSE_CONFIRM_PHRASE}
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.btnDanger}
            disabled={!canSubmit}
            title={!canSubmit ? `Type "${CLOSE_CONFIRM_PHRASE}" exactly to enable` : undefined}
          >
            {isPending ? 'Closing…' : 'Close the gate'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Releases list — every batch of applicants released past the billieChat
 * gate, with capacity at a glance. The gate-off banner is a loud reminder
 * that release volumes are decorative while the gate is open (anyone can
 * apply regardless of what's been "released").
 */
export const ReleasesView: React.FC = () => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const { data, isLoading, isError } = useReleases({ page })
  const { data: gate } = useGateStatus()
  const docs = data?.docs ?? []

  const active = docs.filter((d) => d.derivedStatus === 'active')
  const unclaimedGrants = active
    .filter((d) => d.type !== 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.grantedCount ?? 0) - (d.claimedCount ?? 0), 0), 0)
  const quotaSlots = active
    .filter((d) => d.type === 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.quotaCount ?? 0) - (d.claimedCount ?? 0), 0), 0)

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <GateControl gate={gate} />

      {gate?.mode === 'open' && (
        <div className={styles.warningMessage} role="status">
          Application gate is OFF — releases are not being enforced. Turn it on with the gate CLI
          before relying on release volumes.
        </div>
      )}
      {gate?.mode === 'closed' && (
        <div className={styles.errorMessage} role="alert">
          Kill switch ON — all new applications are blocked. Releases and grants are not being
          honoured while this is on.
        </div>
      )}
      <div className={styles.statsStrip}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{unclaimedGrants.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Unclaimed grants</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{quotaSlots.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Open quota slots</span>
        </div>
        <button type="button" className={styles.btnSubmit} onClick={() => setShowNew(true)}>
          + New release
        </button>
      </div>
      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load releases. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Released</th>
                  <th>Granted</th>
                  <th>Claimed</th>
                  <th>Remaining</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      Loading releases…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      No releases yet.
                    </td>
                  </tr>
                ) : (
                  docs.map((r) => {
                    const isQuota = r.type === 'open_quota'
                    const remaining = isQuota
                      ? `${Math.max((r.quotaCount ?? 0) - (r.claimedCount ?? 0), 0)} / ${r.quotaCount ?? 0}`
                      : String(Math.max((r.grantedCount ?? 0) - (r.claimedCount ?? 0), 0))
                    return (
                      <tr
                        key={r.id}
                        className={styles.row}
                        onClick={() => router.push(`/admin/marketing/releases/${r.releaseId}`)}
                      >
                        <td>
                          <Link
                            href={`/admin/marketing/releases/${r.releaseId}`}
                            className={styles.nameLink}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.name ?? r.releaseId}
                          </Link>
                        </td>
                        <td>{TYPE_LABELS[r.type ?? ''] ?? r.type}</td>
                        <td>
                          <span className={styles.badge}>{r.derivedStatus}</span>
                        </td>
                        <td>{r.releasedAt ? formatDateShort(r.releasedAt) : '—'}</td>
                        <td>{isQuota ? '—' : (r.grantedCount ?? 0)}</td>
                        <td>{r.claimedCount ?? 0}</td>
                        <td>{r.derivedStatus === 'active' ? remaining : '0'}</td>
                        <td>{r.expiresAt ? formatDateShort(r.expiresAt) : '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>

            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data || !data.hasPrevPage}
              >
                ← Previous
              </button>
              <span className={styles.pageStatus}>
                Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalDocs ?? 0}{' '}
                releases
              </span>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => p + 1)}
                disabled={!data || !data.hasNextPage}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
      {showNew && (
        <NewReleaseModal
          onClose={() => setShowNew(false)}
          onSuccess={(releaseId) => {
            setShowNew(false)
            router.push(`/admin/marketing/releases/${releaseId}`)
          }}
        />
      )}
    </div>
  )
}

export default ReleasesView
