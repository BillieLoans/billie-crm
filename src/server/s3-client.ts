/**
 * S3 Client Singleton
 *
 * Provides a configured S3 client and helpers for reading and writing
 * customer documents and issue screenshots. All access is server-side.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'

let s3ClientInstance: S3Client | null = null

/**
 * Get the singleton S3 client, configured via environment variables.
 *
 * Required env vars:
 * - AWS_REGION (defaults to 'ap-southeast-2')
 * - S3_BUCKET_NAME (required)
 * - AWS_ACCESS_KEY_ID (required in production; optional if using IAM roles)
 * - AWS_SECRET_ACCESS_KEY (required in production; optional if using IAM roles)
 */
export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-2',
    })
  }
  return s3ClientInstance
}

/**
 * Get the configured S3 bucket name.
 */
export function getBucketName(): string {
  const bucket = process.env.S3_BUCKET_NAME
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME environment variable is not set')
  }
  return bucket
}

/**
 * Upload an object to the configured bucket. All uploads are proxied through
 * the app server (never presigned to the browser) so the CSP can stay
 * connect-src 'self' and size/content validation happens server-side.
 */
export async function uploadObject(
  key: string,
  contentType: string,
  body: Uint8Array,
): Promise<void> {
  const client = getS3Client()
  const bucket = getBucketName()

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Body: body,
      ContentLength: body.byteLength,
    }),
  )
}

/**
 * Build the S3 URI for a given key.
 */
export function buildS3Uri(key: string): string {
  const bucket = getBucketName()
  return `s3://${bucket}/${key}`
}

/**
 * Parse an S3 URI (s3://bucket/key) into bucket and key.
 * @throws if the URI is not a valid s3:// URI
 */
export function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri.trim())
  if (!match) {
    throw new Error(`Invalid S3 URI: ${s3Uri}`)
  }
  return { bucket: match[1], key: match[2] }
}

/**
 * Get an object from S3 by URI.
 * Uses the bucket and key from the URI (may differ from S3_BUCKET_NAME).
 * @returns Object stream and Content-Type, or null if not found
 */
export async function getObjectByUri(s3Uri: string): Promise<{
  body: ReadableStream
  contentType: string
  contentLength?: number
} | null> {
  const { bucket, key } = parseS3Uri(s3Uri)
  // Validate that the URI refers to the configured bucket to prevent cross-bucket access
  const expectedBucket = process.env.S3_BUCKET_NAME
  if (expectedBucket && bucket !== expectedBucket) {
    throw new Error(
      `S3 URI bucket "${bucket}" does not match configured bucket "${expectedBucket}"`,
    )
  }
  const client = getS3Client()
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )
    if (!response.Body) return null
    const contentType =
      response.ContentType ??
      (key.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream')
    return {
      body: response.Body as ReadableStream,
      contentType,
      contentLength: response.ContentLength ?? undefined,
    }
  } catch (err) {
    const code =
      (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name ?? 'Unknown'
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[s3-client] getObjectByUri failed', { bucket, key, code, msg })
    return null
  }
}

/** One version of one key: what a version-specific delete names. */
export interface VersionedKey {
  key: string
  versionId: string
}

export interface ObjectVersionRef extends VersionedKey {
  /** A delete marker holds no data; it is listed alongside the data versions. */
  isDeleteMarker: boolean
}

/**
 * Get the base folder under which per-application statement files live.
 * @throws if S3_STATEMENT_BASE_FOLDER is not set
 */
export function getStatementBaseFolder(): string {
  const folder = process.env.S3_STATEMENT_BASE_FOLDER
  if (!folder) {
    throw new Error('S3_STATEMENT_BASE_FOLDER environment variable is not set')
  }
  return folder
}

/**
 * List every object version and delete marker under a prefix, following
 * pagination, and say which entries are delete markers. The literal VersionId
 * 'null' (pre-versioning objects) is kept: it must be sent on delete, or S3
 * only adds a delete marker and leaves the bytes.
 */
export async function listObjectVersionsUnderPrefix(prefix: string): Promise<ObjectVersionRef[]> {
  const client = getS3Client()
  const bucket = getBucketName()
  const refs: ObjectVersionRef[] = []
  let keyMarker: string | undefined
  let versionIdMarker: string | undefined

  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    )
    const items = [
      ...(page.Versions ?? []).map((item) => ({ item, isDeleteMarker: false })),
      ...(page.DeleteMarkers ?? []).map((item) => ({ item, isDeleteMarker: true })),
    ]
    for (const { item, isDeleteMarker } of items) {
      if (!item.Key) continue
      if (!item.VersionId) {
        console.error('[s3-client] skipping listed item without VersionId', { key: item.Key })
        continue
      }
      refs.push({ key: item.Key, versionId: item.VersionId, isDeleteMarker })
    }
    if (page.IsTruncated) {
      keyMarker = page.NextKeyMarker
      versionIdMarker = page.NextVersionIdMarker
    } else {
      keyMarker = undefined
      versionIdMarker = undefined
    }
  } while (keyMarker || versionIdMarker)

  return refs
}

const DELETE_CHUNK_SIZE = 1000

/**
 * Delete each key without a VersionId, in chunks of 1000, so a versioned
 * bucket adds a delete marker. Replication carries delete markers to the
 * backup bucket; it never carries version-specific deletes.
 *
 * A key is placed when the response lists it in `Deleted`. `DeleteMarker` is
 * false only on an unversioned bucket, where the key is simply gone, which is
 * still a success. A key in `Errors`, missing from the response, or in a chunk
 * that threw is failed.
 */
export async function placeDeleteMarkers(keys: string[]): Promise<{
  placed: string[]
  failed: Array<{ key: string; message: string }>
}> {
  const client = getS3Client()
  const bucket = getBucketName()
  const placed: string[] = []
  const failed: Array<{ key: string; message: string }> = []

  for (let i = 0; i < keys.length; i += DELETE_CHUNK_SIZE) {
    const chunk = keys.slice(i, i + DELETE_CHUNK_SIZE)
    try {
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Quiet: false, Objects: chunk.map((key) => ({ Key: key })) },
        }),
      )
      const deleted = new Set((res.Deleted ?? []).map((d) => d.Key))
      const errors = new Map(
        (res.Errors ?? []).map((e) => [e.Key, e.Message ?? e.Code ?? 'Unknown error']),
      )
      for (const key of chunk) {
        const error = errors.get(key)
        if (error !== undefined) failed.push({ key, message: error })
        else if (deleted.has(key)) placed.push(key)
        else failed.push({ key, message: 'No result returned' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const key of chunk) failed.push({ key, message })
    }
  }

  return { placed, failed }
}

/**
 * Delete specific object versions in chunks of 1000. DeleteObjects returns
 * HTTP 200 with per-key Errors, so those are surfaced as failures. A chunk
 * that throws marks every ref in it failed and the next chunk still runs.
 */
export async function deleteObjectVersions(refs: VersionedKey[]): Promise<{
  deleted: VersionedKey[]
  failed: Array<VersionedKey & { message: string }>
}> {
  const client = getS3Client()
  const bucket = getBucketName()
  const deleted: VersionedKey[] = []
  const failed: Array<VersionedKey & { message: string }> = []

  for (let i = 0; i < refs.length; i += DELETE_CHUNK_SIZE) {
    const chunk = refs.slice(i, i + DELETE_CHUNK_SIZE)
    try {
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Quiet: false,
            Objects: chunk.map((r) => ({ Key: r.key, VersionId: r.versionId })),
          },
        }),
      )
      for (const d of res.Deleted ?? []) {
        if (!d.Key) continue
        deleted.push({ key: d.Key, versionId: d.VersionId ?? '' })
      }
      for (const e of res.Errors ?? []) {
        if (!e.Key) continue
        failed.push({
          key: e.Key,
          versionId: e.VersionId ?? '',
          message: e.Message ?? e.Code ?? 'Unknown error',
        })
      }
      const reported = new Set(
        [...(res.Deleted ?? []), ...(res.Errors ?? [])].map((x) => `${x.Key}\u0000${x.VersionId}`),
      )
      for (const r of chunk) {
        if (!reported.has(`${r.key}\u0000${r.versionId}`)) {
          failed.push({ ...r, message: 'No result returned' })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const r of chunk) failed.push({ ...r, message })
    }
  }

  return { deleted, failed }
}
