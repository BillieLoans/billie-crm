import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, isAdmin, hasApprovalAuthority, canService, hasAnyRole } from '@/lib/access'

/**
 * Access control: Any authenticated user with a valid role can read write-off requests
 */
const canRead: Access = ({ req }) => {
  return hasAnyRole(req.user)
}

/**
 * Access control: Operations, Supervisor, and Admin can create write-off requests
 */
const canCreate: Access = ({ req }) => {
  return canService(req.user)
}

/**
 * Access control: Only Admin and Supervisor can update (approve/reject)
 */
const canUpdate: Access = ({ req }) => {
  return hasApprovalAuthority(req.user)
}

/**
 * Access control: Only Admin can delete write-off requests
 */
const canDelete: Access = ({ req }) => {
  return isAdmin(req.user)
}

/**
 * Write-Off Requests Collection
 *
 * Stores write-off requests for loan accounts, requiring approval workflow.
 * Part of Epic 4: Write-Off & Approval Workflow.
 */
export const WriteOffRequests: CollectionConfig = {
  slug: 'write-off-requests',
  admin: {
    useAsTitle: 'requestNumber',
    group: 'Servicing',
    defaultColumns: ['requestNumber', 'status', 'loanAccountId', 'amount', 'createdAt'],
    description: 'Write-off requests requiring approval',
    // Hide from sidebar for non-admins - use ApprovalsView instead (Story 6.7)
    hidden: hideFromNonAdmins,
  },
  access: {
    read: canRead,
    create: canCreate,
    update: canUpdate,
    delete: canDelete,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation }) => {
        // Generate request number on create (only if not provided by event processor)
        if (operation === 'create' && !data.requestNumber) {
          const timestamp = Date.now().toString(36).toUpperCase()
          const random = Math.random().toString(36).substring(2, 6).toUpperCase()
          data.requestNumber = `WO-${timestamp}-${random}`
        }
        return data
      },
    ],
  },
  fields: [
    // ==========================================================================
    // Event Sourcing Fields
    // These fields link the projection to the original events for correlation
    // and polling. Populated by the Python event processor.
    // ==========================================================================
    {
      name: 'requestId',
      type: 'text',
      index: true,
      admin: {
        description: 'Event correlation ID (conv field). Groups related events in a workflow.',
        position: 'sidebar',
      },
    },
    {
      name: 'eventId',
      type: 'text',
      index: true,
      admin: {
        description: 'Event ID for polling lookup (cause field). Used by client to find projection after command.',
        position: 'sidebar',
      },
    },
    // ==========================================================================
    // Request Identification
    // ==========================================================================
    {
      name: 'requestNumber',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Human-readable request reference number (e.g., WO-20241211...). Auto-generated if not provided.',
      },
      index: true,
    },
    {
      name: 'loanAccountId',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The loan account ID for the write-off request',
      },
    },
    {
      name: 'customerId',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The customer ID associated with the loan account',
      },
    },
    {
      name: 'customerName',
      type: 'text',
      admin: {
        description: 'Customer name for display purposes',
      },
    },
    {
      name: 'accountNumber',
      type: 'text',
      admin: {
        description: 'Account number for display purposes',
      },
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Write-off amount in AUD',
      },
    },
    {
      name: 'originalBalance',
      type: 'number',
      admin: {
        description: 'Account balance at time of request',
      },
    },
    {
      name: 'reason',
      type: 'select',
      required: true,
      options: [
        { label: 'Customer Hardship', value: 'hardship' },
        { label: 'Bankruptcy/Insolvency', value: 'bankruptcy' },
        { label: 'Deceased Estate', value: 'deceased' },
        { label: 'Unable to Locate', value: 'unable_to_locate' },
        { label: 'Fraud - Customer is Victim', value: 'fraud_victim' },
        { label: 'Disputed Debt', value: 'disputed' },
        { label: 'Aged Debt (>180 days)', value: 'aged_debt' },
        { label: 'Other', value: 'other' },
      ],
      admin: {
        description: 'Primary reason for the write-off request',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Supporting notes and context for the request',
      },
    },
    {
      name: 'supportingDocuments',
      type: 'array',
      admin: {
        description: 'Uploaded supporting documents',
      },
      fields: [
        {
          name: 'document',
          type: 'upload',
          relationTo: 'media',
        },
        {
          name: 'description',
          type: 'text',
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending Approval', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      index: true,
      admin: {
        description: 'Current status of the write-off request',
      },
    },
    {
      name: 'priority',
      type: 'select',
      defaultValue: 'normal',
      options: [
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
        { label: 'Urgent', value: 'urgent' },
      ],
      admin: {
        description: 'Priority level for approval queue',
      },
    },
    {
      name: 'requiresSeniorApproval',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Flag for requests exceeding threshold ($10,000)',
      },
    },
    // Requestor information
    {
      name: 'requestedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'User who submitted the request',
      },
    },
    {
      name: 'requestedByName',
      type: 'text',
      admin: {
        description: 'Requestor name for audit purposes',
      },
    },
    // Approval information (for approved/rejected status)
    {
      name: 'approvalDetails',
      type: 'group',
      admin: {
        condition: (data) => data?.status === 'approved' || data?.status === 'rejected',
      },
      fields: [
        // Legacy fields (for backward compatibility with direct writes)
        {
          name: 'decidedBy',
          type: 'relationship',
          relationTo: 'users',
        },
        {
          name: 'decidedByName',
          type: 'text',
        },
        {
          name: 'decidedAt',
          type: 'date',
        },
        {
          name: 'comment',
          type: 'textarea',
          admin: {
            description: 'Approval or rejection comment',
          },
        },
        // Event-sourced approval fields
        {
          name: 'approvedBy',
          type: 'text',
          admin: {
            description: 'User ID who approved (from event)',
          },
        },
        {
          name: 'approvedByName',
          type: 'text',
        },
        {
          name: 'approvedAt',
          type: 'date',
        },
        // Event-sourced rejection fields
        {
          name: 'rejectedBy',
          type: 'text',
          admin: {
            description: 'User ID who rejected (from event)',
          },
        },
        {
          name: 'rejectedByName',
          type: 'text',
        },
        {
          name: 'rejectedAt',
          type: 'date',
        },
        {
          name: 'reason',
          type: 'textarea',
          admin: {
            description: 'Rejection reason (from event)',
          },
        },
      ],
    },
    // Cancellation information (for cancelled status)
    {
      name: 'cancellationDetails',
      type: 'group',
      admin: {
        condition: (data) => data?.status === 'cancelled',
      },
      fields: [
        {
          name: 'cancelledBy',
          type: 'text',
          admin: {
            description: 'User ID who cancelled (from event)',
          },
        },
        {
          name: 'cancelledByName',
          type: 'text',
        },
        {
          name: 'cancelledAt',
          type: 'date',
        },
      ],
    },
    // Audit fields
    {
      name: 'requestedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Timestamp when request was submitted',
      },
      defaultValue: () => new Date().toISOString(),
    },
  ],
  timestamps: true,
}
