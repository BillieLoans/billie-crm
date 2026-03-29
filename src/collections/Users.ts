import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

const canReadUsers: Access = ({ req, id }) => {
  if (isAdmin(req.user)) {
    return true
  }
  // Users can read their own record
  return (req.user as { id?: string })?.id === id
}

const canUpdateUsers: Access = ({ req, id }) => {
  if (isAdmin(req.user)) {
    return true
  }
  // Users can update their own record
  return (req.user as { id?: string })?.id === id
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    group: 'Administration',
    // Hide from sidebar for non-admins (Story 6.7)
    hidden: hideFromNonAdmins,
  },
  auth: true,
  access: {
    read: canReadUsers,
    create: ({ req: { user } }) => isAdmin(user),
    update: canUpdateUsers,
    delete: ({ req: { user } }) => isAdmin(user),
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Supervisor', value: 'supervisor' },
        { label: 'Operations', value: 'operations' },
        { label: 'Read Only', value: 'readonly' },
      ],
      defaultValue: 'readonly',
      required: true,
      access: {
        update: ({ req }) => isAdmin(req.user),
      },
    },
    {
      name: 'firstName',
      type: 'text',
      required: true,
    },
    {
      name: 'lastName',
      type: 'text',
      required: true,
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
    },
  ],
}
