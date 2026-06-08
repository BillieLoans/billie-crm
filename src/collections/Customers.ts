import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasAnyRole } from '@/lib/access'

const servicingAccess: Access = ({ req: { user } }) => {
  return hasAnyRole(user)
}

export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    useAsTitle: 'fullName',
    defaultColumns: ['fullName', 'email', 'customerId'],
    group: 'Supervisor Dashboard',
    // Hide from sidebar for non-admins - use ServicingView instead (Story 6.7)
    hidden: hideFromNonAdmins,
  },
  access: {
    read: servicingAccess,
    create: () => false, // Only created via events
    update: () => false, // Only updated via events
    delete: () => false,
  },
  fields: [
    {
      name: 'customerId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        readOnly: true,
      },
    },
    {
      // BTB-120: when a returning customer is recognised, the thin customers row
      // created under the pre-link (alias) id is tombstoned/redirected here to
      // the surviving canonical customerId. Set by the Python event processor on
      // customer.identity.linked.v1 / .merged.v1.
      name: 'mergedInto',
      type: 'text',
      index: true,
      admin: {
        description:
          'If set, this customer record was merged into the canonical customerId shown here (returning-customer de-duplication).',
        readOnly: true,
      },
    },
    {
      name: 'title',
      type: 'text',
      admin: {
        description: 'Mr, Mrs, Ms, Dr, etc.',
        readOnly: true,
      },
    },
    {
      name: 'preferredName',
      type: 'text',
      admin: {
        description: 'Name customer prefers to be called',
        readOnly: true,
      },
    },
    {
      name: 'firstName',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'middleName',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'lastName',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'fullName',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Full name set by event processor',
      },
    },
    {
      name: 'emailAddress',
      type: 'email',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'mobilePhoneNumber',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'dateOfBirth',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayOnly',
          displayFormat: 'd MMM yyyy',
        },
        readOnly: true,
      },
    },
    {
      name: 'identityVerified',
      type: 'checkbox',
      admin: {
        readOnly: true,
        description: 'Set true on customer.verified.v1 event',
      },
    },
    {
      name: 'residentialAddress',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'From SDK: residential_address',
      },
      fields: [
        {
          name: 'streetNumber',
          type: 'text',
          admin: { description: 'From SDK: street_number' },
        },
        {
          name: 'streetName',
          type: 'text',
          admin: { description: 'From SDK: street_name' },
        },
        {
          name: 'streetType',
          type: 'text',
          admin: { description: 'From SDK: street_type' },
        },
        {
          name: 'unitNumber',
          type: 'text',
          admin: { description: 'From SDK: unit_number' },
        },
        {
          name: 'street',
          type: 'text',
          admin: { description: 'Computed full street address' },
        },
        {
          name: 'suburb',
          type: 'text',
          admin: { description: 'From SDK: suburb' },
        },
        {
          name: 'city',
          type: 'text',
          admin: { description: 'Same as suburb (for backward compatibility)' },
        },
        {
          name: 'state',
          type: 'text',
        },
        {
          name: 'postcode',
          type: 'text',
        },
        {
          name: 'country',
          type: 'text',
          defaultValue: 'Australia',
        },
        {
          name: 'fullAddress',
          type: 'text',
          admin: { description: 'From SDK: full_address' },
        },
      ],
    },
    {
      name: 'mailingAddress',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Address for mail delivery (e.g., cards)',
      },
      fields: [
        {
          name: 'street',
          type: 'text',
        },
        {
          name: 'city',
          type: 'text',
        },
        {
          name: 'state',
          type: 'text',
        },
        {
          name: 'postcode',
          type: 'text',
        },
        {
          name: 'country',
          type: 'text',
          defaultValue: 'Australia',
        },
      ],
    },
    {
      name: 'staffFlag',
      type: 'checkbox',
      admin: {
        description: 'Indicates if customer is a staff member',
        readOnly: true,
      },
    },
    {
      name: 'investorFlag',
      type: 'checkbox',
      admin: {
        description: 'Indicates if customer is an investor',
        readOnly: true,
      },
    },
    {
      name: 'founderFlag',
      type: 'checkbox',
      admin: {
        description: 'Indicates if customer is a founder',
        readOnly: true,
      },
    },
    {
      name: 'vulnerableFlag',
      type: 'checkbox',
      admin: {
        description: 'Indicates if customer requires additional care and support',
        readOnly: true,
      },
    },
    {
      name: 'ekycEntityId',
      type: 'text',
      admin: {
        description: 'eKYC identifier from Frankie',
        readOnly: true,
      },
    },
    {
      name: 'ekycStatus',
      type: 'select',
      options: [
        { label: 'Successful', value: 'successful' },
        { label: 'Failed', value: 'failed' },
        { label: 'Pending', value: 'pending' },
      ],
      admin: {
        description: 'Status of eKYC attempt',
        readOnly: true,
      },
    },
    {
      name: 'individualStatus',
      type: 'select',
      options: [
        { label: 'Living', value: 'LIVING' },
        { label: 'Deceased', value: 'DECEASED' },
        { label: 'Missing', value: 'MISSING' },
      ],
      admin: {
        description: 'Lifecycle status of the individual',
        readOnly: true,
      },
    },
    {
      name: 'identityDocuments',
      type: 'array',
      admin: {
        readOnly: true,
      },
      fields: [
        {
          name: 'documentType',
          type: 'select',
          options: [
            { label: 'Drivers Licence', value: 'DRIVERS_LICENCE' },
            { label: 'Passport', value: 'PASSPORT' },
            { label: 'Medicare', value: 'MEDICARE' },
          ],
          required: true,
        },
        {
          name: 'documentSubtype',
          type: 'text',
          admin: {
            description: 'e.g., Medicare Card Colour',
          },
        },
        {
          name: 'documentNumber',
          type: 'text',
          required: true,
        },
        {
          name: 'expiryDate',
          type: 'date',
          admin: {
            date: {
              pickerAppearance: 'dayOnly',
            },
          },
        },
        {
          name: 'stateOfIssue',
          type: 'text',
        },
        {
          name: 'countryOfIssue',
          type: 'text',
          defaultValue: 'Australia',
        },
        {
          name: 'additionalInfo',
          type: 'json',
          admin: {
            description: 'Additional document information as key-value pairs',
          },
        },
      ],
    },
    {
      name: 'applications',
      type: 'relationship',
      relationTo: 'applications',
      hasMany: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'conversations',
      type: 'relationship',
      relationTo: 'conversations',
      hasMany: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'loanAccounts',
      type: 'relationship',
      relationTo: 'loan-accounts',
      hasMany: true,
      admin: {
        readOnly: true,
        description: 'Loan accounts associated with this customer',
      },
    },
  ],
} 