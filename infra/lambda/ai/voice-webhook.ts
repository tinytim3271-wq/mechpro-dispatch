import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { activeShop, answer, getSecret } from './voice-assistant';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function headerValue(headers: Record<string, string | undefined>, name: string): string {
  const exact = headers[name];
  if (exact) return exact;
  const lower = name.toLowerCase();
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  return found?.[1] || '';
}

export function verifyVoiceWebhookSignature(payload: string, signature: string, timestamp: string, secret: string, nowSeconds = Date.now() / 1000) {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature || '');
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function webhookSecret(shopId: string) {
  return getSecret(`mechpro/${shopId}/voice-webhook-secret`);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const shopId = String(event.pathParameters?.shopId || '');
    const payload = event.body || '';
    const signature = headerValue(event.headers || {}, 'x-webhook-signature');
    const timestamp = headerValue(event.headers || {}, 'x-webhook-timestamp');
    if (!shopId || !signature || !timestamp) return json(400, { message: 'Missing webhook authentication' });
    const [secret, isActive] = await Promise.all([webhookSecret(shopId), activeShop(shopId)]);
    if (!isActive) return json(403, { message: 'Shop account is suspended' });
    if (!secret || !verifyVoiceWebhookSignature(payload, signature, timestamp, secret)) return json(401, { message: 'Invalid webhook signature' });
    const body = JSON.parse(payload) as { event?: string; channel?: string; data?: { transcript?: string; message?: string }; recentHistory?: Array<{ content?: string; direction?: string; channel?: string }> };
    if (body.event === 'assistant.call_ended') return json(200, { received: true });
    if (body.event !== 'assistant.message' || !body.data || !['voice', 'sms', 'mms', 'imessage'].includes(String(body.channel))) return json(200, { received: true });
    const transcript = String(body.data.transcript || body.data.message || '').trim();
    if (!transcript) return json(200, { text: 'How can I help you today?' });
    return json(200, await answer(shopId, transcript, body.recentHistory || []));
  } catch (error) {
    console.error(error);
    return json(500, { message: 'Webhook processing failed' });
  }
};
