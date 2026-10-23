'use client'

import React, { useState } from 'react'
import type { ReportParameter } from '@/lib/schemas/reports'
import { formatCalendarDate } from '@/lib/formatters'
import { RANGE_PRESETS, presetFor } from '@/lib/reports/periods'
import styles from './styles.module.css'

export interface RangePickerProps {
  idPrefix: string
  from: ReportParameter
  to: ReportParameter
  fromValue: string
  toValue: string
  today: string
  errors: Record<string, string>
  inputId: (name: string) => string
  onChange: (from: string, to: string) => void
}

/**
 * A report's period: preset ranges as a radio group, and "Custom" for two
 * date fields. A range that matches no preset opens as custom.
 */
export function RangePicker({
  idPrefix,
  from,
  to,
  fromValue,
  toValue,
  today,
  errors,
  inputId,
  onChange,
}: RangePickerProps) {
  const matched = presetFor(fromValue, toValue, today)
  const [custom, setCustom] = useState(!matched)
  const selected = custom ? 'custom' : (matched?.key ?? 'custom')
  const showDates = selected === 'custom' || Boolean(errors[from.name] || errors[to.name])
  const name = `${idPrefix}-range`

  return (
    <fieldset className={styles.rangePicker}>
      <legend className={styles.fieldLabel}>Period</legend>
      <div className={styles.segmented} role="presentation">
        {RANGE_PRESETS.map((preset) => (
          <label key={preset.key} className={styles.segment}>
            <input
              type="radio"
              name={name}
              value={preset.key}
              checked={selected === preset.key}
              onChange={() => {
                setCustom(false)
                const range = preset.range(today)
                onChange(range.from, range.to)
              }}
            />
            <span>{preset.label}</span>
          </label>
        ))}
        <label className={styles.segment}>
          <input
            type="radio"
            name={name}
            value="custom"
            checked={selected === 'custom'}
            onChange={() => setCustom(true)}
          />
          <span>Custom</span>
        </label>
      </div>
      {showDates && (
        <div className={styles.paramGrid}>
          {[
            { param: from, value: fromValue, set: (v: string) => onChange(v, toValue) },
            { param: to, value: toValue, set: (v: string) => onChange(fromValue, v) },
          ].map(({ param, value, set }) => {
            const id = inputId(param.name)
            const errorId = errors[param.name] ? `${id}-error` : undefined
            return (
              <div key={param.name} className={styles.field}>
                <label htmlFor={id} className={styles.fieldLabel}>
                  {param.label}
                </label>
                {errorId && (
                  <p id={errorId} className={styles.fieldError}>
                    <span className={styles.visuallyHidden}>Error: </span>
                    {errors[param.name]}
                  </p>
                )}
                <input
                  id={id}
                  type="date"
                  className={`${styles.input} ${errorId ? styles.inputInvalid : ''}`}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  aria-describedby={errorId}
                  aria-invalid={errorId ? true : undefined}
                />
              </div>
            )
          })}
        </div>
      )}
      {!showDates && (
        <p className={styles.hint}>
          {formatCalendarDate(fromValue)} to {formatCalendarDate(toValue)}
        </p>
      )}
    </fieldset>
  )
}
