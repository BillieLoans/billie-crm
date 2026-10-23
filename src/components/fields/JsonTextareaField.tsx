'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONFieldClientComponent } from 'payload'
import { TextareaInput, useField } from '@payloadcms/ui'

const format = (value: unknown): string =>
  value === undefined || value === null ? '' : JSON.stringify(value, null, 2)

/**
 * A JSON field edited as plain text in a monospace textarea, in place of
 * Payload's Monaco editor. Monaco loads from cdn.jsdelivr.net, which the
 * admin's Content-Security-Policy blocks (it rendered as an empty box), and
 * is hard to use with a keyboard or a screen reader. The text is parsed as it
 * is typed; while it does not parse, the error shows under the field and the
 * document cannot be saved.
 */
export const JsonTextareaField: JSONFieldClientComponent = ({
  field,
  path: pathFromProps,
  readOnly,
  validate,
}) => {
  const { admin: { className, description } = {}, label, required } = field
  const [jsonError, setJsonError] = useState<string>()
  const memoizedValidate = useCallback(
    (value: unknown, options: Record<string, unknown>) => {
      if (jsonError) return `Not valid JSON: ${jsonError}`
      return typeof validate === 'function'
        ? validate(value as never, { ...options, required } as never)
        : true
    },
    [validate, required, jsonError],
  )
  const {
    customComponents: { Description, Error: ErrorComponent, Label } = {},
    disabled,
    path,
    setValue,
    showError,
    value,
  } = useField<unknown>({
    potentiallyStalePath: pathFromProps,
    validate: memoizedValidate as never,
  })
  const [text, setText] = useState(() => format(value))
  const ours = useRef<unknown>(value)

  // Follow changes made elsewhere (a reset, a version restore), not our own.
  useEffect(() => {
    if (value === ours.current) return
    ours.current = value
    setText(format(value))
    setJsonError(undefined)
  }, [value])

  return (
    <TextareaInput
      AfterInput={
        jsonError ? (
          <p className="json-textarea__error" role="status">
            Not valid JSON: {jsonError}
          </p>
        ) : null
      }
      className={['mono-textarea', className].filter(Boolean).join(' ')}
      Description={Description}
      description={description}
      Error={ErrorComponent}
      Label={Label}
      label={label}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        try {
          const parsed = next.trim() ? JSON.parse(next) : null
          ours.current = parsed
          setValue(parsed)
          setJsonError(undefined)
        } catch (error) {
          ours.current = next
          setValue(next)
          setJsonError(error instanceof Error ? error.message : 'it does not parse')
        }
      }}
      path={path}
      readOnly={readOnly || disabled}
      required={required}
      rows={Math.min(24, Math.max(6, text.split('\n').length + 1))}
      showError={showError}
      value={text}
    />
  )
}
