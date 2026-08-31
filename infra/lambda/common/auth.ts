import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './ddb';

export interface RequestContext {
  shopId: string;
  role: string;
  userId: string;
  email: string;
}

/** Every route is authorized by the Cognito JWT authorizer; shopId/role come from token claims, never from client input. */
export function requestContext(event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestContext {
  const claims = event.requestContext.authorizer.jwt.claims as Record<string, string>;
  const shopId = claims['custom:shopId'];
  const role = claims['custom:role'] || 'technician';
  const userId = claims['sub'];
  const email = String(claims['email'] || '').trim().toLowerCase();
  if (!shopId) throw new AuthError('Missing shopId claim on authenticated user');
  if (!email) throw new AuthError('Missing email claim on authenticated user');
  return { shopId, role, userId, email };
}

export class AuthError extends Error {}

export function requireRole(ctx: RequestContext, allowed: string[]) {
  if (!allowed.includes(ctx.role)) throw new AuthError(`Role ${ctx.role} is not permitted for this action`);
}

/** Rechecks platform account state so suspension also blocks JWTs issued before the status change. */
export async function requireActiveAccount(ctx: RequestContext) {
  if (ctx.role === 'super_admin') return;
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: 'PLATFORM', sk: `ACCOUNT#${ctx.shopId}` },
    ProjectionExpression: 'suspended',
  }));
  if (result.Item?.suspended === true) throw new AuthError('Customer account is suspended');
}
