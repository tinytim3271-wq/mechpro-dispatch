import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Phase 3 stub — append-only audit records. Never stores plaintext PINs or security tokens. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin', 'technician', 'service_writer']);
    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    const redacted = { ...body };
    ['pin', 'token', 'securityToken', 'password', 'credential'].forEach((key) => {
      if (key in redacted) redacted[key] = '[REDACTED]';
    });
    const id = `audit-${Date.now()}`;
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `SHOP#${ctx.shopId}`,
        sk: `DIAGAUDIT#${id}`,
        id,
        technicianId: ctx.userId,
        technicianEmail: ctx.email,
        event: redacted,
        createdAt: new Date().toISOString(),
      },
    }));
    return json(201, { id, recorded: true });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Unable to record audit event' });
  }
};
