// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb'
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
import { ContactNotes } from './collections/ContactNotes'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  // Server URL is critical for cookie handling and authentication
  serverURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      providers: ['@/providers'],
      // Custom navigation items (Story 6.1)
      beforeNavLinks: [
        '@/components/navigation/NavSearchTrigger#NavSearchTrigger',
        '@/components/navigation/NavDashboardLink#NavDashboardLink',
        '@/components/navigation/NavCollectionsLink#NavCollectionsLink',
        '@/components/navigation/NavApprovalsLink#NavApprovalsLink',
        '@/components/navigation/NavPeriodCloseLink#NavPeriodCloseLink',
        '@/components/navigation/NavECLConfigLink#NavECLConfigLink',
        '@/components/navigation/NavExportsLink#NavExportsLink',
        '@/components/navigation/NavInvestigationLink#NavInvestigationLink',
      ],
      // Notification bell in header actions (next to user profile button)
      actions: ['@/components/Notifications/NotificationAction#NotificationAction'],
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
        // Collections Queue view (Story E1-S1)
        collections: {
          Component: '@/components/CollectionsView/CollectionsViewWithTemplate#CollectionsViewWithTemplate',
          path: '/collections',
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
      },
    },
  },
  collections: [Users, Media, Customers, Conversations, Applications, LoanAccounts, WriteOffRequests, ContactNotes],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
})
