'use client'

/**
 * LoanAccountServicingRedirect
 *
 * Replaces the raw `loan-accounts` collection edit view.
 *
 * The old edit view mounted the legacy `LoanAccountServicing` panel, which offered
 * single-actor money movement (including a direct write-off that bypassed the
 * maker-checker command flow). All servicing now happens in the ServicingView, which
 * carries read-only gating, optimistic-concurrency checks, the failed-actions queue and
 * the request/approve split for write-offs.
 *
 * This component simply bounces the user to `/admin/servicing/<customerIdString>` with
 * the account pre-selected via `?accountId=<loanAccountId>` — the same URL shape used by
 * every other link into servicing (see AccountsBrowserView, PendingDisbursementsView).
 */

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useDocumentInfo } from '@payloadcms/ui'

type LoanAccountShape = {
  loanAccountId?: string | null
  customerIdString?: string | null
}

const buildServicingUrl = (doc: LoanAccountShape | null | undefined): string | null => {
  const customerIdString = doc?.customerIdString
  if (!customerIdString) return null
  const loanAccountId = doc?.loanAccountId
  return loanAccountId
    ? `/admin/servicing/${encodeURIComponent(customerIdString)}?accountId=${encodeURIComponent(loanAccountId)}`
    : `/admin/servicing/${encodeURIComponent(customerIdString)}`
}

export const LoanAccountServicingRedirect: React.FC = () => {
  const { id, savedDocumentData } = useDocumentInfo()
  const [fetchedDoc, setFetchedDoc] = useState<LoanAccountShape | null>(null)
  const [failed, setFailed] = useState(false)

  const doc = (savedDocumentData as LoanAccountShape | undefined) ?? fetchedDoc
  const target = useMemo(() => buildServicingUrl(doc), [doc])

  // The edit view usually hands us the saved document already; fall back to the REST
  // endpoint when it doesn't (e.g. a direct deep link before hydration completes).
  useEffect(() => {
    if (!id || savedDocumentData || fetchedDoc) return
    let cancelled = false
    fetch(`/api/loan-accounts/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelled) setFetchedDoc(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, savedDocumentData, fetchedDoc])

  useEffect(() => {
    if (target) window.location.replace(target)
  }, [target])

  if (target) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Redirecting to the servicing view…</p>
        <p>
          <a href={target}>Continue to servicing</a>
        </p>
      </div>
    )
  }

  if (failed || (doc && !doc.customerIdString)) {
    return (
      <div style={{ padding: '2rem' }} role="alert">
        <p>
          Loan accounts are serviced from the Servicing view. This account has no linked
          customer, so it cannot be opened directly.
        </p>
        <p>
          <Link href="/admin/accounts">Browse accounts</Link>
        </p>
      </div>
    )
  }

  return <div style={{ padding: '2rem' }}>Loading account…</div>
}

export default LoanAccountServicingRedirect
