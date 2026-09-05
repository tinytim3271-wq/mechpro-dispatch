import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

const secretsClient = new SecretsManagerClient({});
const INVOICE_PAYMENT_GSI_ROLLOUT_AT = Date.parse('2026-09-04T00:00:00.000Z');

export function openInvoiceBalance(invoiceAmount: unknown, payments: Record<string, unknown>[]): number {
  const paid = payments
    .filter(payment => payment.status === 'completed')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return Math.max(0, Math.round((Number(invoiceAmount || 0) - paid) * 100) / 100);
}

export function safeCheckoutUrl(value: unknown, requestOrigin: string | undefined): string | null {
  try {
    const url = new URL(String(value || ''));
    return requestOrigin && url.origin === requestOrigin && ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function headerValue(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function needsLegacyPaymentFallback(invoice: Record<string, unknown> | undefined): boolean {
  const createdAt = String(invoice?.createdAt || '').trim();
  if (!createdAt) return true;
  const createdAtMillis = Date.parse(createdAt);
  return Number.isNaN(createdAtMillis) || createdAtMillis < INVOICE_PAYMENT_GSI_ROLLOUT_AT;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Creates a Stripe Checkout Session server-side, per shop. Each subscribing
 * shop's Stripe secret key lives in Secrets Manager at
 * `mechpro/{shopId}/stripe-secret-key` — never in the browser or DynamoDB.
 * Stripe's webhook (configured separately, see webhook.ts) is the only
 * source of truth for marking a payment as completed.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin', 'office', 'service_writer']);
    const pk = `SHOP#${ctx.shopId}`;
    const body = JSON.parse(event.body || '{}');
    const { invoiceNumber } = body;
    if (!invoiceNumber) return json(400, { message: 'invoiceNumber is required' });

    const invoiceResult = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk: `INVOICE#${invoiceNumber}` } }));
    const invoice = invoiceResult.Item;
    if (!invoice) return json(404, { message: 'Invoice not found' });

    const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: `mechpro/${ctx.shopId}/stripe-secret-key` }));
    const stripeSecretKey = secret.SecretString;
    if (!stripeSecretKey) return json(409, { message: 'This shop has not connected a Stripe account yet' });

    let lastEvaluatedKey: Record<string, unknown> | undefined;
    const payments: Record<string, unknown>[] = [];
    const invoicePaymentPrefix = `${String(invoiceNumber)}#`;
    do {
      const page = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :gsi1pk and begins_with(gsi1sk, :invoicePaymentPrefix)',
        ExpressionAttributeValues: { ':gsi1pk': `${pk}#TYPE#PAYMENT`, ':invoicePaymentPrefix': invoicePaymentPrefix },
        ProjectionExpression: 'amount, #status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExclusiveStartKey: lastEvaluatedKey as any,
      }));
      lastEvaluatedKey = page.LastEvaluatedKey as any;
      payments.push(...(page.Items ?? []));
    } while (lastEvaluatedKey);
    if (!payments.length && needsLegacyPaymentFallback(invoice as Record<string, unknown> | undefined)) {
      let legacyLastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const legacyPage = await ddb.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': 'PAYMENT#', ':invoiceNumber': invoiceNumber },
          ProjectionExpression: 'invoiceNumber, amount, #status, gsi1sk',
          ExpressionAttributeNames: { '#status': 'status' },
          FilterExpression: 'invoiceNumber = :invoiceNumber',
          ExclusiveStartKey: legacyLastEvaluatedKey as any,
        }));
        legacyLastEvaluatedKey = legacyPage.LastEvaluatedKey as any;
        payments.push(...(legacyPage.Items ?? []));
      } while (legacyLastEvaluatedKey);
    }
    const balance = openInvoiceBalance(invoice.amount, payments);
    if (balance <= 0) return json(409, { message: 'Invoice has no open balance' });

    const requestOrigin = headerValue(event.headers, 'origin');
    const successUrl = safeCheckoutUrl(body.successUrl, requestOrigin);
    const cancelUrl = safeCheckoutUrl(body.cancelUrl, requestOrigin);
    if (!successUrl || !cancelUrl) return json(400, { message: 'Checkout redirects must match the requesting site' });

    const amountInCents = Math.round(balance * 100);
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountInCents),
      'line_items[0][price_data][product_data][name]': `Invoice ${invoiceNumber}`,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'metadata[shopId]': ctx.shopId,
      'metadata[invoiceNumber]': invoiceNumber,
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(stripeSecretKey + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Stripe checkout session creation failed', errorBody);
      return json(502, { message: 'Stripe rejected the checkout session request' });
    }

    const session = (await response.json()) as { url: string; id: string };
    return json(200, { url: session.url, sessionId: session.id });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
