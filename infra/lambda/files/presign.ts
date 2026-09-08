import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { requestContext, requireActiveAccount, AuthError } from '../common/auth';
import { filesBucketName } from '../common/runtime-env';

const s3 = new S3Client({});
const BUCKET_NAME = filesBucketName();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Issues a short-lived presigned S3 PUT URL scoped to this shop's private
 * prefix, so the browser can upload signatures/estimate documents directly
 * to S3 without ever holding AWS credentials or routing the file through Lambda.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    const body = JSON.parse(event.body || '{}');
    const kind = String(body.kind || 'file').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'file';
    const contentType = String(body.contentType || '').toLowerCase().split(';')[0].trim();
    const extension = ALLOWED_CONTENT_TYPES.get(contentType);
    if (!extension) {
      return json(400, { message: 'contentType must be image/png, image/jpeg, image/webp, or application/pdf' });
    }
    const contentLength = Number(body.contentLength || 0);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
      return json(400, { message: `contentLength is required and must be between 1 and ${MAX_UPLOAD_BYTES} bytes` });
    }
    const key = `shops/${ctx.shopId}/${kind}/${randomUUID()}.${extension}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: 300 },
    );

    return json(200, { uploadUrl, key, maxBytes: MAX_UPLOAD_BYTES });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};

/** Issues a short-lived presigned GET URL to view a previously uploaded file. */
export const getHandler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    const key = event.queryStringParameters?.key;
    if (!key || !key.startsWith(`shops/${ctx.shopId}/`)) return json(403, { message: 'Not authorized for this file' });
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }), { expiresIn: 300 });
    return json(200, { url });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
