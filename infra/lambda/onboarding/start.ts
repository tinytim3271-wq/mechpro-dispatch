import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

const SAMPLE_ORDER_IDS = new Set(['RO-1044', 'RO-1046', 'RO-1048', 'RO-1049', 'RO-1050', 'RO-1051', 'RO-1052']);
const SAMPLE_INVOICE_IDS = new Set(['INV-2032', 'INV-2036', 'INV-2040', 'INV-2041']);
const SAMPLE_CUSTOMERS = new Set([
  'Maria Hernandez',
  'West Texas Plumbing',
  'Derek Mills',
  'Ashley Nguyen',
  'Caleb Foster',
  'Lubbock Floral',
]);
const SAMPLE_EXPENSES = new Set([
  'South Plains Auto Parts|Brake rotor inventory replenishment|412.87',
  'City of Lubbock|Shop electric service|286.14',
]);

export function isSampleRecord(item: Record<string, unknown>) {
  if (item.sampleData === true) return true;
  const sortKey = String(item.sk || '');
  const id = String(item.id || '');
  if (sortKey.startsWith('ORDER#')) return SAMPLE_ORDER_IDS.has(id);
  if (sortKey.startsWith('INVOICE#')) return SAMPLE_INVOICE_IDS.has(String(item.number || id));
  if (sortKey.startsWith('CUSTOMER#')) return SAMPLE_CUSTOMERS.has(String(item.name || ''));
  if (sortKey.startsWith('EXPENSE#')) {
    return SAMPLE_EXPENSES.has(`${item.vendor || ''}|${item.memo || ''}|${Number(item.amount || 0)}`);
  }
  return false;
}

export function isResettableShopRecord(item: Record<string, unknown>) {
  return !String(item.sk || '').startsWith('EMPLOYEE#');
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function sampleRecords(pk: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': pk },
  }));
  return (result.Items ?? []).filter(isSampleRecord);
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin']);
    const pk = `SHOP#${ctx.shopId}`;
    const records = await sampleRecords(pk);

    if (event.requestContext.http.method === 'GET') {
      return json(200, { sampleRecords: records.length });
    }
    if (event.requestContext.http.method !== 'POST') {
      return json(405, { message: 'Method not allowed' });
    }

    const body = JSON.parse(event.body || '{}');
    const resetAll = body.mode === 'all' && body.confirmation === 'DELETE ALL DATA';
    if (body.mode === 'all' && !resetAll) {
      return json(400, { message: 'Type DELETE ALL DATA to confirm the reset' });
    }
    const recordsToDelete = resetAll
      ? (await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
      }))).Items?.filter(isResettableShopRecord) ?? []
      : records;

    for (let index = 0; index < recordsToDelete.length; index += 25) {
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: recordsToDelete.slice(index, index + 25).map(item => ({
            DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
          })),
        },
      }));
    }

    const startedAt = new Date().toISOString();
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk,
        sk: 'SHOPSETTING#onboarding',
        id: 'onboarding',
        shopId: ctx.shopId,
        startedAt,
        sampleRecordsRemoved: resetAll ? 0 : recordsToDelete.length,
        allShopDataRemoved: resetAll,
        updatedAt: startedAt,
      },
    }));
    return json(200, { startedAt, removed: recordsToDelete.length, mode: resetAll ? 'all' : 'samples' });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};