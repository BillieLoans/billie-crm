// storage-adapter-import-placeholder
import { postgresAdapter } from '@payloadcms/db-postgres'
import { desc } from 'drizzle-orm'
import { index, uniqueIndex } from 'drizzle-orm/pg-core'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Customers } from './collections/Customers'
import { Conversations } from './collections/Conversations'
import { Applications } from './collections/Applications'
import { LoanAccounts } from './collections/LoanAccounts'
import { WriteOffRequests } from './collections/WriteOffRequests'
import { ReapplicationBlockClearRequests } from './collections/ReapplicationBlockClearRequests'
import { ContactNotes } from './collections/ContactNotes'
import { Notifications } from './collections/Notifications'
import { CollectionsCases } from './collections/CollectionsCases'
import { Contacts } from './collections/Contacts'
import { Interactions } from './collections/Interactions'
import { ContactAuditLog } from './collections/ContactAuditLog'
import { Batches } from './collections/Batches'
import { Feedback } from './collections/Feedback'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  // Server URL is critical for cookie handling and authentication
  serverURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  csrf: [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  ],
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      providers: ['@/providers'],
      // Replace Payload's built-in logout button with one that points at our
      // custom /api/auth/logout route, which deterministically clears the
      // custom (Google OAuth) `payload-token` cookie. Payload's built-in client
      // logout swallows POST failures and can leave the session alive.
      logout: {
        Button: '@/components/Auth/LogoutButton#LogoutButton',
      },
      // Custom navigation items (Story 6.1)
      beforeNavLinks: [
        '@/components/navigation/NavSearchTrigger#NavSearchTrigger',
        '@/components/navigation/NavDashboardLink#NavDashboardLink',
        '@/components/navigation/NavApplicationsLink#NavApplicationsLink',
        '@/components/navigation/NavAccountsLink#NavAccountsLink',
        '@/components/navigation/NavCollectionsLink#NavCollectionsLink',
        '@/components/navigation/NavApprovalsLink#NavApprovalsLink',
        '@/components/navigation/NavPeriodCloseLink#NavPeriodCloseLink',
        '@/components/navigation/NavECLConfigLink#NavECLConfigLink',
        '@/components/navigation/NavExportsLink#NavExportsLink',
        '@/components/navigation/NavInvestigationLink#NavInvestigationLink',
        '@/components/navigation/NavMarketingLink#NavMarketingLink',
      ],
      // Notification bell in header actions (next to user profile button)
      actions: ['@/components/Notifications/NotificationAction#NotificationAction'],
      afterLogin: ['@/components/Auth/GoogleLoginButton#GoogleLoginButton'],
      // Custom views with Payload admin template (includes sidebar)
      // Note: /admin root redirect is handled by Next.js middleware (src/middleware.ts)
      // to work around Payload's built-in route redirect loop issue.
      views: {
        // Dashboard view (Story 6.2)
        dashboard: {
          Component: '@/components/DashboardView/DashboardViewWithTemplate#DashboardViewWithTemplate',
          path: '/dashboard',
        },
        // Servicing view (Story 2.1) - uses catch-all for customerId
        servicing: {
          Component: '@/components/ServicingView/ServicingViewWithTemplate#ServicingViewWithTemplate',
          path: '/servicing/:segments*',
        },
        // Approvals view (Story 4.1)
        approvals: {
          Component: '@/components/ApprovalsView/ApprovalsViewWithTemplate#ApprovalsViewWithTemplate',
          path: '/approvals',
        },
        // My Activity view (Story 6.6)
        myActivity: {
          Component: '@/components/MyActivityView/MyActivityViewWithTemplate#MyActivityViewWithTemplate',
          path: '/my-activity',
        },
        // Browse Accounts view — faceted account browser with Smart Views
        accounts: {
          Component:
            '@/components/AccountsBrowserView/AccountsBrowserViewWithTemplate#AccountsBrowserViewWithTemplate',
          path: '/accounts',
        },
        // Collections Queue view (Story E1-S1)
        collections: {
          Component: '@/components/CollectionsView/CollectionsViewWithTemplate#CollectionsViewWithTemplate',
          // NOTE: must NOT be '/collections' — Payload reserves /admin/collections/* for
          // built-in database-collection admin routes, which shadow a custom view there
          // (Payload 3.85 resolves the built-in routing first → "Nothing found").
          // Catch-all suffix (mirrors the servicing view above) so the case-detail
          // sub-route (/collections-queue/:accountId, BTB-196 WS4) renders here too.
          path: '/collections-queue/:segments*',
        },
        pendingDisbursements: {
          Component:
            '@/components/PendingDisbursementsView/PendingDisbursementsViewWithTemplate#PendingDisbursementsViewWithTemplate',
          path: '/pending-disbursements',
        },
        // System Status view (Story E1-S10)
        systemStatus: {
          Component: '@/components/SystemStatusView/SystemStatusViewWithTemplate#SystemStatusViewWithTemplate',
          path: '/system-status',
        },
        // Period Close view (Epic 3)
        periodClose: {
          Component: '@/components/PeriodCloseView/PeriodCloseViewWithTemplate#PeriodCloseViewWithTemplate',
          path: '/period-close',
        },
        // ECL Configuration view (Epic 4)
        eclConfig: {
          Component: '@/components/ECLConfigView/ECLConfigViewWithTemplate#ECLConfigViewWithTemplate',
          path: '/ecl-config',
        },
        // Export Center view (Epic 5)
        exports: {
          Component: '@/components/ExportCenterView/ExportCenterViewWithTemplate#ExportCenterViewWithTemplate',
          path: '/exports',
        },
        // Investigation view (Epic 6)
        investigation: {
          Component: '@/components/InvestigationView/InvestigationViewWithTemplate#InvestigationViewWithTemplate',
          path: '/investigation',
        },
        // Applications view (billie-crm-applications) — catch-all for conversationId sub-routes
        applications: {
          Component: '@/components/ApplicationsView/ApplicationsViewWithTemplate#ApplicationsViewWithTemplate',
          path: '/applications/:segments*',
        },
        // Marketing view (Task C6) — catch-all for contact-detail sub-routes
        marketing: {
          Component: '@/components/MarketingView/MarketingViewWithTemplate#MarketingViewWithTemplate',
          path: '/marketing/:segments*',
        },
      },
    },
  },
  collections: [Users, Media, Customers, Conversations, Applications, LoanAccounts, WriteOffRequests, ReapplicationBlockClearRequests, ContactNotes, Notifications, CollectionsCases, Contacts, Interactions, ContactAuditLog, Batches, Feedback],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'build-placeholder-not-for-production',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      // The fallback is intentionally credential-less so missing
      // DATABASE_URI in any deployed environment fails at connect time
      // rather than silently using a baked-in dev password. Set
      // DATABASE_URI explicitly via the runtime env (see .env.example).
      connectionString: process.env.DATABASE_URI || 'postgresql://localhost:5432/billie_crm',
    },
    idType: 'uuid',
    push: process.env.NODE_ENV !== 'production',
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        // Enforce the natural key for the schedule-payments child table so the
        // Python event-processor can upsert via `ON CONFLICT (_parent_id, payment_number)`.
        // Payload's collection config can't express composite indexes that span the
        // collection ⇄ nested-array boundary, so we patch the Drizzle table directly.
        const schedulePayments = (schema.tables as Record<string, unknown>)
          .loan_accounts_repayment_schedule_payments as
          | Parameters<typeof extendTable>[0]['table']
          | undefined
        if (schedulePayments) {
          extendTable({
            table: schedulePayments,
            extraConfig: (t) => ({
              loanAccountsScheduleNaturalKey: uniqueIndex(
                'loan_accts_repay_sched_payments_natural_key_idx',
              ).on(t._parentID, t.paymentNumber),
            }),
          })
        }

        // Compound indexes for the conversation monitor grid. These can't be
        // declared in the Payload collection because the config only supports
        // single-field `index: true`. Replaces the runtime createIndex() calls
        // that used to live in src/lib/db/ensureConversationIndexes.ts.
        const conversations = (schema.tables as Record<string, unknown>).conversations as
          | Parameters<typeof extendTable>[0]['table']
          | undefined
        if (conversations) {
          extendTable({
            table: conversations,
            extraConfig: (t) => ({
              conversationsMonitorGridIdx: index('conversations_monitor_grid_idx').on(
                t.status,
                t.decisionStatus,
                desc(t.updatedAt),
              ),
              conversationsByCustomerIdx: index('conversations_by_customer_idx').on(
                t.customerIdString,
                desc(t.updatedAt),
              ),
            }),
          })
        }

        // Compound indexes for the collections worklist grid (BTB-199). Single
        // `index: true` on the collection can't express these; mirror the
        // conversations monitor-grid pattern above.
        const collectionCases = (schema.tables as Record<string, unknown>).collection_cases as
          | Parameters<typeof extendTable>[0]['table']
          | undefined
        if (collectionCases) {
          extendTable({
            table: collectionCases,
            extraConfig: (t) => ({
              collectionCasesWorklistIdx: index('collection_cases_worklist_idx').on(
                t.state,
                t.rung,
                desc(t.updatedAt),
              ),
              collectionCasesByCustomerIdx: index('collection_cases_by_customer_idx').on(
                t.customerId,
                desc(t.updatedAt),
              ),
            }),
          })
        }

        return schema
      },
    ],
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
})
