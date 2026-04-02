import type { CollectionConfig, Access, AuthStrategyResult } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

const isServiceAccount = (user: unknown): boolean => {
  if (user && typeof user === 'object' && 'role' in user) {
    return (user as { role: string }).role === 'service'
  }
  return false
}

const canReadUsers: Access = ({ req, id }) => {
  if (!req.user) return false
  if (isAdmin(req.user)) return true
  // Service accounts can read all users (for inter-service role lookups)
  if (isServiceAccount(req.user)) return true
  // Users can read their own record
  return (req.user as { id?: string })?.id === id
}

const canUpdateUsers: Access = ({ req, id }) => {
  if (!req.user) return false
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
  auth: {
    useAPIKey: true,
    strategies: [
      {
        name: 'custom-jwt',
        authenticate: async ({ headers, payload }) => {
          try {
            const { extractJWT } = await import('payload')
            const { jwtVerify } = await import('jose')

            const token = extractJWT({ headers, payload })
            if (!token) return { user: null }

            const secretKey = new TextEncoder().encode(payload.secret)
            const { payload: decoded } = await jwtVerify(token, secretKey)

            if (!decoded.id || !decoded.collection) return { user: null }

            const user = (await payload.findByID({
              id: decoded.id as string,
              collection: 'users',
              overrideAccess: true,
            })) as AuthStrategyResult['user']

            if (user) {
              user.collection = 'users'
              user._strategy = 'custom-jwt'
              return { user }
            }
          } catch {
            // Fall through to next strategy
          }
          return { user: null }
        },
      },
    ],
  },
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
        { label: 'Service', value: 'service' },
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
