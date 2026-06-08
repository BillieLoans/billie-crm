'use client'

import React from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import {
  useAccountConductAssessment,
  useServiceabilityAssessment,
  usePostIdentityRiskAssessment,
} from '@/hooks/queries/useAssessments'
import { AssessmentContent, type AssessmentType } from '../AssessmentDetailView'
import styles from './styles.module.css'

interface AssessmentDrawerProps {
  conversationId: string
  type: AssessmentType | null
  onClose: () => void
}

const TITLE_MAP: Record<AssessmentType, string> = {
  'account-conduct': 'Account Conduct Assessment',
  'serviceability': 'Serviceability Assessment',
  'post-identity-risk': 'Post-Identity Risk Check',
}

export function AssessmentDrawer({ conversationId, type, onClose }: AssessmentDrawerProps) {
  // All three hooks always run, but the inactive ones short-circuit on `enabled: false`.
  const conductQuery = useAccountConductAssessment(
    type === 'account-conduct' ? conversationId : undefined,
  )
  const serviceabilityQuery = useServiceabilityAssessment(
    type === 'serviceability' ? conversationId : undefined,
  )
  const pirQuery = usePostIdentityRiskAssessment(
    type === 'post-identity-risk' ? conversationId : undefined,
  )

  const query =
    type === 'account-conduct'
      ? conductQuery
      : type === 'serviceability'
        ? serviceabilityQuery
        : type === 'post-identity-risk'
          ? pirQuery
          : null

  const title = type ? TITLE_MAP[type] : ''
  const isLoading = query?.isLoading ?? false
  const error = query?.error
  const assessment = query?.data

  return (
    <ContextDrawer isOpen={type !== null} onClose={onClose} title={title} maxWidth="880px">
      {type && (
        <div className={styles.body}>
          {isLoading && (
            <div className={styles.skeletonWrap}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={styles.skeleton} aria-hidden="true" />
              ))}
            </div>
          )}

          {!isLoading && (assessment === null || error) && (
            <div className={styles.notAvailable}>
              <p>
                {error instanceof Error
                  ? error.message
                  : 'No assessment data available for this conversation.'}
              </p>
            </div>
          )}

          {!isLoading && assessment && <AssessmentContent assessment={assessment} type={type} />}
        </div>
      )}
    </ContextDrawer>
  )
}
