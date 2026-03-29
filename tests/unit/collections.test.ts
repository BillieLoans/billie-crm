import { describe, test, expect, vi } from 'vitest'
import { Applications } from '../../src/collections/Applications'
import { Customers } from '../../src/collections/Customers'
import { Conversations } from '../../src/collections/Conversations'
import { Users } from '../../src/collections/Users'
import { Media } from '../../src/collections/Media'
import { ContactNotes } from '../../src/collections/ContactNotes'
import { createMockPayloadRequest } from '../utils/test-helpers'

describe('Payload Collections Configuration', () => {
  describe('Applications Collection', () => {
    test('should have correct slug and configuration', () => {
      expect(Applications.slug).toBe('applications')
      expect(Applications.admin?.group).toBe('Supervisor Dashboard')
      expect(Applications.admin?.useAsTitle).toBe('applicationNumber')
    })

    test('should have required fields', () => {
      const requiredFields = ['applicationNumber', 'customerId']
      const fieldNames = (Applications.fields as any[])?.map(f => f.name)
      
      requiredFields.forEach(fieldName => {
        expect(fieldNames).toContain(fieldName)
      })
    })

    test('should have proper access control for supervisors', () => {
      const mockSupervisorRequest = createMockPayloadRequest({ role: 'supervisor' })
      const mockAdminRequest = createMockPayloadRequest({ role: 'admin' })
      const mockUserRequest = createMockPayloadRequest({ role: 'user' })

      expect(Applications.access?.read?.(mockSupervisorRequest as any)).toBe(true)
      expect(Applications.access?.read?.(mockAdminRequest as any)).toBe(true)
      expect(Applications.access?.read?.(mockUserRequest as any)).toBe(false)
    })

    test('should prevent direct create/update/delete operations', () => {
      const mockRequest = createMockPayloadRequest({ role: 'admin' })
      
      expect(Applications.access?.create?.(mockRequest as any)).toBe(false)
      expect(Applications.access?.update?.(mockRequest as any)).toBe(false)
      expect(Applications.access?.delete?.(mockRequest as any)).toBe(false)
    })

    test('should have proper field types and configurations', () => {
      const fields = (Applications.fields || []) as any[]
      
      // Check applicationNumber field
      const appNumberField = fields.find(f => 'name' in f && f.name === 'applicationNumber')
      expect(appNumberField?.type).toBe('text')
      expect(appNumberField?.required).toBe(true)
      expect(appNumberField?.unique).toBe(true)
      expect((appNumberField?.admin as any)?.readOnly).toBe(true)

      // Check customer relationship
      const customerField = fields.find(f => 'name' in f && f.name === 'customerId')
      expect(customerField?.type).toBe('relationship')
      expect(customerField?.relationTo).toBe('customers')

      // Check loan amount field
      const loanAmountField = fields.find(f => 'name' in f && f.name === 'loanAmount')
      expect(loanAmountField?.type).toBe('number')
      expect((loanAmountField?.admin as any)?.readOnly).toBe(true)
    })

    test('should have nested application process structure', () => {
      const fields = (Applications.fields || []) as any[]
      const appProcessField = fields.find(f => 'name' in f && f.name === 'applicationProcess')
      
      expect(appProcessField?.type).toBe('group')
      expect((appProcessField?.admin as any)?.readOnly).toBe(true)
      expect(appProcessField?.fields).toBeDefined()
    })
  })

  describe('Customers Collection', () => {
    test('should have correct slug and configuration', () => {
      expect(Customers.slug).toBe('customers')
      expect(Customers.admin?.group).toBe('Supervisor Dashboard')
      expect(Customers.admin?.useAsTitle).toBe('fullName')
    })

    test('should have identity document structure', () => {
      const fields = (Customers.fields || []) as any[]
      const identityDocsField = fields.find(f => 'name' in f && f.name === 'identityDocuments')
      
      expect(identityDocsField?.type).toBe('array')
      expect((identityDocsField?.admin as any)?.readOnly).toBe(true)
      expect(identityDocsField?.fields).toBeDefined()
    })

    test('should have address groups', () => {
      const fields = (Customers.fields || []) as any[]
      const residentialField = fields.find(f => 'name' in f && f.name === 'residentialAddress')
      const mailingField = fields.find(f => 'name' in f && f.name === 'mailingAddress')
      
      expect(residentialField?.type).toBe('group')
      expect(mailingField?.type).toBe('group')
      expect((residentialField?.admin as any)?.readOnly).toBe(true)
      expect((mailingField?.admin as any)?.readOnly).toBe(true)
    })

    test('should have fullName field as readOnly text', () => {
      const fields = (Customers.fields || []) as any[]
      const fullNameField = fields.find(f => 'name' in f && f.name === 'fullName')
      
      // fullName is now set directly by the event processor, no hook needed
      expect(fullNameField?.type).toBe('text')
      expect((fullNameField?.admin as any)?.readOnly).toBe(true)
    })

    test('fullName should be set by event processor (no client-side hook)', () => {
      const fields = (Customers.fields || []) as any[]
      const fullNameField = fields.find(f => 'name' in f && f.name === 'fullName')
      
      // The hook was removed - fullName is now populated by Python event processor
      // This is intentional as data comes from customer.changed.v1 events
      expect(fullNameField?.hooks?.beforeChange).toBeUndefined()
    })

    test('should have relationships to applications and conversations', () => {
      const fields = (Customers.fields || []) as any[]
      const appsField = fields.find(f => 'name' in f && f.name === 'applications')
      const convsField = fields.find(f => 'name' in f && f.name === 'conversations')
      
      expect(appsField?.type).toBe('relationship')
      expect(appsField?.relationTo).toBe('applications')
      expect(appsField?.hasMany).toBe(true)
      
      expect(convsField?.type).toBe('relationship')
      expect(convsField?.relationTo).toBe('conversations')
      expect(convsField?.hasMany).toBe(true)
    })
  })

  describe('Conversations Collection', () => {
    test('should have correct slug and configuration', () => {
      expect(Conversations.slug).toBe('conversations')
      expect(Conversations.admin?.group).toBe('Supervisor Dashboard')
      expect(Conversations.admin?.useAsTitle).toBe('applicationNumber')
    })

    test('should have utterances array instead of messages', () => {
      const fields = (Conversations.fields || []) as any[]
      const utterancesField = fields.find(f => 'name' in f && f.name === 'utterances')
      const messagesField = fields.find(f => 'name' in f && f.name === 'messages')
      
      expect(utterancesField).toBeDefined()
      expect(utterancesField?.type).toBe('array')
      expect((utterancesField?.admin as any)?.readOnly).toBe(true)
      expect(messagesField).toBeUndefined()
    })

    test('should have conversation relationships', () => {
      const fields = (Conversations.fields || []) as any[]
      const customerField = fields.find(f => 'name' in f && f.name === 'customerId')
      const applicationField = fields.find(f => 'name' in f && f.name === 'applicationId')
      
      expect(customerField?.type).toBe('relationship')
      expect(customerField?.relationTo).toBe('customers')
      expect(applicationField?.type).toBe('relationship')
      expect(applicationField?.relationTo).toBe('applications')
    })

    test('should have proper utterance structure', () => {
      const fields = (Conversations.fields || []) as any[]
      const utterancesField = fields.find(f => 'name' in f && f.name === 'utterances')
      
      expect(utterancesField?.fields).toBeDefined()
      
      const utteranceFields = (utterancesField?.fields || []) as any[]
      const fieldNames = utteranceFields.map((f: any) => f.name)
      
      expect(fieldNames).toContain('username')
      expect(fieldNames).toContain('utterance')
      expect(fieldNames).toContain('rationale')
      expect(fieldNames).toContain('createdAt')
      expect(fieldNames).toContain('answerInputType')
      expect(fieldNames).toContain('additionalData')
    })

    test('should have conversation summary fields', () => {
      const fields = (Conversations.fields || []) as any[]
      const purposeField = fields.find(f => 'name' in f && f.name === 'purpose')
      const factsField = fields.find(f => 'name' in f && f.name === 'facts')
      
      expect(purposeField?.type).toBe('text')
      expect((purposeField?.admin as any)?.readOnly).toBe(true)
      expect(factsField?.type).toBe('array')
      expect((factsField?.admin as any)?.readOnly).toBe(true)
    })
  })

  describe('Users Collection', () => {
    test('should have all staff roles (admin, supervisor, operations, readonly)', () => {
      const fields = (Users.fields || []) as any[]
      const roleField = fields.find(f => 'name' in f && f.name === 'role')
      
      expect(roleField?.type).toBe('select')
      expect(roleField?.defaultValue).toBe('readonly')
      
      // Roles are now objects with label/value
      const options = roleField?.options as Array<{ label: string; value: string }>
      const roleValues = options?.map((opt) => opt.value) || []
      
      expect(roleValues).toContain('admin')
      expect(roleValues).toContain('supervisor')
      expect(roleValues).toContain('operations')
      expect(roleValues).toContain('readonly')
    })

    test('should have proper access control', () => {
      const mockAdminRequest = createMockPayloadRequest({ role: 'admin' })
      const mockSupervisorRequest = createMockPayloadRequest({ role: 'supervisor', id: 'user123' })
      const mockOtherUserRequest = createMockPayloadRequest({ role: 'supervisor', id: 'user456' })
      
      // Admin can create users
      expect(Users.access?.create?.(mockAdminRequest as any)).toBe(true)
      expect(Users.access?.create?.(mockSupervisorRequest as any)).toBe(false)

      // Users can read their own data, admins can read all
      expect(Users.access?.read?.({ ...mockAdminRequest, id: 'any-id' } as any)).toBe(true)
      expect(Users.access?.read?.({ ...mockSupervisorRequest, id: 'user123' } as any)).toBe(true)
      expect(Users.access?.read?.({ ...mockSupervisorRequest, id: 'user456' } as any)).toBe(false)
    })
  })

  describe('Users Collection - Security (C2 Remediation)', () => {
    const fields = (Users.fields || []) as any[]
    const roleField = fields.find(f => 'name' in f && f.name === 'role')

    test('the role field has an access.update function defined', () => {
      expect(roleField?.access?.update).toBeDefined()
      expect(typeof roleField?.access?.update).toBe('function')
    })

    test('role field access.update returns true for admin users', () => {
      const result = roleField?.access?.update?.({
        req: { user: { role: 'admin' } },
      } as any)
      expect(result).toBe(true)
    })

    test('role field access.update returns false for supervisor users', () => {
      const result = roleField?.access?.update?.({
        req: { user: { role: 'supervisor' } },
      } as any)
      expect(result).toBe(false)
    })

    test('role field access.update returns false for operations users', () => {
      const result = roleField?.access?.update?.({
        req: { user: { role: 'operations' } },
      } as any)
      expect(result).toBe(false)
    })

    test('role field access.update returns false for readonly users', () => {
      const result = roleField?.access?.update?.({
        req: { user: { role: 'readonly' } },
      } as any)
      expect(result).toBe(false)
    })

    test('role field access.update returns false for null/undefined user', () => {
      expect(
        roleField?.access?.update?.({ req: { user: null } } as any),
      ).toBe(false)
      expect(
        roleField?.access?.update?.({ req: { user: undefined } } as any),
      ).toBe(false)
    })

    test('the default role is readonly', () => {
      expect(roleField?.defaultValue).toBe('readonly')
    })
  })

  describe('Media Collection', () => {
    test('should have basic upload configuration', () => {
      expect(Media.slug).toBe('media')
      expect(Media.upload).toBe(true)
      expect((Media.access?.read as any)?.()).toBe(true)
    })

    test('should have alt field for accessibility', () => {
      const fields = (Media.fields || []) as any[]
      const altField = fields.find(f => 'name' in f && f.name === 'alt')
      
      expect(altField?.type).toBe('text')
      expect(altField?.required).toBe(true)
    })
  })

  describe('ContactNotes Collection', () => {
    test('should have correct slug and admin configuration', () => {
      expect(ContactNotes.slug).toBe('contact-notes')
      expect(ContactNotes.admin?.group).toBe('Servicing')
      expect(ContactNotes.admin?.useAsTitle).toBe('subject')
    })

    test('should have all required entity relationship fields', () => {
      const fields = (ContactNotes.fields || []) as any[]

      const customerField = fields.find(f => 'name' in f && f.name === 'customer')
      expect(customerField?.type).toBe('relationship')
      expect(customerField?.relationTo).toBe('customers')
      expect(customerField?.required).toBe(true)
      expect(customerField?.index).toBe(true)

      const loanAccountField = fields.find(f => 'name' in f && f.name === 'loanAccount')
      expect(loanAccountField?.type).toBe('relationship')
      expect(loanAccountField?.relationTo).toBe('loan-accounts')
      expect(loanAccountField?.index).toBe(true)
      expect(loanAccountField?.required).toBeUndefined()

      const applicationField = fields.find(f => 'name' in f && f.name === 'application')
      expect(applicationField?.type).toBe('relationship')
      expect(applicationField?.relationTo).toBe('applications')

      const conversationField = fields.find(f => 'name' in f && f.name === 'conversation')
      expect(conversationField?.type).toBe('relationship')
      expect(conversationField?.relationTo).toBe('conversations')
    })

    test('should have channel select with supported channel options', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const channelField = fields.find(f => 'name' in f && f.name === 'channel')

      expect(channelField?.type).toBe('select')
      expect(channelField?.required).toBe(true)

      const options = channelField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []

      expect(values).toContain('phone')
      expect(values).toContain('email')
      expect(values).toContain('sms')
      expect(values).toContain('internal')
      expect(values).toContain('system')
      expect(values).toHaveLength(5)
    })

    test('should have topic select with supported topic options', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const topicField = fields.find(f => 'name' in f && f.name === 'topic')

      expect(topicField?.type).toBe('select')
      expect(topicField?.required).toBe(true)

      const options = topicField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []
      expect(values).toEqual([
        'general_enquiry',
        'complaint',
        'escalation',
        'internal_note',
        'account_update',
        'collections',
      ])
    })

    test('should have subject field with maxLength 200', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const subjectField = fields.find(f => 'name' in f && f.name === 'subject')

      expect(subjectField?.type).toBe('text')
      expect(subjectField?.required).toBe(true)
      expect(subjectField?.maxLength).toBe(200)
    })

    test('should have json content field', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const contentField = fields.find(f => 'name' in f && f.name === 'content')

      expect(contentField?.type).toBe('json')
      expect(contentField?.required).toBe(true)
    })

    test('should have priority select with default normal', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const priorityField = fields.find(f => 'name' in f && f.name === 'priority')

      expect(priorityField?.type).toBe('select')
      expect(priorityField?.defaultValue).toBe('normal')

      const options = priorityField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []
      expect(values).toEqual(['low', 'normal', 'high', 'urgent'])
    })

    test('should have sentiment select with default neutral', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const sentimentField = fields.find(f => 'name' in f && f.name === 'sentiment')

      expect(sentimentField?.type).toBe('select')
      expect(sentimentField?.defaultValue).toBe('neutral')

      const options = sentimentField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []
      expect(values).toEqual(['positive', 'neutral', 'negative', 'escalation'])
    })

    test('should have createdBy relationship field (read-only in admin)', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const createdByField = fields.find(f => 'name' in f && f.name === 'createdBy')

      expect(createdByField?.type).toBe('relationship')
      expect(createdByField?.relationTo).toBe('users')
      expect(createdByField?.required).toBe(true)
      expect((createdByField?.admin as any)?.readOnly).toBe(true)
    })

    test('should have amendsNote self-referential relationship with index', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const amendsNoteField = fields.find(f => 'name' in f && f.name === 'amendsNote')

      expect(amendsNoteField?.type).toBe('relationship')
      expect(amendsNoteField?.relationTo).toBe('contact-notes')
      expect(amendsNoteField?.index).toBe(true)
    })

    test('should have status field with active default and index', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const statusField = fields.find(f => 'name' in f && f.name === 'status')

      expect(statusField?.type).toBe('select')
      expect(statusField?.defaultValue).toBe('active')
      expect(statusField?.required).toBe(true)
      expect(statusField?.index).toBe(true)

      const options = statusField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []
      expect(values).toEqual(['active', 'amended'])
    })

    test('should have timestamps enabled', () => {
      expect(ContactNotes.timestamps).toBe(true)
    })
  })

  describe('ContactNotes Access Control', () => {
    test('read: allows all authenticated users', () => {
      expect(ContactNotes.access?.read?.(createMockPayloadRequest({ role: 'admin' }) as any)).toBe(true)
      expect(ContactNotes.access?.read?.(createMockPayloadRequest({ role: 'supervisor' }) as any)).toBe(true)
      expect(ContactNotes.access?.read?.(createMockPayloadRequest({ role: 'operations' }) as any)).toBe(true)
      expect(ContactNotes.access?.read?.(createMockPayloadRequest({ role: 'readonly' }) as any)).toBe(true)
    })

    test('read: denies unauthenticated requests', () => {
      expect(ContactNotes.access?.read?.({ req: { user: null } } as any)).toBe(false)
    })

    test('create: allows admin, supervisor, operations', () => {
      expect(ContactNotes.access?.create?.(createMockPayloadRequest({ role: 'admin' }) as any)).toBe(true)
      expect(ContactNotes.access?.create?.(createMockPayloadRequest({ role: 'supervisor' }) as any)).toBe(true)
      expect(ContactNotes.access?.create?.(createMockPayloadRequest({ role: 'operations' }) as any)).toBe(true)
    })

    test('create: denies readonly and unauthenticated', () => {
      expect(ContactNotes.access?.create?.(createMockPayloadRequest({ role: 'readonly' }) as any)).toBe(false)
      expect(ContactNotes.access?.create?.({ req: { user: null } } as any)).toBe(false)
    })

    test('update: allows admin, supervisor, operations', () => {
      expect(ContactNotes.access?.update?.(createMockPayloadRequest({ role: 'admin' }) as any)).toBe(true)
      expect(ContactNotes.access?.update?.(createMockPayloadRequest({ role: 'supervisor' }) as any)).toBe(true)
      expect(ContactNotes.access?.update?.(createMockPayloadRequest({ role: 'operations' }) as any)).toBe(true)
    })

    test('update: denies readonly and unauthenticated', () => {
      expect(ContactNotes.access?.update?.(createMockPayloadRequest({ role: 'readonly' }) as any)).toBe(false)
      expect(ContactNotes.access?.update?.({ req: { user: null } } as any)).toBe(false)
    })

    test('delete: allows admin only', () => {
      expect(ContactNotes.access?.delete?.(createMockPayloadRequest({ role: 'admin' }) as any)).toBe(true)
      expect(ContactNotes.access?.delete?.(createMockPayloadRequest({ role: 'supervisor' }) as any)).toBe(false)
      expect(ContactNotes.access?.delete?.(createMockPayloadRequest({ role: 'operations' }) as any)).toBe(false)
      expect(ContactNotes.access?.delete?.(createMockPayloadRequest({ role: 'readonly' }) as any)).toBe(false)
    })
  })

  describe('ContactNotes beforeChange Hook', () => {
    test('should auto-populate createdBy on create', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]
      expect(hook).toBeDefined()

      const data = { subject: 'Test note', channel: 'phone', topic: 'general_enquiry' }
      const req = { user: { id: 'user-abc-123' } }

      const result = await hook?.({ data, operation: 'create', req } as any)

      expect(result?.createdBy).toBe('user-abc-123')
    })

    test('should not overwrite createdBy if user is not present on create', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]

      const data = { subject: 'Test note' }
      const req = { user: null }

      const result = await hook?.({ data, operation: 'create', req } as any)

      expect(result?.createdBy).toBeUndefined()
    })

    test('should strip non-status fields on update (immutability)', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]

      const data = {
        status: 'amended',
        subject: 'Attempted edit',
        channel: 'internal',
        topic: 'complaint',
        content: 'Tampered content',
      }
      const req = { user: { id: 'user-abc-123' } }

      const result = await hook?.({ data, operation: 'update', req } as any)

      expect(result?.status).toBe('amended')
      expect(result?.subject).toBeUndefined()
      expect(result?.channel).toBeUndefined()
      expect(result?.topic).toBeUndefined()
      expect(result?.content).toBeUndefined()
    })

    test('should preserve status field on update', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]

      const data = { status: 'amended' }
      const req = { user: { id: 'user-abc-123' } }

      const result = await hook?.({ data, operation: 'update', req } as any)

      expect(result?.status).toBe('amended')
    })

    test('should throw when status is set to anything other than amended on update', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]
      const req = { user: { id: 'user-abc-123' } }

      await expect(
        hook?.({ data: { status: 'active' }, operation: 'update', req } as any),
      ).rejects.toThrow('may only be set to `amended`')
    })

    test('should not throw when status is absent from update payload', async () => {
      const hook = ContactNotes.hooks?.beforeChange?.[0]
      const req = { user: { id: 'user-abc-123' } }

      // An update with no status key (e.g., Payload internal operations) should pass silently
      await expect(
        hook?.({ data: {}, operation: 'update', req } as any),
      ).resolves.not.toThrow()
    })
  })

  describe('ContactNotes beforeValidate Hook', () => {
    test('accepts valid Tiptap content', async () => {
      const hook = ContactNotes.hooks?.beforeValidate?.[0]
      expect(hook).toBeDefined()

      await expect(
        hook?.({
          data: {
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
            },
          },
          operation: 'create',
        } as any),
      ).resolves.not.toThrow()
    })

    test('rejects invalid content payload shape', async () => {
      const hook = ContactNotes.hooks?.beforeValidate?.[0]

      await expect(
        hook?.({
          data: {
            content: { root: { children: [] } },
          },
          operation: 'create',
        } as any),
      ).rejects.toThrow('Invalid note content format')
    })
  })

  describe('ContactNotes Field: contactDirection', () => {
    test('should have contactDirection select field with inbound/outbound options', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const contactDirectionField = fields.find(f => 'name' in f && f.name === 'contactDirection')

      expect(contactDirectionField?.type).toBe('select')
      expect(contactDirectionField?.required).toBeUndefined()

      const options = contactDirectionField?.options as Array<{ label: string; value: string }>
      const values = options?.map(o => o.value) || []
      expect(values).toEqual(['inbound', 'outbound'])
    })

    test('should be conditionally shown for phone, email and SMS channels', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const contactDirectionField = fields.find(f => 'name' in f && f.name === 'contactDirection')
      const condition = contactDirectionField?.admin?.condition

      expect(condition).toBeDefined()
      expect(condition?.({ channel: 'phone' }, {}, {} as any)).toBe(true)
      expect(condition?.({ channel: 'email' }, {}, {} as any)).toBe(true)
      // SMS has a direction (inbound/outbound) so it also shows the field
      expect(condition?.({ channel: 'sms' }, {}, {} as any)).toBe(true)
    })

    test('should be hidden for non-communication channels', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const contactDirectionField = fields.find(f => 'name' in f && f.name === 'contactDirection')
      const condition = contactDirectionField?.admin?.condition

      expect(condition?.({ channel: 'internal' }, {}, {} as any)).toBe(false)
      expect(condition?.({ channel: 'system' }, {}, {} as any)).toBe(false)
    })

    test('should handle undefined channel without throwing', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const contactDirectionField = fields.find(f => 'name' in f && f.name === 'contactDirection')
      const condition = contactDirectionField?.admin?.condition

      expect(() => condition?.({}, {}, {} as any)).not.toThrow()
      expect(condition?.({}, {}, {} as any)).toBeFalsy()
      expect(condition?.({ channel: undefined }, {}, {} as any)).toBeFalsy()
    })
  })

  describe('ContactNotes Field: createdAt index', () => {
    test('should define createdAt field with index: true for timeline sort performance', () => {
      const fields = (ContactNotes.fields || []) as any[]
      const createdAtField = fields.find(f => 'name' in f && f.name === 'createdAt')

      expect(createdAtField).toBeDefined()
      expect(createdAtField?.type).toBe('date')
      expect(createdAtField?.index).toBe(true)
      expect((createdAtField?.admin as any)?.readOnly).toBe(true)
    })
  })
}) 