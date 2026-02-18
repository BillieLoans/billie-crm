/**
 * gRPC Client for AccountingLedgerService
 *
 * Provides typed interfaces for interacting with the ledger service.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load proto file
const PROTO_PATH = path.resolve(__dirname, '../../proto/accounting_ledger.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const AccountingLedgerService = protoDescriptor.billie.ledger.v1.AccountingLedgerService

// =============================================================================
// Types
// =============================================================================

export enum TransactionType {
  TRANSACTION_TYPE_UNSPECIFIED = 'TRANSACTION_TYPE_UNSPECIFIED',
  DISBURSEMENT = 'DISBURSEMENT',
  ESTABLISHMENT_FEE = 'ESTABLISHMENT_FEE',
  REPAYMENT = 'REPAYMENT',
  LATE_FEE = 'LATE_FEE',
  DISHONOUR_FEE = 'DISHONOUR_FEE',
  FEE_WAIVER = 'FEE_WAIVER',
  ADJUSTMENT = 'ADJUSTMENT',
  WRITE_OFF = 'WRITE_OFF',
}

export interface Transaction {
  transactionId: string
  loanAccountId: string
  type: TransactionType
  transactionDate: { seconds: string; nanos: number }
  effectiveDate: string
  principalDelta: string
  feeDelta: string
  principalAfter: string
  feeAfter: string
  totalDelta: string
  totalAfter: string
  description: string
  referenceType: string
  referenceId: string
  metadata: Record<string, string>
  createdBy: string
  createdAt: { seconds: string; nanos: number }
  portfolioEntryId: string
}

export interface GetTransactionsRequest {
  loanAccountId: string
  limit?: number
  fromDate?: string
  toDate?: string
  typeFilter?: TransactionType
}

export interface GetTransactionsResponse {
  loanAccountId: string
  transactions: Transaction[]
  totalCount: number
}

export interface GetBalanceRequest {
  loanAccountId: string
}

export interface GetBalanceResponse {
  loanAccountId: string
  principalBalance: string
  feeBalance: string
  totalOutstanding: string
  asOf: { seconds: string; nanos: number }
}

export interface GetLedgerRecordRequest {
  loanAccountId: string
}

export interface LedgerRecordResponse {
  loanAccountId: string
  accountNumber: string
  customerId: string
  applicationNumber: string
  disbursedPrincipal: string
  establishmentFee: string
  totalRepayable: string
  principalBalance: string
  feeBalance: string
  totalOutstanding: string
  totalPaid: string
  transactionCount: number
  lastTransactionId?: string
  scheduleId?: string
  createdAt: { seconds: string; nanos: number }
  updatedAt: { seconds: string; nanos: number }
}

export interface GetStatementRequest {
  loanAccountId: string
  periodStart: string
  periodEnd: string
}

export interface StatementLine {
  date: string
  transactionId: string
  description: string
  charge?: string
  payment?: string
  balance: string
}

export interface StatementResponse {
  loanAccountId: string
  accountNumber: string
  customerId: string
  periodStart: string
  periodEnd: string
  disbursedPrincipal: string
  establishmentFee: string
  totalRepayable: string
  openingBalance: string
  feesCharged: string
  paymentsReceived: string
  closingBalance: string
  lines: StatementLine[]
  generatedAt: { seconds: string; nanos: number }
}

export interface RecordRepaymentRequest {
  loanAccountId: string
  amount: string
  paymentId?: string
  paymentMethod?: string
  paymentReference?: string
  notes?: string
  idempotencyKey?: string
}

export interface ApplyLateFeeRequest {
  loanAccountId: string
  feeAmount: string
  daysPastDue: number
  reason?: string
  idempotencyKey?: string
}

export interface WaiveFeeRequest {
  loanAccountId: string
  waiverAmount: string
  reason: string
  approvedBy: string
  notes?: string
  idempotencyKey?: string
}

export interface WriteOffRequest {
  loanAccountId: string
  reason: string
  approvedBy: string
  idempotencyKey?: string
}

export interface MakeAdjustmentRequest {
  loanAccountId: string
  principalDelta: string
  feeDelta: string
  reason: string
  approvedBy: string
  idempotencyKey?: string
}

export interface InstalmentAllocation {
  paymentNumber: number
  amountApplied: string
  instalmentStatus: string
  amountRemaining: string
  dueDate: string
  scheduledAmount: string
}

export interface TransactionResponse {
  transaction: Transaction
  eventId: string
  allocatedToFees?: string
  allocatedToPrincipal?: string
  overpayment?: string
  idempotentReplay?: boolean // True if this is a cached response from a previous request
  appliedToInstalments?: InstalmentAllocation[]
  allocationWarning?: string
}

// =============================================================================
// Schedule with Status Types (E0-S2)
// =============================================================================

export interface GetScheduleWithStatusRequest {
  loanAccountId?: string
  scheduleId?: string
  applicationNumber?: string
}

export interface InstalmentWithStatus {
  paymentNumber: number
  dueDate: string
  scheduledAmount: string
  status: string // PENDING, PARTIAL, PAID, OVERDUE
  amountPaid: string
  amountRemaining: string
  paidDate?: string
  linkedTransactionIds: string[]
  lastUpdated?: string
}

export interface ScheduleSummary {
  totalInstalments: number
  paidCount: number
  partialCount: number
  overdueCount: number
  pendingCount: number
  nextDueDate?: string
  nextDueAmount?: string
  totalScheduled: string
  totalPaid: string
  totalRemaining: string
}

export interface ScheduleWithStatusResponse {
  scheduleId: string
  loanAccountId: string
  customerId: string
  applicationNumber: string
  instalments: InstalmentWithStatus[]
  summary: ScheduleSummary
}

// =============================================================================
// Account Aging Types (E0-S2)
// =============================================================================

export interface GetAccountAgingRequest {
  accountId: string
}

export interface AccountAgingResponse {
  accountId: string
  dpd: number
  bucket: string
  daysUntilOverdue: number
  lastUpdated: string
  previousBucket?: string
  transitionReason?: string
  oldestOverdueInstalmentId?: string
  totalOverdueAmount: string
}

export interface GetOverdueAccountsRequest {
  bucketFilter?: string
  minDpd?: number
  maxDpd?: number
  pageSize: number
  pageToken?: string
}

export interface OverdueAccount {
  accountId: string
  dpd: number
  bucket: string
  daysUntilOverdue: number
  totalOverdueAmount: string
  lastUpdated: string
}

export interface OverdueAccountsResponse {
  accounts: OverdueAccount[]
  totalCount: number
  nextPageToken?: string
}

// =============================================================================
// Revenue Recognition Types (E0-S3)
// =============================================================================

export interface GetAccruedYieldRequest {
  accountId: string
}

export interface AccruedYieldResponse {
  accountId: string
  cumulativeAccrued: string
  daysAccrued: number
  termDays: number
  feeAmount: string
  dailyRate: string
  lastAccrualDate: string
  lastUpdated: string
  disbursementDate: string
  isCompleted: boolean
}

export interface GetAccrualEventHistoryRequest {
  accountId: string
  limit?: number
}

export interface AccrualEventDetail {
  accountId: string
  accrualDate: string
  dailyAmount: string
  cumulativeAmount: string
  daysAccrued: number
  termDays: number
  feeAmount: string
  dailyRate: string
  timestamp: string
  correlationId?: string
}

export interface AccrualEventHistoryResponse {
  accountId: string
  events: AccrualEventDetail[]
  totalCount: number
}

// =============================================================================
// ECL (Expected Credit Loss) Types (E0-S4)
// =============================================================================

export interface GetECLAllowanceRequest {
  accountId: string
}

export interface ECLAllowanceResponse {
  accountId: string
  eclAmount: string
  carryingAmount: string
  agingBucket: string
  pdRate: string
  overlayMultiplier: string
  lastCalculated: string
  calculationCount: number
  previousEclAmount?: string
  eclDelta?: string
  triggeredByEventId?: string
}

export interface GetPortfolioECLRequest {
  asOfDate?: string
}

export interface ECLBucketSummary {
  bucket: string
  accountCount: number
  totalEcl: string
  totalCarryingAmount: string
  averagePdRate: string
}

export interface PortfolioECLResponse {
  asOfDate: string
  totalAccounts: number
  totalEcl: string
  totalCarryingAmount: string
  buckets: ECLBucketSummary[]
}

export interface TriggerPortfolioECLRecalculationRequest {
  batchSize?: number
  triggeredBy: string
}

export interface PortfolioECLRecalculationResponse {
  totalAccounts: number
  processed: number
  skipped: number
  failed: number
  startedAt: string
  completedAt: string
  triggeredBy: string
  failedAccountIds: string[]
}

export interface TriggerBulkECLRecalculationRequest {
  accountIds: string[]
  triggeredBy: string
}

export interface BulkECLRecalculationResult {
  accountId: string
  success: boolean
  errorMessage: string
  previousEcl: string
  newEcl: string
  eclDelta: string
}

export interface BulkECLRecalculationResponse {
  totalRequested: number
  processed: number
  failed: number
  startedAt: string
  completedAt: string
  triggeredBy: string
  results: BulkECLRecalculationResult[]
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetEventProcessingStatusRequest {}

export interface StreamProcessingStatus {
  streamName: string
  consumerGroup: string
  streamLength: string
  pendingCount: string
  lastDeliveredId: string
  lastEntryId: string
  lagSeconds: string
  status: string
  consumerCount: number
  lastError: string
  lastProcessedAt: string
}

export interface EventProcessingStatusResponse {
  success: boolean
  errorMessage: string
  overallStatus: string
  totalPending: string
  estimatedCatchupSeconds: string
  streams: StreamProcessingStatus[]
  queriedAt: string
  warning: string
}

// =============================================================================
// ECL Configuration Types (E0-S5)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GetECLConfigRequest {}

export interface ECLConfigResponse {
  overlayMultiplier: string
  pdRates: Record<string, string>
  lastUpdated: string
  updatedBy: string
  warning?: string
}

export interface UpdateOverlayMultiplierRequest {
  overlayMultiplier: string
  updatedBy: string
}

export interface UpdatePDRateRequest {
  bucket: string
  pdRate: string
  updatedBy: string
}

export interface GetECLConfigHistoryRequest {
  limit?: number
}

export interface ECLConfigChangeEvent {
  timestamp: string
  fieldName: string
  oldValue: string
  newValue: string
  changedBy: string
}

export interface ECLConfigHistoryResponse {
  events: ECLConfigChangeEvent[]
  totalCount: number
}

export interface ScheduleConfigChangeRequest {
  fieldName: string
  newValue: string
  effectiveDate: string
  createdBy: string
}

export interface ScheduleConfigChangeResponse {
  changeId: string
  fieldName: string
  newValue: string
  effectiveDate: string
  createdAt: string
  createdBy: string
}

export interface GetPendingConfigChangesRequest {
  includePast?: boolean
}

export interface PendingConfigChange {
  changeId: string
  fieldName: string
  newValue: string
  effectiveDate: string
  status: string
  createdAt: string
  createdBy: string
  appliedAt?: string
  cancelledAt?: string
  cancelledBy?: string
}

export interface PendingConfigChangesResponse {
  changes: PendingConfigChange[]
  totalCount: number
}

export interface CancelPendingConfigChangeRequest {
  changeId: string
  cancelledBy: string
}

export interface CancelPendingConfigChangeResponse {
  success: boolean
  cancelledChange?: PendingConfigChange
  errorMessage: string
}

export interface ApplyPendingConfigChangesRequest {
  asOfDate?: string
}

export interface ApplyPendingConfigChangesResponse {
  appliedCount: number
  appliedChanges: PendingConfigChange[]
}

// =============================================================================
// Period Close Types (E0-S6)
// =============================================================================

export interface PreviewPeriodCloseRequest {
  periodDate: string
  requestedBy: string
}

export interface BucketSummary {
  bucket: string
  accountCount: number
  totalEcl: string
  totalCarryingAmount: string
  averagePdRate: string
}

export interface BucketMovement {
  bucket: string
  priorEcl: string
  currentEcl: string
  netChange: string
  priorAccountCount: number
  currentAccountCount: number
  accountsEntered: number
  accountsExited: number
}

export interface ECLMovementByCause {
  cause: string
  amount: string
}

export interface ECLMovement {
  priorTotalEcl: string
  currentTotalEcl: string
  netChange: string
  changePercent: string
  byCause: ECLMovementByCause[]
  byBucket: BucketMovement[]
  priorPeriodDate: string
  isFirstClose: boolean
}

export interface Anomaly {
  anomalyId: string
  anomalyType: string
  accountId: string
  severity: string
  description: string
  acknowledged: boolean
  acknowledgedBy: string
  acknowledgedAt: string
}

export interface JournalEntry {
  entryId: string
  periodDate: string
  entryType: string
  debitAccount: string
  creditAccount: string
  amount: string
  description: string
  createdAt: string
}

export interface ReconciliationResult {
  eclCount: number
  accrualCount: number
  inBoth: number
  eclOnly: string[]
  accrualOnly: string[]
  isReconciled: boolean
  discrepancyCount: number
}

export interface PreviewPeriodCloseResponse {
  success: boolean
  errorMessage: string
  previewId: string
  periodDate: string
  createdAt: string
  expiresAt: string
  totalAccounts: number
  totalAccruedYield: string
  totalEclAllowance: string
  totalCarryingAmount: string
  eclByBucket: BucketSummary[]
  anomalies: Anomaly[]
  allAnomaliesAcknowledged: boolean
  eclMovement: ECLMovement
  processingTimeSeconds: number
  reconciliation: ReconciliationResult
}

export interface FinalizePeriodCloseRequest {
  previewId: string
  finalizedBy: string
}

export interface FinalizePeriodCloseResponse {
  success: boolean
  errorMessage: string
  periodDate: string
  status: string
  finalizedAt: string
  totalAccounts: number
  totalAccruedYield: string
  totalEclAllowance: string
  totalCarryingAmount: string
  journalEntries: JournalEntry[]
  eventId: string
}

export interface GetPeriodCloseRequest {
  periodDate: string
  includeCorrections?: boolean
}

export interface PeriodCloseResponse {
  found: boolean
  periodDate: string
  status: string
  finalizedAt: string
  finalizedBy: string
  totalAccounts: number
  totalAccruedYield: string
  totalEclAllowance: string
  totalCarryingAmount: string
  eclByBucket: BucketSummary[]
  journalEntries: JournalEntry[]
  hasCorrections: boolean
  correctionCount: number
}

export interface GetClosedPeriodsRequest {
  limit?: number
}

export interface GetClosedPeriodsResponse {
  periodDates: string[]
  totalCount: number
}

export interface AcknowledgeAnomalyRequest {
  previewId: string
  anomalyId: string
  acknowledgedBy: string
}

export interface AcknowledgeAnomalyResponse {
  success: boolean
  errorMessage: string
  allAnomaliesAcknowledged: boolean
}

// =============================================================================
// Export Types (E0-S7)
// =============================================================================

export enum ExportType {
  EXPORT_TYPE_UNSPECIFIED = 'EXPORT_TYPE_UNSPECIFIED',
  EXPORT_TYPE_JOURNAL_ENTRIES = 'EXPORT_TYPE_JOURNAL_ENTRIES',
  EXPORT_TYPE_AUDIT_TRAIL = 'EXPORT_TYPE_AUDIT_TRAIL',
  EXPORT_TYPE_METHODOLOGY = 'EXPORT_TYPE_METHODOLOGY',
}

export enum ExportFormat {
  EXPORT_FORMAT_UNSPECIFIED = 'EXPORT_FORMAT_UNSPECIFIED',
  EXPORT_FORMAT_CSV = 'EXPORT_FORMAT_CSV',
  EXPORT_FORMAT_JSON = 'EXPORT_FORMAT_JSON',
}

export enum ExportStatus {
  EXPORT_STATUS_UNSPECIFIED = 'EXPORT_STATUS_UNSPECIFIED',
  EXPORT_STATUS_PENDING = 'EXPORT_STATUS_PENDING',
  EXPORT_STATUS_PROCESSING = 'EXPORT_STATUS_PROCESSING',
  EXPORT_STATUS_COMPLETED = 'EXPORT_STATUS_COMPLETED',
  EXPORT_STATUS_FAILED = 'EXPORT_STATUS_FAILED',
}

export interface CreateExportJobRequest {
  exportType: ExportType
  exportFormat?: ExportFormat
  createdBy: string
  periodDate?: string
  accountIds?: string[]
  dateRangeStart?: string
  dateRangeEnd?: string
  includeCalculationBreakdown?: boolean
}

export interface CreateExportJobResponse {
  success: boolean
  jobId: string
  errorMessage: string
}

export interface GetExportStatusRequest {
  jobId: string
}

export interface ExportJobResponse {
  success: boolean
  errorMessage: string
  jobId: string
  exportType: ExportType
  exportFormat: ExportFormat
  status: ExportStatus
  createdAt: string
  createdBy: string
  startedAt: string
  completedAt: string
  totalRecords: number
  processedRecords: number
  progressPercent: number
  resultUrl: string
  resultSizeBytes: string
  retryCount: number
  maxRetries: number
  canRetry: boolean
  warning: string
}

export interface GetExportResultRequest {
  jobId: string
}

export interface GetExportResultResponse {
  success: boolean
  errorMessage: string
  format: ExportFormat
  data: string
  sizeBytes: string
  validationJson: string
}

export interface RetryExportRequest {
  jobId: string
}

export interface ListExportJobsRequest {
  userId: string
  limit?: number
  includeCompleted?: boolean
}

export interface ListExportJobsResponse {
  success: boolean
  jobs: ExportJobResponse[]
  errorMessage: string
}

// =============================================================================
// Investigation Types (E0-S8)
// =============================================================================

export interface GetEventHistoryRequest {
  accountId: string
  limit?: number
  cursor?: string
}

export interface EventHistoryEntry {
  eventId: string
  stream: string
  eventType: string
  accountId: string
  timestamp: string
  dataJson: string
}

export interface EventHistoryResponse {
  success: boolean
  errorMessage: string
  events: EventHistoryEntry[]
  nextCursor: string
}

export interface TraceECLToSourceRequest {
  accountIds: string[]
}

export interface TraceECLToSourceResult {
  accountId: string
  success: boolean
  errorMessage: string
  eclEventId: string
  triggeredBy: string
  triggeredByEventId: string
  timestamp: string
  agingBucket: string
  eclAmount: string
  carryingAmount: string
  pdRate: string
  overlayMultiplier: string
}

export interface TraceECLToSourceResponse {
  results: TraceECLToSourceResult[]
}

export interface TraceAccruedYieldToSourceRequest {
  accountIds: string[]
}

export interface TraceAccruedYieldToSourceResult {
  accountId: string
  success: boolean
  errorMessage: string
  feeAmount: string
  termDays: number
  disbursementDate: string
  dailyAccrualRate: string
  cumulativeAccrued: string
  daysAccrued: number
  lastAccrualDate: string
  lastUpdated: string
  accrualEventCount: number
}

export interface TraceAccruedYieldToSourceResponse {
  results: TraceAccruedYieldToSourceResult[]
}

export interface SearchAccountsRequest {
  query: string
  limit?: number
}

export interface AccountSearchResult {
  loanAccountId: string
  accountNumber: string
  customerId: string
  applicationNumber: string
  principalBalance: string
  feeBalance: string
  totalOutstanding: string
  createdAt: string
}

export interface SearchAccountsResponse {
  results: AccountSearchResult[]
  totalCount: number
}

export interface BatchAccountQueryRequest {
  accountIds: string[]
}

export interface BatchAccountQueryResult {
  accountId: string
  success: boolean
  errorMessage: string
  record: LedgerRecordResponse
}

export interface BatchAccountQueryResponse {
  results: BatchAccountQueryResult[]
  totalCount: number
}

export interface GenerateRandomSampleRequest {
  bucket?: string
  eclMin?: string
  eclMax?: string
  carryingAmountMin?: string
  carryingAmountMax?: string
  sampleSize?: number
  seed?: string
  allowFullScan?: boolean
}

export interface GenerateRandomSampleResponse {
  accountIds: string[]
  totalEligible: number
  seed: string
}

export interface GetCarryingAmountBreakdownRequest {
  accountId: string
}

export interface CarryingAmountBreakdownResponse {
  accountId: string
  principalBalance: string
  accruedYield: string
  carryingAmount: string
  feeBalance: string
  disbursedPrincipal: string
  establishmentFee: string
  totalPaid: string
  lastAccrualDate: string
  daysAccrued: number
  termDays: number
  dailyAccrualRate: string
  calculationTimestamp: string
}

// =============================================================================
// Client Class
// =============================================================================

export class LedgerClient {
  private client: any

  constructor(serviceUrl?: string) {
    const url = serviceUrl || process.env.LEDGER_SERVICE_URL || 'localhost:50051'
    this.client = new AccountingLedgerService(url, grpc.credentials.createInsecure())
  }

  // Helper to promisify gRPC calls
  private promisify<TRequest, TResponse>(
    method: (req: TRequest, callback: (err: any, res: TResponse) => void) => void,
  ): (req: TRequest) => Promise<TResponse> {
    return (request: TRequest) =>
      new Promise((resolve, reject) => {
        method.call(this.client, request, (err: any, response: TResponse) => {
          if (err) {
            reject(err)
          } else {
            resolve(response)
          }
        })
      })
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  async getTransactions(request: GetTransactionsRequest): Promise<GetTransactionsResponse> {
    return this.promisify<GetTransactionsRequest, GetTransactionsResponse>(
      this.client.getTransactions,
    )(request)
  }

  async getBalance(request: GetBalanceRequest): Promise<GetBalanceResponse> {
    return this.promisify<GetBalanceRequest, GetBalanceResponse>(this.client.getBalance)(request)
  }

  async getLedgerRecord(request: GetLedgerRecordRequest): Promise<LedgerRecordResponse> {
    return this.promisify<GetLedgerRecordRequest, LedgerRecordResponse>(this.client.getLedgerRecord)(
      request,
    )
  }

  async getStatement(request: GetStatementRequest): Promise<StatementResponse> {
    return this.promisify<GetStatementRequest, StatementResponse>(this.client.getStatement)(request)
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  async recordRepayment(request: RecordRepaymentRequest): Promise<TransactionResponse> {
    return this.promisify<RecordRepaymentRequest, TransactionResponse>(this.client.recordRepayment)(
      request,
    )
  }

  async applyLateFee(request: ApplyLateFeeRequest): Promise<TransactionResponse> {
    return this.promisify<ApplyLateFeeRequest, TransactionResponse>(this.client.applyLateFee)(
      request,
    )
  }

  async waiveFee(request: WaiveFeeRequest): Promise<TransactionResponse> {
    return this.promisify<WaiveFeeRequest, TransactionResponse>(this.client.waiveFee)(request)
  }

  async writeOff(request: WriteOffRequest): Promise<TransactionResponse> {
    return this.promisify<WriteOffRequest, TransactionResponse>(this.client.writeOff)(request)
  }

  async makeAdjustment(request: MakeAdjustmentRequest): Promise<TransactionResponse> {
    return this.promisify<MakeAdjustmentRequest, TransactionResponse>(this.client.makeAdjustment)(
      request,
    )
  }

  async recordDisbursement(request: {
    loanAccountId: string
    disbursementAmount: string
    actualDisbursementAt: string
    plannedDisbursementDate?: string
    bankReference: string
    paymentMethod?: string
    notes?: string
    evidenceUrl?: string
    idempotencyKey?: string
  }): Promise<TransactionResponse> {
    return this.promisify<typeof request, TransactionResponse>(this.client.recordDisbursement)({
      loan_account_id: request.loanAccountId,
      disbursement_amount: request.disbursementAmount,
      actual_disbursement_at: request.actualDisbursementAt,
      planned_disbursement_date: request.plannedDisbursementDate || '',
      bank_reference: request.bankReference,
      payment_method: request.paymentMethod || 'bank_transfer',
      notes: request.notes || '',
      evidence_url: request.evidenceUrl || '',
      idempotency_key: request.idempotencyKey || '',
    } as any)
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  watchTransactions(
    loanAccountId: string,
    onTransaction: (transaction: Transaction) => void,
    onError: (error: Error) => void,
    fromTransactionId?: string,
  ): { cancel: () => void } {
    const call = this.client.watchTransactions({
      loanAccountId,
      fromTransactionId,
    })

    call.on('data', (transaction: Transaction) => {
      onTransaction(transaction)
    })

    call.on('error', (error: Error) => {
      onError(error)
    })

    call.on('end', () => {
      // Stream ended
    })

    return {
      cancel: () => call.cancel(),
    }
  }

  // ===========================================================================
  // Schedule & Aging Operations (E0-S2)
  // ===========================================================================

  async getScheduleWithStatus(
    request: GetScheduleWithStatusRequest,
  ): Promise<ScheduleWithStatusResponse> {
    return this.promisify<GetScheduleWithStatusRequest, ScheduleWithStatusResponse>(
      this.client.getScheduleWithStatus,
    )(request)
  }

  async getAccountAging(request: GetAccountAgingRequest): Promise<AccountAgingResponse> {
    return this.promisify<GetAccountAgingRequest, AccountAgingResponse>(
      this.client.getAccountAging,
    )(request)
  }

  async getOverdueAccounts(request: GetOverdueAccountsRequest): Promise<OverdueAccountsResponse> {
    return this.promisify<GetOverdueAccountsRequest, OverdueAccountsResponse>(
      this.client.getOverdueAccounts,
    )(request)
  }

  // ===========================================================================
  // Revenue Recognition Operations (E0-S3)
  // ===========================================================================

  async getAccruedYield(request: GetAccruedYieldRequest): Promise<AccruedYieldResponse> {
    return this.promisify<GetAccruedYieldRequest, AccruedYieldResponse>(
      this.client.getAccruedYield,
    )(request)
  }

  async getAccrualEventHistory(
    request: GetAccrualEventHistoryRequest,
  ): Promise<AccrualEventHistoryResponse> {
    return this.promisify<GetAccrualEventHistoryRequest, AccrualEventHistoryResponse>(
      this.client.getAccrualEventHistory,
    )(request)
  }

  // ===========================================================================
  // ECL Operations (E0-S4)
  // ===========================================================================

  async getECLAllowance(request: GetECLAllowanceRequest): Promise<ECLAllowanceResponse> {
    // The proto loader converts GetECLAllowance to getEclAllowance (camelCase, not getECLAllowance)
    // It converts "ECL" to "Ecl" in camelCase
    const method = this.client.getEclAllowance || (this.client as any).GetECLAllowance
    
    if (!method) {
      throw new Error(
        'getEclAllowance method not found on gRPC client. ' +
        'The proto loader may have generated a different method name.'
      )
    }
    
    return this.promisify<GetECLAllowanceRequest, ECLAllowanceResponse>(method)(request)
  }

  async getPortfolioECL(request: GetPortfolioECLRequest): Promise<PortfolioECLResponse> {
    // Proto loader with keepCase: false converts GetPortfolioECL to getPortfolioECL
    // But might also convert to getPortfolioEcl (camelCase "Ecl")
    // Try both method names for robustness
    const method = this.client.getPortfolioECL || 
                   this.client.getPortfolioEcl ||
                   (this.client as any).GetPortfolioECL ||
                   this.client.getPortfolioECL
    
    if (!method) {
      // Debug: log available methods to help diagnose
      const availableMethods = Object.keys(this.client).filter(k => 
        k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('ecl')
      )
      console.error('[gRPC Client] getPortfolioECL method not found. Available portfolio/ecl methods:', availableMethods)
      throw new Error(
        'getPortfolioECL method not found on gRPC client. ' +
        'The proto loader may have generated a different method name. ' +
        `Available methods: ${availableMethods.join(', ')}`
      )
    }
    
    return this.promisify<GetPortfolioECLRequest, PortfolioECLResponse>(method)(request)
  }

  async triggerPortfolioECLRecalculation(
    request: TriggerPortfolioECLRecalculationRequest,
  ): Promise<PortfolioECLRecalculationResponse> {
    // Proto loader with keepCase: false converts TriggerPortfolioECLRecalculation to triggerPortfolioECLRecalculation
    // But might also convert to triggerPortfolioEclRecalculation (camelCase "Ecl")
    // Try both method names for robustness
    const method = this.client.triggerPortfolioECLRecalculation || 
                   this.client.triggerPortfolioEclRecalculation ||
                   (this.client as any).TriggerPortfolioECLRecalculation ||
                   this.client.triggerPortfolioECLRecalculation
    
    if (!method) {
      // Debug: log available methods to help diagnose
      const availableMethods = Object.keys(this.client).filter(k => 
        k.toLowerCase().includes('trigger') || k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('recalc')
      )
      console.error('[gRPC Client] triggerPortfolioECLRecalculation method not found. Available trigger/portfolio/recalc methods:', availableMethods)
      throw new Error(
        'triggerPortfolioECLRecalculation method not found on gRPC client. ' +
        'The proto loader may have generated a different method name. ' +
        `Available methods: ${availableMethods.join(', ')}`
      )
    }
    
    return this.promisify<TriggerPortfolioECLRecalculationRequest, PortfolioECLRecalculationResponse>(method)(request)
  }

  async triggerBulkECLRecalculation(
    request: TriggerBulkECLRecalculationRequest,
  ): Promise<BulkECLRecalculationResponse> {
    return this.promisify<TriggerBulkECLRecalculationRequest, BulkECLRecalculationResponse>(
      this.client.triggerBulkECLRecalculation,
    )(request)
  }

  async getEventProcessingStatus(
    request: GetEventProcessingStatusRequest,
  ): Promise<EventProcessingStatusResponse> {
    // Proto loader with keepCase: false converts GetEventProcessingStatus to getEventProcessingStatus
    // But might also convert to getEventProcessingStatus (should be fine, but check variations)
    // Try both method names for robustness
    const method = this.client.getEventProcessingStatus || 
                   this.client.getEventProcessingstatus ||
                   (this.client as any).GetEventProcessingStatus ||
                   this.client.getEventProcessingStatus
    
    if (!method) {
      // Debug: log available methods to help diagnose
      const availableMethods = Object.keys(this.client).filter(k => 
        k.toLowerCase().includes('event') || k.toLowerCase().includes('processing') || k.toLowerCase().includes('status')
      )
      console.error('[gRPC Client] getEventProcessingStatus method not found. Available event/processing/status methods:', availableMethods)
      throw new Error(
        'getEventProcessingStatus method not found on gRPC client. ' +
        'The proto loader may have generated a different method name. ' +
        `Available methods: ${availableMethods.join(', ')}`
      )
    }
    
    return this.promisify<GetEventProcessingStatusRequest, EventProcessingStatusResponse>(method)(request)
  }

  // ===========================================================================
  // ECL Configuration Operations (E0-S5)
  // ===========================================================================

  async getECLConfig(request: GetECLConfigRequest): Promise<ECLConfigResponse> {
    // Proto loader with keepCase: false converts GetECLConfig to getEclConfig (camelCase "Ecl")
    // Try both method names for robustness
    const method = this.client.getEclConfig || (this.client as any).GetECLConfig || this.client.getECLConfig
    return this.promisify<GetECLConfigRequest, ECLConfigResponse>(method)(request)
  }

  async updateOverlayMultiplier(
    request: UpdateOverlayMultiplierRequest,
  ): Promise<ECLConfigResponse> {
    // Proto loader with keepCase: false converts UpdateOverlayMultiplier to updateOverlayMultiplier
    // Try both method names for robustness
    const method = this.client.updateOverlayMultiplier || (this.client as any).UpdateOverlayMultiplier || this.client.updateOverlayMultiplier
    
    if (!method) {
      throw new Error(
        'updateOverlayMultiplier method not found on gRPC client. ' +
        'The proto loader may have generated a different method name.'
      )
    }
    
    return this.promisify<UpdateOverlayMultiplierRequest, ECLConfigResponse>(method)(request)
  }

  async updatePDRate(request: UpdatePDRateRequest): Promise<ECLConfigResponse> {
    // Proto loader with keepCase: false converts UpdatePDRate to updatePdRate (camelCase "Pd")
    // Try both method names for robustness
    const method = this.client.updatePdRate || (this.client as any).UpdatePDRate || this.client.updatePDRate
    
    if (!method) {
      throw new Error(
        'updatePdRate method not found on gRPC client. ' +
        'The proto loader may have generated a different method name.'
      )
    }
    
    return this.promisify<UpdatePDRateRequest, ECLConfigResponse>(method)(request)
  }

  async getECLConfigHistory(
    request: GetECLConfigHistoryRequest,
  ): Promise<ECLConfigHistoryResponse> {
    // Proto loader with keepCase: false converts GetECLConfigHistory to getEclConfigHistory (camelCase "Ecl")
    // Try both method names for robustness
    const method = this.client.getEclConfigHistory || (this.client as any).GetECLConfigHistory || this.client.getECLConfigHistory
    
    if (!method) {
      // Debug: log available methods to help diagnose
      const availableMethods = Object.keys(this.client).filter(k => 
        k.toLowerCase().includes('ecl') || k.toLowerCase().includes('config') || k.toLowerCase().includes('history')
      )
      console.error('[gRPC Client] getECLConfigHistory method not found. Available ECL/config/history methods:', availableMethods)
      throw new Error(
        'getEclConfigHistory method not found on gRPC client. ' +
        'The proto loader may have generated a different method name. ' +
        `Available methods: ${availableMethods.join(', ')}`
      )
    }
    
    return this.promisify<GetECLConfigHistoryRequest, ECLConfigHistoryResponse>(method)(request)
  }

  async scheduleECLConfigChange(
    request: ScheduleConfigChangeRequest,
  ): Promise<ScheduleConfigChangeResponse> {
    // Proto loader with keepCase: false converts ScheduleECLConfigChange to scheduleECLConfigChange
    // But might also convert to scheduleEclConfigChange (camelCase "Ecl")
    // Try both method names for robustness
    const method = this.client.scheduleECLConfigChange || 
                   this.client.scheduleEclConfigChange ||
                   (this.client as any).ScheduleECLConfigChange ||
                   this.client.scheduleECLConfigChange
    
    if (!method) {
      throw new Error(
        'scheduleECLConfigChange method not found on gRPC client. ' +
        'The proto loader may have generated a different method name.'
      )
    }
    
    return this.promisify<ScheduleConfigChangeRequest, ScheduleConfigChangeResponse>(method)(request)
  }

  async getPendingConfigChanges(
    request: GetPendingConfigChangesRequest,
  ): Promise<PendingConfigChangesResponse> {
    return this.promisify<GetPendingConfigChangesRequest, PendingConfigChangesResponse>(
      this.client.getPendingConfigChanges,
    )(request)
  }

  async cancelPendingConfigChange(
    request: CancelPendingConfigChangeRequest,
  ): Promise<CancelPendingConfigChangeResponse> {
    return this.promisify<CancelPendingConfigChangeRequest, CancelPendingConfigChangeResponse>(
      this.client.cancelPendingConfigChange,
    )(request)
  }

  async applyPendingConfigChanges(
    request: ApplyPendingConfigChangesRequest,
  ): Promise<ApplyPendingConfigChangesResponse> {
    return this.promisify<ApplyPendingConfigChangesRequest, ApplyPendingConfigChangesResponse>(
      this.client.applyPendingConfigChanges,
    )(request)
  }

  // ===========================================================================
  // Period Close Operations (E0-S6)
  // ===========================================================================

  async previewPeriodClose(
    request: PreviewPeriodCloseRequest,
  ): Promise<PreviewPeriodCloseResponse> {
    return this.promisify<PreviewPeriodCloseRequest, PreviewPeriodCloseResponse>(
      this.client.previewPeriodClose,
    )(request)
  }

  async finalizePeriodClose(
    request: FinalizePeriodCloseRequest,
  ): Promise<FinalizePeriodCloseResponse> {
    return this.promisify<FinalizePeriodCloseRequest, FinalizePeriodCloseResponse>(
      this.client.finalizePeriodClose,
    )(request)
  }

  async getPeriodClose(request: GetPeriodCloseRequest): Promise<PeriodCloseResponse> {
    return this.promisify<GetPeriodCloseRequest, PeriodCloseResponse>(
      this.client.getPeriodClose,
    )(request)
  }

  async getClosedPeriods(request: GetClosedPeriodsRequest): Promise<GetClosedPeriodsResponse> {
    return this.promisify<GetClosedPeriodsRequest, GetClosedPeriodsResponse>(
      this.client.getClosedPeriods,
    )(request)
  }

  async acknowledgeAnomaly(
    request: AcknowledgeAnomalyRequest,
  ): Promise<AcknowledgeAnomalyResponse> {
    return this.promisify<AcknowledgeAnomalyRequest, AcknowledgeAnomalyResponse>(
      this.client.acknowledgeAnomaly,
    )(request)
  }

  // ===========================================================================
  // Export Operations (E0-S7)
  // ===========================================================================

  async createExportJob(request: CreateExportJobRequest): Promise<CreateExportJobResponse> {
    return this.promisify<CreateExportJobRequest, CreateExportJobResponse>(
      this.client.createExportJob,
    )(request)
  }

  async getExportStatus(request: GetExportStatusRequest): Promise<ExportJobResponse> {
    return this.promisify<GetExportStatusRequest, ExportJobResponse>(
      this.client.getExportStatus,
    )(request)
  }

  async getExportResult(request: GetExportResultRequest): Promise<GetExportResultResponse> {
    return this.promisify<GetExportResultRequest, GetExportResultResponse>(
      this.client.getExportResult,
    )(request)
  }

  async retryExport(request: RetryExportRequest): Promise<ExportJobResponse> {
    return this.promisify<RetryExportRequest, ExportJobResponse>(this.client.retryExport)(request)
  }

  async listExportJobs(request: ListExportJobsRequest): Promise<ListExportJobsResponse> {
    return this.promisify<ListExportJobsRequest, ListExportJobsResponse>(
      this.client.listExportJobs,
    )(request)
  }

  // ===========================================================================
  // Investigation Operations (E0-S8)
  // ===========================================================================

  async getEventHistory(request: GetEventHistoryRequest): Promise<EventHistoryResponse> {
    return this.promisify<GetEventHistoryRequest, EventHistoryResponse>(
      this.client.getEventHistory,
    )(request)
  }

  async traceECLToSource(request: TraceECLToSourceRequest): Promise<TraceECLToSourceResponse> {
    return this.promisify<TraceECLToSourceRequest, TraceECLToSourceResponse>(
      this.client.traceECLToSource,
    )(request)
  }

  async traceAccruedYieldToSource(
    request: TraceAccruedYieldToSourceRequest,
  ): Promise<TraceAccruedYieldToSourceResponse> {
    return this.promisify<TraceAccruedYieldToSourceRequest, TraceAccruedYieldToSourceResponse>(
      this.client.traceAccruedYieldToSource,
    )(request)
  }

  async searchAccounts(request: SearchAccountsRequest): Promise<SearchAccountsResponse> {
    return this.promisify<SearchAccountsRequest, SearchAccountsResponse>(
      this.client.searchAccounts,
    )(request)
  }

  async batchAccountQuery(request: BatchAccountQueryRequest): Promise<BatchAccountQueryResponse> {
    return this.promisify<BatchAccountQueryRequest, BatchAccountQueryResponse>(
      this.client.batchAccountQuery,
    )(request)
  }

  async generateRandomSample(
    request: GenerateRandomSampleRequest,
  ): Promise<GenerateRandomSampleResponse> {
    return this.promisify<GenerateRandomSampleRequest, GenerateRandomSampleResponse>(
      this.client.generateRandomSample,
    )(request)
  }

  async getCarryingAmountBreakdown(
    request: GetCarryingAmountBreakdownRequest,
  ): Promise<CarryingAmountBreakdownResponse> {
    return this.promisify<GetCarryingAmountBreakdownRequest, CarryingAmountBreakdownResponse>(
      this.client.getCarryingAmountBreakdown,
    )(request)
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let ledgerClient: LedgerClient | null = null

export function getLedgerClient(): LedgerClient {
  if (!ledgerClient) {
    ledgerClient = new LedgerClient()
  }
  return ledgerClient
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique idempotency key for gRPC requests.
 * 
 * Format: {prefix}-{timestamp}-{random}
 * - prefix: Operation type (e.g., "repay", "waive", "writeoff")
 * - timestamp: Current timestamp in base36
 * - random: Random alphanumeric suffix
 * 
 * These keys have a 24-hour TTL on the server side.
 */
export function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Convert protobuf timestamp to JavaScript Date
 */
export function timestampToDate(timestamp: { seconds: string; nanos: number }): Date {
  const seconds = parseInt(timestamp.seconds, 10)
  const millis = Math.floor(timestamp.nanos / 1000000)
  return new Date(seconds * 1000 + millis)
}

/**
 * Format currency string for display
 */
export function formatCurrency(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num)
}

/**
 * Map transaction type to display label
 */
export function getTransactionTypeLabel(type: TransactionType): string {
  const labels: Record<TransactionType, string> = {
    [TransactionType.TRANSACTION_TYPE_UNSPECIFIED]: 'Unknown',
    [TransactionType.DISBURSEMENT]: 'Disbursement',
    [TransactionType.ESTABLISHMENT_FEE]: 'Establishment Fee',
    [TransactionType.REPAYMENT]: 'Repayment',
    [TransactionType.LATE_FEE]: 'Late Fee',
    [TransactionType.DISHONOUR_FEE]: 'Dishonour Fee',
    [TransactionType.FEE_WAIVER]: 'Fee Waiver',
    [TransactionType.ADJUSTMENT]: 'Adjustment',
    [TransactionType.WRITE_OFF]: 'Write Off',
  }
  return labels[type] || 'Unknown'
}

