import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export interface RequestContext {
  shopId: string;
  role: string;
  userId: string;
}

/** Every route is authorized by the Cognito JWT authorizer; shopId/role come from token claims, never from client input. */
export function requestContext(event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestContext {
  const claims = event.requestContext.authorizer.jwt.claims as Record<string, string>;
  const shopId = claims['custom:shopId'];
  const role = claims['custom:role'] || 'technician';
  const userId = claims['sub'];
  if (!shopId) throw new AuthError('Missing shopId claim on authenticated user');
  return { shopId, role, userId };
}

export class AuthError extends Error {}

export function requireRole(ctx: RequestContext, allowed: string[]) {
  if (!allowed.includes(ctx.role)) throw new AuthError(`Role ${ctx.role} is not permitted for this action`);
}
