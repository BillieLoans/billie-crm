import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, isAdmin, hasApprovalAuthority, canService, hasAnyRole } from '@/lib/access'

/**
 * Access control: Any authenticated user with a valid role can read clear requests
 */
const canRead: Access = ({ req }) => {
  return hasAnyRole(req.user)
}

/**
 * Access control: Operations, Supervisor, and Admin can create clear requests
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
 * Access control: Only Admin can delete clear requests
 */
const canDelete: Access = ({ req }) => {
  return isAdmin(req.user)
}

/**
 * Reapplication Block Clear Requests Collection
 *
 * Stores requests to clear a customer's reapplication block, requiring
 * approval workflow. Part of the manual block-clear feature (BTB-202).
 */
export const ReapplicationBlockClearRequests: CollectionConfig = {
  slug: 'reapplication-block-clear-requests',
  admin: {
    useAsTitle: 'requestNumber',
    group: 'Servicing',
    defaultColumns: ['requestNumber', 'status', 'canonicalCustomerId', 'customerName', 'createdAt'],
    description: 'Reapplication block clear requests requiring approval',
    // Hide from sidebar for non-admins
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
          data.requestNumber = `RBC-${timestamp}-${random}`
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
      required: true,
      unique: true,
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
        description: 'Human-readable request reference number (e.g., RBC-20241211...). Auto-generated if not provided.',
      },
      index: true,
    },
    {
      name: 'canonicalCustomerId',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The canonical customer ID whose reapplication block is being cleared',
      },
    },
    {
      name: 'conversationId',
      type: 'text',
      admin: {
        description: 'The conversation (application) ID associated with the block',
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
      name: 'reasons',
      type: 'json',
      admin: {
        description: 'List of reasons for the clear request (e.g. ["SERVICEABILITY"])',
      },
    },
    {
      name: 'justification',
      type: 'textarea',
      admin: {
        description: 'Supporting justification for the clear request',
      },
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
        description: 'Current status of the clear request',
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
        {
          name: 'comment',
          type: 'textarea',
          admin: {
            description: 'Approval or rejection comment',
          },
        },
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
