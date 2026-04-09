'use client'

import React, { useRef, useEffect, useCallback } from 'react'
import { SanitizedHTML } from '../SanitizedHTML'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import styles from './styles.module.css'

type Utterance = ConversationDetail['utterances'][number]

interface MessagePanelProps {
  utterances: Utterance[]
  isLoading?: boolean
}

function parseUtcTimestamp(ts: string | Date): Date {
  if (ts instanceof Date) return ts
  // Naive strings (no Z / offset) come from the assistant service which emits UTC without a
  // timezone indicator. Treat them as UTC by appending 'Z' so the browser doesn't shift them
  // to local time.
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(ts)
  return new Date(hasTimezone ? ts : ts + 'Z')
}

function formatTimestamp(ts: string | Date | null | undefined): string {
  if (!ts) return ''
  try {
    return new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(parseUtcTimestamp(ts as string | Date))
  } catch {
    return ''
  }
}

function groupByMinute(utterances: Utterance[]): Array<{ minuteKey: string; items: Utterance[] }> {
  const groups: Array<{ minuteKey: string; items: Utterance[] }> = []
  for (const u of utterances) {
    const ts = u.createdAt
    const minuteKey = ts
      ? parseUtcTimestamp(ts as string).toISOString().slice(0, 16)
      : `msg-${Math.random()}`
    const last = groups[groups.length - 1]
    if (last && last.minuteKey === minuteKey) {
      last.items.push(u)
    } else {
      groups.push({ minuteKey, items: [u] })
    }
  }
  return groups
}

/**
 * MessagePanel renders the conversation transcript as chat bubbles.
 *
 * - Customer messages: left-aligned, grey background (FR10)
 * - Assistant messages: right-aligned, blue background (FR10)
 * - Rationale shown as italic sub-text (FR11)
 * - Grouped timestamps: one header per minute window
 * - Auto-scroll to bottom on new messages (only if not scrolled up)
 * - Skeleton loaders while loading (NFR2)
 * - Screen reader accessible (aria-label per bubble)
 *
 * Story 3.2: Chat Transcript & HTML Sanitisation
 */
export function MessagePanel({ utterances, isLoading }: MessagePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const userScrolledUpRef = useRef(false)

  // Track user scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    userScrolledUpRef.current = !atBottom
  }, [])

  // Auto-scroll on new messages if user hasn't scrolled up
  useEffect(() => {
    const el = containerRef.current
    if (!el || !utterances) return
    if (utterances.length > prevCountRef.current && !userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
    }
    prevCountRef.current = utterances.length
  }, [utterances])

  if (isLoading) {
    return (
      <div className={styles.panel}>
        <div className={styles.messages}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeletonBubble} aria-hidden="true" />
          ))}
        </div>
      </div>
    )
  }

  const groups = groupByMinute(utterances)

  return (
    <div className={styles.panel}>
      <div
        className={styles.messages}
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
      >
        {groups.map((group) => {
          const ts = group.items[0]?.createdAt
          return (
            <React.Fragment key={group.minuteKey}>
              {ts && (
                <p className={styles.timestampHeader} aria-hidden="true">
                  {formatTimestamp(ts as string)}
                </p>
              )}
              {group.items.map((u, idx) => {
                const isCustomer = u.username === 'customer'
                const speaker = isCustomer ? 'customer' : 'assistant'
                return (
                  <div
                    key={`${group.minuteKey}-${idx}`}
                    className={`${styles.bubble} ${styles[speaker]}`}
                    aria-label={isCustomer ? 'Customer message' : 'Assistant message'}
                  >
                    <div className={styles.bubbleContent}>
                      {u.utterance ? (
                        <SanitizedHTML html={u.utterance} />
                      ) : null}
                    </div>
                    {!isCustomer && u.rationale && (
                      <p className={styles.rationale}>{u.rationale}</p>
                    )}
                  </div>
                )
              })}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
