import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, AuthError } from '../common/auth';
import { normalizeWave1EntityPayload, normalizeWave1EntityType } from '../../contracts/wave1-alignment';

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
  conversations: 'CONVERSATION',
  chatmessages: 'CHATMESSAGE',
  inventory: 'INVENTORY',
  vendors: 'VENDOR',
  services: 'SERVICE',
  inspectiontemplates: 'INSPECTIONTEMPLATE',
  inspections: 'INSPECTION',
  reminders: 'REMINDER',
  shopsettings: 'SHOPSETTING',
  appointments: 'APPOINTMENT',
  purchases: 'PURCHASE',
};

export function entityPrefix(entityType: unknown) {
  return ENTITY_PREFIXES[String(normalizeWave1EntityType(entityType) || '').toLowerCase()];
}

const CHAT_TYPES = new Set(['conversations', 'chatmessages']);
const FINANCIAL_WRITE_ROLES: Record<string, string[]> = {
  invoices: ['admin', 'office', 'service_writer'],
  payments: ['admin', 'office', 'service_writer'],
  expenses: ['admin', 'office'],
  payrollentries: ['admin'],
};

function memberEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(email => String(email).trim().toLowerCase()).filter(Boolean))];
}

function canReadChat(item: Record<string, unknown>, email: string): boolean {
  return memberEmails(item.memberEmails).includes(email);
}

export function deletionConflict(
  entityType: string,
  target: Record<string, unknown>,
  items: Record<string, unknown>[],
) {
  if (entityType === 'customers') {
    const customerName = String(target.name || '');
    const linked = items.some(item =>
      ['VEHICLE#', 'ORDER#', 'INVOICE#'].some(prefix => String(item.sk || '').startsWith(prefix))
      && item.customer === customerName,
    );
    return linked ? 'Delete this customer\'s vehicles, work orders, and invoices first' : null;
  }
  return null;
}

async function getEntity(pk: string, prefix: string, id: string) {
  return ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk: `${prefix}#${id}` } }));
}

async function visibleChatItems(pk: string, entityType: string, items: Record<string, unknown>[], email: string) {
  if (entityType === 'conversations') return items.filter(item => canReadChat(item, email));
  if (entityType !== 'chatmessages') return items;
  const conversations = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': `${ENTITY_PREFIXES.conversations}#` },
  }));
  const allowedIds = new Set((conversations.Items ?? []).filter(item => canReadChat(item, email)).map(item => item.id));
  return items.filter(item => allowedIds.has(item.conversationId));
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    const rawEntityType = event.pathParameters?.type;
    const entityType = normalizeWave1EntityType(rawEntityType);
    const id = event.pathParameters?.id;
    const prefix = entityPrefix(entityType);
    if (!prefix) return json(404, { message: `Unknown entity type: ${entityType}` });

    const pk = `SHOP#${ctx.shopId}`;
    const method = event.requestContext.http.method;

    if (entityType === 'employees' && method !== 'GET' && ctx.role !== 'admin') {
      return json(403, { message: 'Only administrators can manage employee profiles' });
    }
    const allowedFinancialRoles = FINANCIAL_WRITE_ROLES[entityType!];
    if (allowedFinancialRoles && method !== 'GET' && !allowedFinancialRoles.includes(ctx.role)) {
      return json(403, { message: `Role ${ctx.role} cannot modify ${entityType}` });
    }

    if (method === 'GET' && !id) {
      const result = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': `${prefix}#` },
      }));
      const items = (result.Items ?? []) as Record<string, unknown>[];
      return json(200, await visibleChatItems(pk, entityType!, items, ctx.email));
    }

    if (method === 'GET' && id) {
      const result = await getEntity(pk, prefix, id);
      if (result.Item && CHAT_TYPES.has(entityType!)) {
        const visible = await visibleChatItems(pk, entityType!, [result.Item], ctx.email);
        if (!visible.length) return json(404, { message: 'Not found' });
      }
      return result.Item ? json(200, result.Item) : json(404, { message: 'Not found' });
    }

    if (method === 'POST') {
      let body = normalizeWave1EntityPayload(rawEntityType, JSON.parse(event.body || '{}'));
      if (entityType === 'conversations') {
        const kind = String(body.kind || '');
        if (!['direct', 'group'].includes(kind)) return json(400, { message: 'Conversation kind must be direct or group' });
        if (kind === 'group' && ctx.role !== 'admin') return json(403, { message: 'Only owners can create group conversations' });
        const members = memberEmails(body.memberEmails);
        if (!members.includes(ctx.email) || members.length < 2) return json(400, { message: 'Conversation requires the creator and at least one other member' });
        body = { ...body, kind, memberEmails: members, creatorEmail: ctx.email };
      }
      if (entityType === 'chatmessages') {
        if (!body.conversationId || !String(body.body || '').trim()) return json(400, { message: 'Conversation and message body are required' });
        const conversation = await getEntity(pk, ENTITY_PREFIXES.conversations, String(body.conversationId));
        if (!conversation.Item || !canReadChat(conversation.Item, ctx.email)) return json(404, { message: 'Conversation not found' });
        body = {
          ...body,
          body: String(body.body).trim().slice(0, 4000),
          memberEmails: memberEmails(conversation.Item.memberEmails),
          senderEmail: ctx.email,
        };
      }
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
      const body = normalizeWave1EntityPayload(rawEntityType, JSON.parse(event.body || '{}'));
      if (entityType === 'chatmessages') return json(405, { message: 'Chat messages cannot be edited' });
      if (entityType === 'conversations') {
        const existing = await getEntity(pk, prefix, id);
        if (!existing.Item || !canReadChat(existing.Item, ctx.email)) return json(404, { message: 'Conversation not found' });
        if (existing.Item.kind !== 'group' || ctx.role !== 'admin') return json(403, { message: 'Only owners can edit group conversations' });
        const members = memberEmails(body.memberEmails);
        if (!members.includes(ctx.email) || members.length < 2) return json(400, { message: 'Group requires the owner and at least one other member' });
        body.memberEmails = members;
        body.creatorEmail = existing.Item.creatorEmail;
        body.createdBy = existing.Item.createdBy;
      }
      const expectedUpdatedAt = event.headers?.['if-match'];
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
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ...(expectedUpdatedAt ? {
          ConditionExpression: 'attribute_not_exists(updatedAt) OR updatedAt = :expectedUpdatedAt',
          ExpressionAttributeValues: { ':expectedUpdatedAt': expectedUpdatedAt },
        } : {}),
      }));
      return json(200, item);
    }

    if (method === 'DELETE' && id) {
      if (CHAT_TYPES.has(entityType!)) {
        const existing = await getEntity(pk, prefix, id);
        const visible = existing.Item ? await visibleChatItems(pk, entityType!, [existing.Item], ctx.email) : [];
        if (!existing.Item || !visible.length) return json(404, { message: 'Not found' });
        if (ctx.role !== 'admin' && existing.Item.createdBy !== ctx.userId) return json(403, { message: 'Not permitted' });
      }
      if (entityType === 'customers' || entityType === 'invoices') {
        const [existing, records] = await Promise.all([
          getEntity(pk, prefix, id),
          ddb.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': pk },
          })),
        ]);
        if (!existing.Item) return json(404, { message: 'Not found' });
        const conflict = deletionConflict(entityType, existing.Item, (records.Items ?? []) as Record<string, unknown>[]);
        if (conflict) return json(409, { message: conflict });
        if (entityType === 'invoices') {
          const invoiceNumber = String(existing.Item.number || existing.Item.id || '');
          const payments = ((records.Items ?? []) as Record<string, unknown>[]).filter(item =>
            String(item.sk || '').startsWith('PAYMENT#') && item.invoiceNumber === invoiceNumber,
          );
          for (let index = 0; index < payments.length; index += 25) {
            await ddb.send(new BatchWriteCommand({
              RequestItems: {
                [TABLE_NAME]: payments.slice(index, index + 25).map(item => ({ DeleteRequest: { Key: { pk: item.pk, sk: item.sk } } })),
              },
            }));
          }
        }
      }
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk: `${prefix}#${id}` } }));
      return json(204, {});
    }

    return json(405, { message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return json(409, { message: 'Record changed while this device was offline' });
    }
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
