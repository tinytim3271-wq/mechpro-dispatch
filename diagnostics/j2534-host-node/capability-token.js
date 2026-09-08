/**
 * HMAC-signed diagnostics capability tokens (clear_dtcs).
 * Must stay compatible with infra/lambda/diagnostics/capability-token.ts
 */
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const consumedJti = new Set();

function secret() {
  return String(
    process.env.MECHPRO_DIAG_CAPABILITY_SECRET
    || process.env.DIAGNOSTICS_CAPABILITY_SECRET
    || 'mechpro-dev-diagnostics-capability-v1',
  ).trim();
}

function signPayload(payloadJson) {
  return createHmac('sha256', secret()).update(payloadJson).digest('base64url');
}

function verifyClearDtcsToken(token, expected = {}) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid diagnostics capability token');
  }
  const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
  const expectedSig = signPayload(payloadJson);
  const providedSig = parts[2];
  const expectedBuf = Buffer.from(expectedSig, 'base64url');
  const providedBuf = Buffer.from(providedSig, 'base64url');
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new Error('Invalid diagnostics capability token signature');
  }
  const payload = JSON.parse(payloadJson);
  if (payload.v !== 1 || payload.procedure !== 'clear_dtcs') {
    throw new Error('Capability token is not valid for clearDtcs');
  }
  if (!payload.vin || !payload.shopId || !payload.jti || !payload.exp) {
    throw new Error('Capability token payload is incomplete');
  }
  if (Date.now() > Number(payload.exp)) {
    throw new Error('Capability token expired');
  }
  if (expected.vin && payload.vin !== String(expected.vin).trim().toUpperCase()) {
    throw new Error('Capability token VIN mismatch');
  }
  if (expected.consume !== false) {
    if (consumedJti.has(payload.jti)) {
      throw new Error('Capability token already used');
    }
    consumedJti.add(payload.jti);
    if (consumedJti.size > 500) {
      const first = consumedJti.values().next().value;
      consumedJti.delete(first);
    }
  }
  return payload;
}

function mintClearDtcsToken(input, ttlMs = 5 * 60 * 1000) {
  const payload = {
    v: 1,
    procedure: 'clear_dtcs',
    vin: String(input.vin || '').trim().toUpperCase(),
    shopId: String(input.shopId || 'local').trim(),
    exp: Date.now() + ttlMs,
    jti: randomBytes(12).toString('hex'),
  };
  const payloadJson = JSON.stringify(payload);
  const token = `v1.${Buffer.from(payloadJson).toString('base64url')}.${signPayload(payloadJson)}`;
  return { token, expiresAt: new Date(payload.exp).toISOString(), payload };
}

module.exports = { verifyClearDtcsToken, mintClearDtcsToken };
