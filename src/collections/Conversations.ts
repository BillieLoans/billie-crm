import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasApprovalAuthority } from '@/lib/access'

const supervisorOrAdmin: Access = ({ req: { user } }) => {
  return hasApprovalAuthority(user)
}

export const Conversations: CollectionConfig = {
  slug: 'conversations',
  admin: {
    useAsTitle: 'applicationNumber',
    defaultColumns: ['applicationNumber', 'customerId', 'status', 'startedAt'],
    group: 'Supervisor Dashboard',
    // Hide from sidebar for non-admins (Story 6.7)
    hidden: hideFromNonAdmins,
  },
  access: {
    read: supervisorOrAdmin,
    create: () => false, // Only created via events
    update: () => false, // Only updated via events
    delete: () => false,
  },
  fields: [
    {
      name: 'conversationId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'applicationNumber',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'customerId',
      type: 'relationship',
      relationTo: 'customers',
      admin: {
        readOnly: true,
        description: 'Linked customer (may be null if customer not yet created)',
      },
    },
    {
      name: 'customerIdString',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Customer ID string for queries when relationship not yet established',
      },
    },
    {
      name: 'applicationId',
      type: 'relationship',
      relationTo: 'applications',
      admin: {
        readOnly: true,
        description: 'Linked application (may be null)',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Paused', value: 'paused' },
        { label: 'Soft End', value: 'soft_end' },
        { label: 'Hard End', value: 'hard_end' },
        { label: 'Approved', value: 'approved' },
        { label: 'Declined', value: 'declined' },
      ],
      defaultValue: 'active',
      index: true,
    },
    {
      name: 'startedAt',
      type: 'date',
      required: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'updatedAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'utterances',
      type: 'array',
      label: 'Conversation Messages',
      admin: {
        readOnly: true,
      },
      fields: [
        {
          name: 'username',
          type: 'text',
          admin: {
            description: 'Usually "customer" or "assistant"',
          },
        },
        {
          name: 'utterance',
          type: 'textarea',
          required: true,
        },
        {
          name: 'rationale',
          type: 'textarea',
          admin: {
            description: 'Internal reasoning for assistant responses',
          },
        },
        {
          name: 'createdAt',
          type: 'date',
          required: true,
        },
        {
          name: 'updatedAt',
          type: 'date',
        },
        {
          name: 'answerInputType',
          type: 'text',
          admin: {
            description: 'Frontend input type hint (e.g. address, email)',
          },
        },
        {
          name: 'prevSeq',
          type: 'number',
          admin: {
            description: 'Previous sequence number in conversation',
          },
        },
        {
          name: 'endConversation',
          type: 'checkbox',
          defaultValue: false,
        },
        {
          name: 'additionalData',
          type: 'json',
          admin: {
            description: 'Additional data for frontend enrichment',
          },
        },
      ],
    },
    {
      name: 'purpose',
      type: 'text',
      admin: {
        description: 'Conversation purpose from summary',
        readOnly: true,
      },
    },
    {
      name: 'facts',
      type: 'array',
      admin: {
        description: 'Key facts from conversation summary',
        readOnly: true,
      },
      fields: [
        {
          name: 'fact',
          type: 'text',
        },
      ],
    },
    {
      name: 'version',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
      },
    },
    // Additional fields written by Python event processor
    {
      name: 'lastUtteranceTime',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Timestamp of most recent utterance',
      },
    },
    {
      name: 'finalDecision',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Final decision outcome (APPROVED, DECLINED, REFERRED)',
      },
    },
    {
      name: 'assessments',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Risk and serviceability assessments',
      },
      fields: [
        {
          name: 'identityRisk',
          type: 'json',
          admin: { description: 'Identity risk assessment data' },
        },
        {
          name: 'serviceability',
          type: 'json',
          admin: { description: 'Serviceability assessment data (includes s3Key and decision)' },
        },
        {
          name: 'fraudCheck',
          type: 'json',
          admin: { description: 'Fraud check assessment data' },
        },
        {
          name: 'accountConduct',
          type: 'json',
          admin: { description: 'Account conduct assessment data (includes s3Key and decision)' },
        },
        {
          name: 'postIdentityRisk',
          type: 'json',
          admin: { description: 'Post-identity risk check data' },
        },
        {
          name: 'creditAssessmentComplete',
          type: 'json',
          admin: { description: 'Credit assessment completion data' },
        },
      ],
    },
    {
      name: 'statementCapture',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Statement capture flow state (consent, Basiq job, retrieval, affordability)',
      },
    },
    {
      name: 'decisionStatus',
      type: 'select',
      options: [
        { label: 'Approved', value: 'approved' },
        { label: 'Declined', value: 'declined' },
        { label: 'Referred', value: 'referred' },
        { label: 'No Decision', value: 'no_decision' },
      ],
      index: true,
      admin: {
        readOnly: true,
        description: 'Final decision outcome for filtering in monitoring view',
      },
    },
    {
      name: 'noticeboard',
      type: 'array',
      admin: {
        readOnly: true,
        description: 'Agent noticeboard posts',
      },
      fields: [
        {
          name: 'agentName',
          type: 'text',
        },
        {
          name: 'topic',
          type: 'text',
        },
        {
          name: 'content',
          type: 'textarea',
        },
        {
          name: 'timestamp',
          type: 'date',
        },
      ],
    },
    {
      name: 'applicationData',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Additional application data from events',
      },
    },
  ],

} 