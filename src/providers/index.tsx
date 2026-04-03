'use client'

import { useCallback, useEffect } from 'react'
import { useAuth } from '@payloadcms/ui'
import { QueryClientProvider } from './query-client'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster, toast } from 'sonner'
import {
  CommandPalette,
  Command,
  CustomerSearchResult,
  LoanAccountSearchResult,
} from '@/components/ui/CommandPalette'
import { LedgerStatusIndicator } from '@/components/LedgerStatus'
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner'
import { FailedActionsBadge } from '@/components/FailedActions'
import { UserSessionGuard } from '@/components/UserSessionGuard'
// Note: NotificationIndicator is now rendered through Payload's actions slot
import { useUIStore } from '@/stores/ui'
import { useCommandPaletteHotkeys } from '@/hooks/useGlobalHotkeys'
import { useReadOnlyMode } from '@/hooks/useReadOnlyMode'
import { useCustomerSearch } from '@/hooks/queries/useCustomerSearch'
import { useLoanAccountSearch } from '@/hooks/queries/useLoanAccountSearch'

/**
 * Component that syncs ledger health with read-only mode.
 * Must be inside QueryClientProvider.
 */
const ReadOnlyModeSync: React.FC = () => {
  useReadOnlyMode()
  return null
}

/**
 * Global command palette wrapper that connects to UI store.
 * Registered inside Providers to appear on all Payload admin pages.
 */
const GlobalCommandPalette: React.FC = () => {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    commandPaletteQuery,
    setCommandPaletteQuery,
  } = useUIStore()

  // Register global hotkeys (Cmd+K, Ctrl+K, F7, Escape)
  useCommandPaletteHotkeys(commandPaletteOpen, setCommandPaletteOpen)

  // Customer search (Story 1.3)
  const customerSearch = useCustomerSearch(commandPaletteQuery)

  // Loan account search (Story 1.4)
  const accountSearch = useLoanAccountSearch(commandPaletteQuery)

  // Combined loading state
  const isSearching =
    customerSearch.isLoading ||
    customerSearch.isFetching ||
    accountSearch.isLoading ||
    accountSearch.isFetching

  // Navigate to ServicingView when customer is selected (Story 2.1)
  // Uses window.location for full page load to ensure Payload admin template renders
  const handleSelectCustomer = useCallback((customerId: string) => {
    setCommandPaletteOpen(false)
    window.location.href = `/admin/servicing/${customerId}`
  }, [setCommandPaletteOpen])

  // Navigate to customer's ServicingView when account is selected
  // Uses window.location for full page load to ensure Payload admin template renders
  const handleSelectAccount = useCallback((customerIdString: string | null) => {
    setCommandPaletteOpen(false)
    if (customerIdString) {
      window.location.href = `/admin/servicing/${customerIdString}`
    }
  }, [setCommandPaletteOpen])

  // Show error toast if search fails (in useEffect to avoid render-time side effects)
  const hasError = customerSearch.isError || accountSearch.isError
  useEffect(() => {
    if (hasError && commandPaletteQuery.length >= 3) {
      toast.error('Search failed', { id: 'search-error' })
    }
  }, [hasError, commandPaletteQuery])

  // Check if we have any results
  const hasCustomers = (customerSearch.data?.results.length ?? 0) > 0
  const hasAccounts = (accountSearch.data?.results.length ?? 0) > 0

  return (
    <CommandPalette
      isOpen={commandPaletteOpen}
      onOpenChange={setCommandPaletteOpen}
      query={commandPaletteQuery}
      onQueryChange={setCommandPaletteQuery}
      isSearching={isSearching}
    >
      {/* Customer Results Group */}
      {hasCustomers && (
        <Command.Group heading="Customers">
          {customerSearch.data?.results.map((customer) => (
            <CustomerSearchResult
              key={customer.id}
              customer={customer}
              onSelect={() => handleSelectCustomer(customer.customerId)}
            />
          ))}
        </Command.Group>
      )}

      {/* Loan Account Results Group */}
      {hasAccounts && (
        <Command.Group heading="Loan Accounts">
          {accountSearch.data?.results.map((account) => (
            <LoanAccountSearchResult
              key={account.id}
              account={account}
              onSelect={() => handleSelectAccount(account.customerIdString)}
            />
          ))}
        </Command.Group>
      )}
    </CommandPalette>
  )
}

/**
 * Components that require an authenticated user session.
 * Hidden on the login screen to avoid false "offline" / "read-only" indicators
 * caused by unauthenticated health-check requests.
 */
const AuthenticatedIndicators: React.FC = () => {
  const { user } = useAuth()

  if (!user) return null

  return (
    <>
      <ReadOnlyModeSync />
      <ReadOnlyBanner />
      <GlobalCommandPalette />
      <LedgerStatusIndicator />
      <FailedActionsBadge />
    </>
  )
}

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <QueryClientProvider>
      {/* SECURITY: Detect user changes and clear session data to prevent cross-user data leakage */}
      <UserSessionGuard />
      <AuthenticatedIndicators />
      {children}
      <Toaster position="top-right" richColors />
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}

// Default export is required for Payload's provider registration (import map expects '@/providers#default').
export default Providers
