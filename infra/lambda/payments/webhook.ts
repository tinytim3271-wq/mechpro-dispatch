import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ddb, TABLE_NAME } from '../common/ddb';

const secretsClient = new SecretsManagerClient({});

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Verifies Stripe's `Stripe-Signature` header per Stripe's documented HMAC-SHA256 scheme. */
function verifyStripeSignature(payload: string, signatureHeader: string, webhookSecret: string): boolean {
  const parts = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=') as [string, string]));
  const timestamp = parts['t'];
  const providedSignature = parts['v1'];
  if (!timestamp || !providedSignature) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(providedSignature, 'hex');
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Stripe webhook endpoint (not behind the Cognito authorizer — Stripe calls
 * this directly). This is the only place a payment is marked "completed";
 * the client-created checkout session is never trusted on its own.
 * Register this URL + webhook secret per shop in the shop's Stripe dashboard.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const shopId = event.pathParameters?.shopId;
  const signatureHeader = event.headers['stripe-signature'];
  const payload = event.body || '';
  if (!shopId || !signatureHeader) return json(400, { message: 'Missing shopId or Stripe-Signature header' });

  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: `mechpro/${shopId}/stripe-webhook-secret` }));
  const webhookSecret = secret.SecretString;
  if (!webhookSecret || !verifyStripeSignature(payload, signatureHeader, webhookSecret)) {
    return json(400, { message: 'Invalid Stripe signature' });
  }

  const event_ = JSON.parse(payload);
  if (event_.type === 'checkout.session.completed') {
    const session = event_.data.object;
    const invoiceNumber = session.metadata?.invoiceNumber;
    if (invoiceNumber) {
      const pk = `SHOP#${shopId}`;
      const id = session.id as string;
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk,
          sk: `PAYMENT#${id}`,
          gsi1pk: `${pk}#TYPE#PAYMENT`,
          gsi1sk: `${new Date().toISOString()}#${id}`,
          id,
          invoiceNumber,
          amount: (session.amount_total || 0) / 100,
          method: 'processor',
          processor: 'stripe',
          processorTransactionId: id,
          status: 'completed',
          receivedAt: new Date().toISOString(),
          shopId,
        },
      }));
    }
  }

  return json(200, { received: true });
};
