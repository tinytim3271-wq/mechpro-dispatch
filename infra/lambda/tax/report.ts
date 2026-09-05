import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';
import { roundCurrency } from '../common/money';

export interface PaymentRecord {
  invoiceNumber: string;
  customer: string;
  amount: number;
  receivedAt: string;
  status: string;
}

export interface Invoice {
  number: string;
  amount: number;
  subtotal?: number;
  tax?: number;
  taxRate?: number;
}

/** Server-side port of the client tax-report logic in app.js (invoiceTaxBreakdown / taxReport). */
export function invoiceTaxBreakdown(invoice: Invoice | undefined, fallbackRate: number) {
  if (!invoice) return { subtotal: 0, tax: 0, taxRate: fallbackRate };
  if (typeof invoice.tax === 'number' && typeof invoice.subtotal === 'number') {
    return { subtotal: invoice.subtotal, tax: invoice.tax, taxRate: invoice.taxRate ?? fallbackRate };
  }
  const subtotal = roundCurrency(invoice.amount / (1 + fallbackRate / 100));
  const tax = roundCurrency(invoice.amount - subtotal);
  return { subtotal, tax, taxRate: fallbackRate };
}

export function buildTaxReport(
  payments: PaymentRecord[],
  invoices: Invoice[],
  fallbackRate: number,
  from: string,
  to: string,
) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setUTCHours(23, 59, 59, 999);
  const rows = payments
    .filter(payment => payment.status === 'completed')
    .filter(payment => {
      const date = new Date(payment.receivedAt);
      return date >= fromDate && date <= toDate;
    })
    .map(payment => {
      const invoice = invoices.find(item => item.number === payment.invoiceNumber);
      const breakdown = invoiceTaxBreakdown(invoice, fallbackRate);
      const ratio = invoice ? payment.amount / (invoice.amount || payment.amount) : 0;
      return {
        date: payment.receivedAt,
        invoiceNumber: payment.invoiceNumber,
        customer: payment.customer,
        gross: payment.amount,
        taxable: roundCurrency(breakdown.subtotal * ratio),
        tax: roundCurrency(breakdown.tax * ratio),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const totals = rows.reduce(
    (acc, row) => ({
      gross: roundCurrency(acc.gross + row.gross),
      taxable: roundCurrency(acc.taxable + row.taxable),
      tax: roundCurrency(acc.tax + row.tax),
    }),
    { gross: 0, taxable: 0, tax: 0 },
  );
  return { rows, totals };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin', 'office']);
    const pk = `SHOP#${ctx.shopId}`;
    const from = event.queryStringParameters?.from;
    const to = event.queryStringParameters?.to;
    if (!from || !to) return json(400, { message: 'from and to query parameters are required (YYYY-MM-DD)' });

    const [paymentsResult, invoicesResult, settingsResult] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'PAYMENT#' },
      })),
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'INVOICE#' },
      })),
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and sk = :sk',
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'SETTINGS#tax' },
      })),
    ]);

    const payments = (paymentsResult.Items ?? []) as PaymentRecord[];
    const invoices = (invoicesResult.Items ?? []) as Invoice[];
    const taxSettings = settingsResult.Items?.[0] ?? { state: 'TX', rate: 8.25, taxId: '', filingFrequency: 'Monthly' };

    const { rows, totals } = buildTaxReport(payments, invoices, taxSettings.rate as number, from, to);

    return json(200, { from, to, state: taxSettings.state, taxId: taxSettings.taxId, filingFrequency: taxSettings.filingFrequency, rows, totals });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
