import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { AuthError, requestContext } from '../common/auth';
import { ddb, TABLE_NAME } from '../common/ddb';

export interface SubscriptionAccount {
  suspended?: boolean;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string;
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function subscriptionEntitlement(account: SubscriptionAccount | undefined, now = new Date()) {
  if (!account) return { active: false, status: 'missing', expiresAt: null };
  const status = String(account.subscriptionStatus || 'active').toLowerCase();
  const expiresAt = account.subscriptionExpiresAt || null;
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
  const active = account.suspended !== true && ACTIVE_STATUSES.has(status) && !expired;
  return { active, status: account.suspended ? 'suspended' : expired ? 'expired' : status, expiresAt };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    if (ctx.role === 'super_admin') return json(200, { active: true, status: 'platform', expiresAt: null });
    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: 'PLATFORM', sk: `ACCOUNT#${ctx.shopId}` },
      ProjectionExpression: 'suspended, subscriptionStatus, subscriptionExpiresAt',
    }));
    const entitlement = subscriptionEntitlement(result.Item as SubscriptionAccount | undefined);
    return json(entitlement.active ? 200 : 403, entitlement);
  } catch (error) {
    if (error instanceof AuthError) return json(403, { active: false, status: 'unauthorized', expiresAt: null });
    console.error(error);
    return json(500, { active: false, status: 'unavailable', expiresAt: null });
  }
};