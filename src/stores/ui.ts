'use client'

import { create } from 'zustand'

interface UIState {
  // Read-only mode (Story 5.2)
  readOnlyMode: boolean
  setReadOnlyMode: (value: boolean) => void

  // Command palette state (Story 1.2)
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (value: boolean) => void
  commandPaletteQuery: string
  setCommandPaletteQuery: (value: string) => void

  // Transaction highlight state (for linking payments → transactions)
  highlightedTransactionId: string | null
  setHighlightedTransactionId: (value: string | null) => void
  clearHighlightedTransaction: () => void

  // Navigation context for back navigation
  transactionNavigationSource: { paymentNumber: number; transactionId: string } | null
  setTransactionNavigationSource: (source: { paymentNumber: number; transactionId: string } | null) => void
  
  // Payment to auto-expand when returning to Overview
  expandedPaymentNumber: number | null
  setExpandedPaymentNumber: (paymentNumber: number | null) => void

  // Issue reporter modal
  reportIssueOpen: boolean
  /** What opened the reporter — 'server-error' | 'network-error' | null for manual */
  reportIssueTrigger: string | null
  openReportIssue: (trigger?: string) => void
  closeReportIssue: () => void
}

export const useUIStore = create<UIState>((set) => ({
  // Read-only mode
  readOnlyMode: false,
  setReadOnlyMode: (value) => set({ readOnlyMode: value }),

  // Command palette
  commandPaletteOpen: false,
  // Reset query only when opening (not closing) to avoid flash of old query on reopen
  setCommandPaletteOpen: (value) => set((state) => ({
    commandPaletteOpen: value,
    commandPaletteQuery: value ? '' : state.commandPaletteQuery,
  })),
  commandPaletteQuery: '',
  setCommandPaletteQuery: (value) => set({ commandPaletteQuery: value }),

  // Transaction highlight
  highlightedTransactionId: null,
  setHighlightedTransactionId: (value) => set({ highlightedTransactionId: value }),
  clearHighlightedTransaction: () => set({ highlightedTransactionId: null }),

  // Navigation context
  transactionNavigationSource: null,
  setTransactionNavigationSource: (source) => set({ transactionNavigationSource: source }),

  // Auto-expand payment
  expandedPaymentNumber: null,
  setExpandedPaymentNumber: (paymentNumber) => set({ expandedPaymentNumber: paymentNumber }),

  // Issue reporter
  reportIssueOpen: false,
  reportIssueTrigger: null,
  openReportIssue: (trigger) => set({ reportIssueOpen: true, reportIssueTrigger: trigger ?? null }),
  // Clear the trigger on close so the next manual open isn't labelled an error
  closeReportIssue: () => set({ reportIssueOpen: false, reportIssueTrigger: null }),
}))
