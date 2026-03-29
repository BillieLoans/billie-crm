import { z } from 'zod'

// =============================================================================
// ECL Config Schemas
// =============================================================================

export const UpdatePDRateSchema = z.object({
  bucket: z.string().min(1, 'Bucket is required'),
  rate: z.number().min(0).max(1, 'PD rate must be between 0 and 1'),
  updatedBy: z.string().optional(),
  reason: z.string().max(1000).optional(),
})

export const UpdateOverlaySchema = z.object({
  value: z.number().min(0).optional(),
  overlayMultiplier: z.string().optional(),
  updatedBy: z.string().optional(),
  reason: z.string().max(1000).optional(),
})

// =============================================================================
// Period Close Schemas
// =============================================================================

export const FinalizePeriodCloseSchema = z.object({
  previewId: z.string().min(1, 'Preview ID is required'),
  finalizedBy: z.string().optional(),
})

export const PeriodClosePreviewSchema = z.object({
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Period date must be YYYY-MM-DD format'),
  requestedBy: z.string().optional(),
})

export const AcknowledgeAnomalySchema = z.object({
  previewId: z.string().min(1, 'Preview ID is required'),
  anomalyId: z.string().min(1, 'Anomaly ID is required'),
  acknowledgedBy: z.string().optional(),
})

// =============================================================================
// Export Schemas
// =============================================================================

export const CreateExportJobSchema = z.object({
  exportType: z.string().min(1, 'Export type is required'),
  exportFormat: z.string().optional(),
  createdBy: z.string().optional(),
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  accountIds: z.array(z.string()).max(1000).optional(),
  dateRangeStart: z.string().optional(),
  dateRangeEnd: z.string().optional(),
  includeCalculationBreakdown: z.boolean().optional(),
})

// =============================================================================
// Upload Schemas
// =============================================================================

export const PresignedUrlSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required'),
  fileName: z.string().min(1, 'File name is required').max(255, 'File name too long'),
  contentType: z.enum([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ], { message: 'Unsupported file type. Allowed: PDF, JPEG, PNG, WebP, Excel, CSV.' }),
})
