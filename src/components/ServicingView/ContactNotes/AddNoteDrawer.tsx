'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { useCreateNote } from '@/hooks/mutations/useCreateNote'
import { useAmendNote } from '@/hooks/mutations/useAmendNote'
import { type ContactNoteData } from '@/hooks/queries/useContactNotes'
import { type LoanAccountData } from '@/hooks/queries/useCustomer'
import { renderNoteContent, textToTiptapDoc } from '@/lib/tiptap'
import { getAccountStatusLabel } from './labels'
import styles from './styles.module.css'

// =============================================================================
// Constants
// =============================================================================

const NOTE_TYPES = [
  { value: 'phone_inbound', label: 'Inbound Call' },
  { value: 'phone_outbound', label: 'Outbound Call' },
  { value: 'email_inbound', label: 'Email Received' },
  { value: 'email_outbound', label: 'Email Sent' },
  { value: 'sms', label: 'SMS' },
  { value: 'general_enquiry', label: 'General Enquiry' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'internal_note', label: 'Internal Note' },
  { value: 'account_update', label: 'Account Update' },
  { value: 'collections', label: 'Collections Activity' },
] as const

/** Note types that require the Direction field */
const COMMUNICATION_TYPES = new Set([
  'phone_inbound',
  'phone_outbound',
  'email_inbound',
  'email_outbound',
  'sms',
])

/** Auto-fill direction value based on note type */
const DIRECTION_DEFAULT: Record<string, string> = {
  phone_inbound: 'inbound',
  phone_outbound: 'outbound',
  email_inbound: 'inbound',
  email_outbound: 'outbound',
}

// =============================================================================
// Schema
// =============================================================================

const addNoteSchema = z.object({
  noteType: z.string().min(1, 'Please select a note type'),
  contactDirection: z.string().optional(),
  loanAccount: z.string().optional(),
  subject: z
    .string()
    .min(1, 'Please enter a subject')
    .max(200, 'Subject must be 200 characters or less'),
  content: z.string().min(1, 'Please enter note content'),
  priority: z.string().optional(),
  sentiment: z.string().optional(),
})

type AddNoteFormValues = z.infer<typeof addNoteSchema>

// =============================================================================
// Component
// =============================================================================

export interface AddNoteDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the new note's Payload document ID after successful creation */
  onSuccess: (noteId: string) => void
  customerId: string
  customerName?: string
  /** The currently selected account loanAccountId for pre-fill */
  selectedAccountId: string | null
  accounts: LoanAccountData[]
  amendingNote?: ContactNoteData | null
}

/**
 * AddNoteDrawer — Slide-over form for creating a contact note.
 *
 * Features:
 * - Customer field (read-only, pre-filled)
 * - Linked Account dropdown (optional, pre-fills with selected account)
 * - Conditional Direction field for phone/email note types
 * - Tiptap rich-text editor with formatting toolbar
 * - "More" expander for Priority and Sentiment
 * - Cmd+Enter to submit
 * - Focus management: Note Type focused on open
 */
export const AddNoteDrawer: React.FC<AddNoteDrawerProps> = ({
  isOpen,
  onClose,
  onSuccess,
  customerId,
  customerName,
  selectedAccountId,
  accounts,
  amendingNote = null,
}) => {
  const [showMore, setShowMore] = useState(false)
  const [contentJSON, setContentJSON] = useState<object | null>(null)
  const noteTypeRef = useRef<HTMLSelectElement | null>(null)
  const createNoteMutation = useCreateNote(customerId)
  const amendNoteMutation = useAmendNote(customerId)
  const isAmending = amendingNote != null
  const isPending = isAmending ? amendNoteMutation.isPending : createNoteMutation.isPending

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<AddNoteFormValues>({
    resolver: zodResolver(addNoteSchema),
    defaultValues: {
      noteType: '',
      contactDirection: '',
      loanAccount: '',
      subject: '',
      content: '',
      priority: 'normal',
      sentiment: 'neutral',
    },
  })

  const noteType = watch('noteType')
  const showDirection = COMMUNICATION_TYPES.has(noteType)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Underline,
    ],
    immediatelyRender: false,
    editable: !isPending,
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText().trim()
      setContentJSON(ed.getJSON())
      setValue('content', text, { shouldDirty: true, shouldValidate: true })
    },
  })

  useEffect(() => {
    if (editor) {
      editor.setEditable(!isPending)
    }
  }, [isPending, editor])

  useEffect(() => {
    register('content')
  }, [register])

  useEffect(() => {
    if (showDirection) {
      setValue('contactDirection', DIRECTION_DEFAULT[noteType] ?? '')
    } else {
      setValue('contactDirection', '')
    }
  }, [noteType, showDirection, setValue])

  useEffect(() => {
    if (isOpen) {
      const prefilledAccountId = (() => {
        if (amendingNote?.loanAccount) {
          if (typeof amendingNote.loanAccount === 'string') return amendingNote.loanAccount
          if (typeof amendingNote.loanAccount === 'object' && 'id' in amendingNote.loanAccount) {
            return amendingNote.loanAccount.id
          }
        }
        return selectedAccountId
          ? (accounts.find((a) => a.loanAccountId === selectedAccountId)?.id ?? '')
          : ''
      })()
      const sourcePlainText = amendingNote ? renderNoteContent(amendingNote.content).plainText : ''
      const sourceContent = (() => {
        if (!amendingNote) return null
        if (typeof amendingNote.content === 'object' && amendingNote.content) return amendingNote.content
        if (typeof amendingNote.content === 'string') return textToTiptapDoc(amendingNote.content)
        return null
      })()

      reset({
        noteType: amendingNote?.noteType ?? '',
        contactDirection: amendingNote?.contactDirection ?? '',
        loanAccount: prefilledAccountId,
        subject: amendingNote?.subject ?? '',
        content: sourcePlainText,
        priority: amendingNote?.priority ?? 'normal',
        sentiment: amendingNote?.sentiment ?? 'neutral',
      })
      setContentJSON(sourceContent as object | null)
      if (sourceContent) {
        editor?.commands.setContent(sourceContent)
      } else {
        editor?.commands.clearContent()
      }
      setShowMore(!!amendingNote && (amendingNote.priority !== 'normal' || amendingNote.sentiment !== 'neutral'))

      const timer = setTimeout(() => noteTypeRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, selectedAccountId, accounts, reset, editor, amendingNote])

  const onSubmit = useCallback(
    async (values: AddNoteFormValues) => {
      try {
        const payload = {
          customer: customerId,
          noteType: values.noteType,
          subject: values.subject,
          content: contentJSON ?? textToTiptapDoc(values.content),
          ...(values.loanAccount ? { loanAccount: values.loanAccount } : {}),
          ...(showDirection && values.contactDirection
            ? { contactDirection: values.contactDirection }
            : {}),
          priority: values.priority || 'normal',
          sentiment: values.sentiment || 'neutral',
        }
        const result = isAmending
          ? await amendNoteMutation.mutateAsync({
            originalNoteId: amendingNote.id,
            ...payload,
          })
          : await createNoteMutation.mutateAsync(payload)

        onClose()
        onSuccess(result.doc.id)
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          'retryContext' in error &&
          (error as { retryContext: { amendmentNoteId: string } }).retryContext?.amendmentNoteId
        ) {
          const ctx = (error as { retryContext: { amendmentNoteId: string } }).retryContext
          onClose()
          onSuccess(ctx.amendmentNoteId)
          return
        }
      }
    },
    [
      customerId,
      showDirection,
      onClose,
      onSuccess,
      contentJSON,
      isAmending,
      amendingNote,
      createNoteMutation,
      amendNoteMutation,
    ],
  )

  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit(onSubmit)()
      }
    },
    [handleSubmit, onSubmit],
  )

  const { ref: noteTypeRegRef, ...noteTypeRest } = register('noteType')

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title={isAmending ? 'Amend Note' : 'Add Note'}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={handleFormKeyDown}
        className={styles.addNoteForm}
        data-testid="add-note-form"
      >
        {/* Customer — read-only display */}
        <div className={styles.addNoteField}>
          <label className={styles.addNoteLabel}>Customer</label>
          <div className={styles.addNoteReadOnly} data-testid="customer-display">
            {customerName || customerId}
          </div>
        </div>

        {isAmending && (
          <div className={styles.amendWarningBanner} data-testid="amend-warning-banner">
            You are creating an amendment. The original note stays in the audit trail and will be
            marked as amended.
          </div>
        )}

        {/* Note Type */}
        <div className={styles.addNoteField}>
          <label htmlFor="noteType" className={styles.addNoteLabel}>
            Note Type <span className={styles.required}>*</span>
          </label>
          <select
            id="noteType"
            className={styles.addNoteSelect}
            {...noteTypeRest}
            ref={(el) => {
              noteTypeRegRef(el)
              noteTypeRef.current = el
            }}
            disabled={isPending}
            data-testid="note-type-select"
          >
            <option value="">Select a note type...</option>
            {NOTE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {errors.noteType && (
            <p className={styles.addNoteError} role="alert" data-testid="note-type-error">
              {errors.noteType.message}
            </p>
          )}
        </div>

        {/* Direction — only for phone/email/sms types */}
        {showDirection && (
          <div className={styles.addNoteField} data-testid="direction-field">
            <label htmlFor="contactDirection" className={styles.addNoteLabel}>
              Direction
            </label>
            <select
              id="contactDirection"
              className={styles.addNoteSelect}
              {...register('contactDirection')}
              disabled={isPending}
              data-testid="contact-direction-select"
            >
              <option value="">Select direction...</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </div>
        )}

        {/* Linked Account */}
        <div className={styles.addNoteField}>
          <label htmlFor="loanAccount" className={styles.addNoteLabel}>
            Linked Account
          </label>
          <select
            id="loanAccount"
            className={styles.addNoteSelect}
            {...register('loanAccount')}
            disabled={isPending}
            data-testid="linked-account-select"
          >
            <option value="">No account (general enquiry)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} ({getAccountStatusLabel(a.accountStatus)})
              </option>
            ))}
          </select>
        </div>

        {/* Subject */}
        <div className={styles.addNoteField}>
          <label htmlFor="subject" className={styles.addNoteLabel}>
            Subject <span className={styles.required}>*</span>
          </label>
          <input
            id="subject"
            type="text"
            className={styles.addNoteInput}
            {...register('subject')}
            maxLength={200}
            disabled={isPending}
            placeholder="Brief description of the interaction"
            data-testid="subject-input"
          />
          {errors.subject && (
            <p className={styles.addNoteError} role="alert" data-testid="subject-error">
              {errors.subject.message}
            </p>
          )}
        </div>

        {/* Content (Tiptap rich-text editor) */}
        <div className={styles.addNoteField}>
          <label className={styles.addNoteLabel}>
            Content <span className={styles.required}>*</span>
          </label>
          <div className={styles.editorWrapper}>
            <div className={styles.editorToolbar} data-testid="content-toolbar" aria-label="Formatting toolbar">
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('bold') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => editor?.chain().focus().toggleBold().run()}
                disabled={isPending}
                data-testid="toolbar-bold"
                aria-label="Bold"
                aria-pressed={editor?.isActive('bold')}
              >
                B
              </button>
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('italic') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                disabled={isPending}
                data-testid="toolbar-italic"
                aria-label="Italic"
                aria-pressed={editor?.isActive('italic')}
              >
                I
              </button>
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('underline') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                disabled={isPending}
                data-testid="toolbar-underline"
                aria-label="Underline"
                aria-pressed={editor?.isActive('underline')}
              >
                U
              </button>
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('bulletList') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                disabled={isPending}
                data-testid="toolbar-bulleted-list"
                aria-label="Bulleted list"
                aria-pressed={editor?.isActive('bulletList')}
              >
                • List
              </button>
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('orderedList') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                disabled={isPending}
                data-testid="toolbar-numbered-list"
                aria-label="Numbered list"
                aria-pressed={editor?.isActive('orderedList')}
              >
                1. List
              </button>
              <button
                type="button"
                className={`${styles.editorToolbarBtn} ${editor?.isActive('link') ? styles.editorToolbarBtnActive : ''}`}
                onClick={() => {
                  if (!editor) return
                  const { from, to } = editor.state.selection
                  if (from === to) return
                  editor.chain().focus().toggleLink({ href: 'https://' }).run()
                }}
                disabled={isPending}
                data-testid="toolbar-link"
                aria-label="Insert link"
                aria-pressed={editor?.isActive('link')}
              >
                Link
              </button>
            </div>
            <EditorContent
              editor={editor}
              className={styles.editorContent}
              data-testid="content-editor"
            />
          </div>
          {errors.content && (
            <p className={styles.addNoteError} role="alert" data-testid="content-error">
              {errors.content.message}
            </p>
          )}
        </div>

        {/* More expander — Priority and Sentiment */}
        <div className={styles.addNoteMore}>
          <button
            type="button"
            className={styles.addNoteMoreBtn}
            onClick={() => setShowMore((s) => !s)}
            aria-expanded={showMore}
            data-testid="more-expander-btn"
          >
            {showMore ? '▲ Less' : '▾ More'}
          </button>

          {showMore && (
            <div className={styles.addNoteMoreFields} data-testid="more-fields">
              <div className={styles.addNoteInlineField}>
                <label htmlFor="priority" className={styles.addNoteInlineLabel}>
                  Priority
                </label>
                <select
                  id="priority"
                  className={styles.addNoteSelect}
                  {...register('priority')}
                  disabled={isPending}
                  data-testid="priority-select"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className={styles.addNoteInlineField}>
                <label htmlFor="sentiment" className={styles.addNoteInlineLabel}>
                  Sentiment
                </label>
                <select
                  id="sentiment"
                  className={styles.addNoteSelect}
                  {...register('sentiment')}
                  disabled={isPending}
                  data-testid="sentiment-select"
                >
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                  <option value="escalation">Escalation</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={styles.addNoteActions}>
          <button
            type="button"
            className={styles.addNoteCancelBtn}
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.addNoteSubmitBtn}
            disabled={isPending}
            data-testid="add-note-submit-btn"
          >
            {isPending ? 'Saving...' : 'Submit'}
          </button>
        </div>
      </form>
    </ContextDrawer>
  )
}
