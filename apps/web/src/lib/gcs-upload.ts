import { createHash, createSign } from 'node:crypto';

export type GcsUploadTarget = {
  bucket: string;
  objectName: string;
  contentType: string;
  expiresInSeconds?: number;
};

export type GcsSignedUpload = {
  gcs_uri: string;
  signed_upload_url: string;
  expires_at: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GCS_CONFIG_MISSING: ${name}`);
  return value;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rsaSha256Hex(value: string, privateKey: string): string {
  return createSign('RSA-SHA256').update(value).sign(privateKey, 'hex');
}

export function createGcsSignedUploadUrl(target: GcsUploadTarget): GcsSignedUpload {
  const clientEmail = requiredEnv('GCS_CLIENT_EMAIL');
  const privateKey = normalizePrivateKey(requiredEnv('GCS_PRIVATE_KEY'));
  const bucket = target.bucket;
  const objectName = target.objectName.replace(/^\/+/, '');
  const contentType = target.contentType;
  const expiresInSeconds = target.expiresInSeconds ?? 15 * 60;
  const now = new Date();
  const date = yyyymmdd(now);
  const amzDate = timestamp(now);
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const credential = `${clientEmail}/${credentialScope}`;
  const host = 'storage.googleapis.com';
  const canonicalUri = `/${bucket}/${encodePathPart(objectName)}`;
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const params = new URLSearchParams({
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': credential,
    'X-Goog-Date': amzDate,
    'X-Goog-Expires': String(expiresInSeconds),
    'X-Goog-SignedHeaders': signedHeaders,
  });
  params.sort();
  const canonicalQueryString = params.toString();
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'GOOG4-RSA-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = rsaSha256Hex(stringToSign, privateKey);
  params.set('X-Goog-Signature', signature);
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
  return {
    gcs_uri: `gs://${bucket}/${objectName}`,
    signed_upload_url: `https://${host}${canonicalUri}?${params.toString()}`,
    expires_at: expiresAt,
  };
}

export function isGcsUploadEnabled(): boolean {
  return (process.env.GCS_UPLOAD_ENABLED ?? '').trim().toLowerCase() === 'true';
}
