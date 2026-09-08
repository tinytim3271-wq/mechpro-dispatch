import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ddb, TABLE_NAME } from '../common/ddb';
import { paymentGsiSortKey } from './payment-key';

const secretsClient = new SecretsManagerClient({});

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Verifies Stripe's `Stripe-Signature` header per Stripe's documented HMAC-SHA256 scheme. */
export function verifyStripeSignature(payload: string, signatureHeader: string, webhookSecret: string, nowSeconds = Date.now() / 1000): boolean {
  const parts = signatureHeader.split(',').map(part => part.trim().split('=', 2) as [string, string]);
  const timestamp = parts.find(([key]) => key.trim() === 't')?.[1]?.trim();
  const providedSignatures = parts.filter(([key]) => key.trim() === 'v1').map(([, value]) => value.trim());
  if (!timestamp || !/^\d+$/.test(timestamp) || !providedSignatures.length || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return providedSignatures.some(providedSignature => {
    const providedBuf = Buffer.from(providedSignature, 'hex');
    return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  });
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
    if (invoiceNumber && session.metadata?.shopId === shopId && session.payment_status === 'paid' && session.currency === 'usd') {
      const pk = `SHOP#${shopId}`;
      const id = session.id as string;
      const paymentSk = `PAYMENT#${invoiceNumber}#${id}`;
      const existingPayment = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk: paymentSk },
      }));
      if (!existingPayment.Item) {
        const legacyPayment = await ddb.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk, sk: `PAYMENT#${id}` },
        }));
        if (legacyPayment.Item) return json(200, { received: true, duplicate: true });
      } else {
        return json(200, { received: true, duplicate: true });
      }
      const invoiceResult = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk: `INVOICE#${invoiceNumber}` },
      }));
      if (!invoiceResult.Item) return json(400, { message: 'Invoice not found' });
      let alreadyPaid = 0;
      let lastKey: Record<string, unknown> | undefined;
      const paymentPrefix = `PAYMENT#${invoiceNumber}#`;
      do {
        const paymentsResult = await ddb.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': paymentPrefix },
          ProjectionExpression: 'amount, #status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExclusiveStartKey: lastKey,
        }));
        alreadyPaid += (paymentsResult.Items ?? [])
          .filter(payment => payment.status === 'completed')
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        lastKey = paymentsResult.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      const amount = Number(session.amount_total || 0) / 100;
      const balance = Math.max(0, Math.round((Number(invoiceResult.Item.amount || 0) - alreadyPaid) * 100) / 100);
      if (amount <= 0 || amount > balance) return json(400, { message: 'Payment amount exceeds the invoice balance' });
      try {
        await ddb.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk,
            sk: paymentSk,
            gsi1pk: `${pk}#TYPE#PAYMENT`,
            gsi1sk: paymentGsiSortKey(String(invoiceNumber), new Date().toISOString(), String(id)),
            id,
            primarySk: paymentSk,
            invoiceNumber,
            amount,
            method: 'processor',
            processor: 'stripe',
            processorTransactionId: id,
            status: 'completed',
            receivedAt: new Date().toISOString(),
            shopId,
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }));
      } catch (error) {
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
        return json(200, { received: true, duplicate: true });
      }
    }
  }

  return json(200, { received: true });
};
