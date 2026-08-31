import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Phase 3 stub — AutoAuth token exchange. Credentials live in Secrets Manager, not the client. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin']);
    const body = JSON.parse(event.body || '{}') as { vin?: string; procedure?: string };
    if (!body.vin || !body.procedure) return json(400, { message: 'vin and procedure are required' });
    return json(501, {
      message: 'AutoAuth integration is not yet configured. Configure AUTOAUTH_SECRET in Secrets Manager (Phase 3).',
      vin: body.vin,
      procedure: body.procedure,
    });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Authorization service unavailable' });
  }
};
