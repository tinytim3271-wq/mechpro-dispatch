import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';
import { mintClearDtcsToken } from './capability-token';

const MUTATING_PROCEDURES = new Set([
  'clear_dtcs',
  'clearDtcs',
  'program_key',
  'add_key',
  'all_keys_lost',
  'program_remote',
  'erase_keys',
  'flash',
  'uds_write',
]);

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Authorizes local J2534 mutating operations. OEM AutoAuth credential exchange
 * remains Phase 3 (Secrets Manager) — this endpoint never returns OEM secrets.
 * For clear_dtcs, returns a short-lived HMAC-signed capability token the desktop
 * host must verify before clearing DTCs.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin', 'technician', 'service_writer']);
    const body = JSON.parse(event.body || '{}') as { vin?: string; procedure?: string };
    const vin = String(body.vin || '').trim().toUpperCase();
    const procedure = String(body.procedure || '').trim();
    if (!vin || !procedure) return json(400, { message: 'vin and procedure are required' });
    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return json(400, { message: 'vin is invalid' });

    if (MUTATING_PROCEDURES.has(procedure) && !['clear_dtcs', 'clearDtcs'].includes(procedure)) {
      return json(501, {
        message: 'OEM AutoAuth integration is not yet configured. Credentials stay in Secrets Manager (Phase 3).',
        authorized: false,
      });
    }

    if (!['clear_dtcs', 'clearDtcs'].includes(procedure)) {
      return json(400, { message: 'Unsupported procedure for local authorization' });
    }

    const minted = mintClearDtcsToken({ vin, shopId: ctx.shopId });
    return json(200, {
      authorized: true,
      procedure: 'clear_dtcs',
      vin,
      token: minted.token,
      expiresAt: minted.expiresAt,
      shopId: ctx.shopId,
    });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Authorization service unavailable' });
  }
};
