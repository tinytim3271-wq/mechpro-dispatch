import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, AuthError } from '../common/auth';

const secretsClient = new SecretsManagerClient({});

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

    const amountInCents = Math.round(Number(invoice.amount) * 100);
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountInCents),
      'line_items[0][price_data][product_data][name]': `Invoice ${invoiceNumber}`,
      'line_items[0][quantity]': '1',
      success_url: `${body.successUrl || ''}`,
      cancel_url: `${body.cancelUrl || ''}`,
      'metadata[shopId]': ctx.shopId,
      'metadata[invoiceNumber]': invoiceNumber,
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
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
