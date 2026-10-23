'use client'

import React, { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import styles from './styles.module.css'

export interface SqlEditorProps {
  id: string
  value: string
  onChange: (value: string) => void
  /** Ctrl/Cmd+Enter: run the preview. */
  onRun?: () => void
  describedBy?: string
  label: string
  invalid?: boolean
}

/**
 * The report editor's SQL box: CodeMirror 6 with PostgreSQL highlighting,
 * bundled with the app (Payload's code field loads its editor from a CDN
 * the CSP blocks). Ctrl/Cmd+Enter runs the preview; Escape then Tab leaves
 * the editor (CodeMirror's own rule, so Tab can indent).
 */
export function SqlEditor({
  id,
  value,
  onChange,
  onRun,
  describedBy,
  label,
  invalid,
}: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The latest callbacks, read by the editor's handlers.
  const callbacks = useRef({ onChange, onRun })
  useEffect(() => {
    callbacks.current = { onChange, onRun }
  }, [onChange, onRun])

  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          id,
          'aria-label': label,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(invalid ? { 'aria-invalid': 'true' } : {}),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              callbacks.current.onRun?.()
              return true
            }
            return false
          },
        }),
      ],
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // The editor is created once; value changes from outside are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A value set from outside (a reload, Ask Claude) replaces the text.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className={styles.sqlEditor} data-testid="sql-editor" />
}
