import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { requestContext, AuthError } from '../common/auth';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.FILES_BUCKET_NAME as string;

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
    const body = JSON.parse(event.body || '{}');
    const kind = String(body.kind || 'file').replace(/[^a-z0-9-]/gi, '');
    const contentType = String(body.contentType || 'application/octet-stream');
    const extension = contentType.includes('png') ? 'png' : contentType.includes('pdf') ? 'pdf' : 'bin';
    const key = `shops/${ctx.shopId}/${kind}/${randomUUID()}.${extension}`;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    );

    return json(200, { uploadUrl, key });
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
