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
// ECL Config Schedule Schema
// =============================================================================

export const ScheduleConfigChangeSchema = z.object({
  parameter: z.string().optional(),
  fieldName: z.string().optional(),
  bucket: z.string().optional(),
  newValue: z.union([z.number(), z.string()]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  createdBy: z.string().optional(),
  reason: z.string().max(1000).optional(),
}).refine((data) => data.parameter || data.fieldName, {
  message: 'Either parameter or fieldName is required',
})

// =============================================================================
// Investigation Schemas
// =============================================================================

export const BatchQuerySchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1, 'At least one account ID is required').max(100, 'Maximum 100 accounts per request'),
})

export const SampleQuerySchema = z.object({
  bucket: z.string().optional(),
  eclMin: z.string().optional(),
  eclMax: z.string().optional(),
  carryingAmountMin: z.string().optional(),
  carryingAmountMax: z.string().optional(),
  sampleSize: z.number().int().min(1).max(500).optional(),
  seed: z.string().optional(),
  allowFullScan: z.boolean().optional(),
})

// =============================================================================
// ECL Recalculation Schemas
// =============================================================================

export const BulkRecalcSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1, 'At least one account ID is required').max(100, 'Maximum 100 accounts per request'),
  triggeredBy: z.string().optional(),
})

export const PortfolioRecalcSchema = z.object({
  triggeredBy: z.string().optional(),
  batchSize: z.number().int().min(1).max(10000).optional(),
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
