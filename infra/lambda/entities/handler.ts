import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, AuthError } from '../common/auth';

/** Entity types this generic CRUD handler serves. Each maps to a DynamoDB sort-key prefix. */
const ENTITY_PREFIXES: Record<string, string> = {
  customers: 'CUSTOMER',
  vehicles: 'VEHICLE',
  orders: 'ORDER',
  invoices: 'INVOICE',
  expenses: 'EXPENSE',
  estimates: 'ESTIMATE',
  payments: 'PAYMENT',
  employees: 'EMPLOYEE',
  shiftentries: 'SHIFTENTRY',
  jobclockentries: 'JOBCLOCKENTRY',
  payrollentries: 'PAYROLLENTRY',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    const entityType = event.pathParameters?.type;
    const id = event.pathParameters?.id;
    const prefix = entityType ? ENTITY_PREFIXES[entityType] : undefined;
    if (!prefix) return json(404, { message: `Unknown entity type: ${entityType}` });

    const pk = `SHOP#${ctx.shopId}`;
    const method = event.requestContext.http.method;

    if (method === 'GET' && !id) {
      const result = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': `${prefix}#` },
      }));
      return json(200, result.Items ?? []);
    }

    if (method === 'GET' && id) {
      const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk: `${prefix}#${id}` } }));
      return result.Item ? json(200, result.Item) : json(404, { message: 'Not found' });
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const newId = body.id || randomUUID();
      const item = {
        ...body,
        id: newId,
        pk,
        sk: `${prefix}#${newId}`,
        gsi1pk: `${pk}#TYPE#${prefix}`,
        gsi1sk: `${body.date || body.createdAt || newId}#${newId}`,
        shopId: ctx.shopId,
        createdBy: ctx.userId,
        updatedAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return json(201, item);
    }

    if (method === 'PUT' && id) {
      const body = JSON.parse(event.body || '{}');
      const item = {
        ...body,
        id,
        pk,
        sk: `${prefix}#${id}`,
        gsi1pk: `${pk}#TYPE#${prefix}`,
        gsi1sk: `${body.date || body.createdAt || id}#${id}`,
        shopId: ctx.shopId,
        updatedAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return json(200, item);
    }

    if (method === 'DELETE' && id) {
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk: `${prefix}#${id}` } }));
      return json(204, {});
    }

    return json(405, { message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
