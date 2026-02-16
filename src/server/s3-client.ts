/**
 * S3 Client Singleton
 *
 * Provides a configured S3 client and helpers for generating presigned URLs.
 * Used for uploading disbursement proof-of-payment attachments.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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
 * Generate a presigned PUT URL for uploading a file to S3.
 *
 * @param key - The S3 object key (path within the bucket)
 * @param contentType - MIME type of the file being uploaded
 * @param expiresIn - URL expiration time in seconds (default: 300 = 5 minutes)
 * @returns The presigned URL for PUT upload
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  const client = getS3Client()
  const bucket = getBucketName()

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })

  return getSignedUrl(client, command, { expiresIn })
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
  const client = getS3Client()
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
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
  } catch {
    return null
  }
}
