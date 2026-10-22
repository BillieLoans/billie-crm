'use client'

import React from 'react'
import type { ReportParameter } from '@/lib/schemas/reports'
import styles from './styles.module.css'

export type ParameterValues = Record<string, string | boolean>

export interface ParameterFormProps {
  idPrefix: string
  parameters: ReportParameter[]
  values: ParameterValues
  errors: Record<string, string>
  onChange: (name: string, value: string | boolean) => void
}

/** The id of a parameter's input, used by the error summary's links. */
export function parameterInputId(idPrefix: string, name: string): string {
  return `${idPrefix}-param-${name}`
}

/**
 * A form generated from a report's parameter list. Each field has a visible
 * label, optional hint and an inline error tied to it with
 * `aria-describedby`; the view's error summary links to the same ids.
 */
export function ParameterForm({
  idPrefix,
  parameters,
  values,
  errors,
  onChange,
}: ParameterFormProps) {
  if (parameters.length === 0) return null
  return (
    <div className={styles.paramGrid}>
      {parameters.map((param) => {
        const id = parameterInputId(idPrefix, param.name)
        const hintId = param.help ? `${id}-hint` : undefined
        const errorId = errors[param.name] ? `${id}-error` : undefined
        const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
        const invalid = Boolean(errors[param.name])
        const value = values[param.name]

        if (param.type === 'boolean') {
          return (
            <div key={param.name} className={styles.field}>
              <div className={styles.checkboxRow}>
                <input
                  id={id}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={value === true}
                  onChange={(e) => onChange(param.name, e.target.checked)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                />
                <label htmlFor={id} className={styles.fieldLabel}>
                  {param.label}
                </label>
              </div>
              {param.help && (
                <p id={hintId} className={styles.hint}>
                  {param.help}
                </p>
              )}
              {errorId && (
                <p id={errorId} className={styles.fieldError}>
                  <span className={styles.visuallyHidden}>Error: </span>
                  {errors[param.name]}
                </p>
              )}
            </div>
          )
        }

        const stringValue = typeof value === 'string' ? value : ''
        return (
          <div key={param.name} className={styles.field}>
            <label htmlFor={id} className={styles.fieldLabel}>
              {param.label}
              {!param.required && <span className={styles.optional}> (optional)</span>}
            </label>
            {param.help && (
              <p id={hintId} className={styles.hint}>
                {param.help}
              </p>
            )}
            {errorId && (
              <p id={errorId} className={styles.fieldError}>
                <span className={styles.visuallyHidden}>Error: </span>
                {errors[param.name]}
              </p>
            )}
            {param.type === 'select' ? (
              <select
                id={id}
                className={`${styles.input} ${invalid ? styles.inputInvalid : ''}`}
                value={stringValue}
                onChange={(e) => onChange(param.name, e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                required={param.required}
              >
                {!param.required || !stringValue ? <option value="">Choose…</option> : null}
                {param.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className={`${styles.input} ${invalid ? styles.inputInvalid : ''}`}
                type={param.type === 'date' ? 'date' : 'text'}
                inputMode={
                  param.type === 'integer'
                    ? 'numeric'
                    : param.type === 'number'
                      ? 'decimal'
                      : undefined
                }
                value={stringValue}
                onChange={(e) => onChange(param.name, e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                required={param.required}
                autoComplete="off"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
