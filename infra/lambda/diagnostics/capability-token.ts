import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type CapabilityPayload = {
  v: 1;
  procedure: 'clear_dtcs';
  vin: string;
  shopId: string;
  exp: number;
  jti: string;
};

function secret(): string {
  const configured = String(
    process.env.DIAGNOSTICS_CAPABILITY_SECRET
    || process.env.MECHPRO_DIAG_CAPABILITY_SECRET
    || '',
  ).trim();
  const fallback = 'mechpro-dev-diagnostics-capability-v1';
  const allowDev = process.env.ALLOW_DEV_DIAGNOSTICS_SECRET === '1';
  const value = configured || (allowDev ? fallback : '');
  if (!value) {
    throw new Error('DIAGNOSTICS_CAPABILITY_SECRET is not configured');
  }
  // Refuse the shared dev default inside Lambda unless explicitly allowed.
  if (
    value === fallback
    && process.env.AWS_LAMBDA_FUNCTION_NAME
    && !allowDev
  ) {
    throw new Error('Refusing default diagnostics capability secret in Lambda');
  }
  return value;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signPayload(payloadJson: string): string {
  return createHmac('sha256', secret()).update(payloadJson).digest('base64url');
}

export function mintClearDtcsToken(input: { vin: string; shopId: string; ttlMs?: number }): {
  token: string;
  expiresAt: string;
  payload: CapabilityPayload;
} {
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  const payload: CapabilityPayload = {
    v: 1,
    procedure: 'clear_dtcs',
    vin: String(input.vin).trim().toUpperCase(),
    shopId: String(input.shopId).trim(),
    exp: Date.now() + ttlMs,
    jti: randomBytes(12).toString('hex'),
  };
  const payloadJson = JSON.stringify(payload);
  const token = `v1.${b64url(payloadJson)}.${signPayload(payloadJson)}`;
  return { token, expiresAt: new Date(payload.exp).toISOString(), payload };
}

export function verifyClearDtcsToken(token: string, expected?: { vin?: string; shopId?: string }): CapabilityPayload {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid diagnostics capability token');
  }
  const payloadJson = fromB64url(parts[1]).toString('utf8');
  const expectedSig = signPayload(payloadJson);
  const providedSig = parts[2];
  const a = fromB64url(expectedSig);
  const b = fromB64url(providedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid diagnostics capability token signature');
  }
  const payload = JSON.parse(payloadJson) as CapabilityPayload;
  if (payload.v !== 1 || payload.procedure !== 'clear_dtcs') {
    throw new Error('Capability token is not valid for clearDtcs');
  }
  if (!payload.vin || !payload.shopId || !payload.jti || !payload.exp) {
    throw new Error('Capability token payload is incomplete');
  }
  if (Date.now() > Number(payload.exp)) {
    throw new Error('Capability token expired');
  }
  if (expected?.vin && payload.vin !== String(expected.vin).trim().toUpperCase()) {
    throw new Error('Capability token VIN mismatch');
  }
  if (expected?.shopId && payload.shopId !== String(expected.shopId).trim()) {
    throw new Error('Capability token shop mismatch');
  }
  return payload;
}
