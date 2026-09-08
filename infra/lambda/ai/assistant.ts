import { BedrockRuntimeClient, ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 5, retryMode: 'adaptive' });
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';
const MAX_MESSAGE_LENGTH = 4000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

async function shopContext(shopId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `SHOP#${shopId}` },
    ProjectionExpression: 'sk, id, #name, #status, customer, vehicle, amount, due, tech, promise, complaint',
    ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
  }));
  const items = (result.Items || []).filter(item => !String(item.sk || '').startsWith('EMPLOYEE#')).slice(0, 120);
  return items.map(item => ({ type: String(item.sk || '').split('#')[0], id: item.id, name: item.name, status: item.status, customer: item.customer, vehicle: item.vehicle, amount: item.amount, due: item.due, technician: item.tech, promise: item.promise, concern: item.complaint }));
}

async function assertWithinRateLimit(shopId: string, userId: string) {
  const pk = `SHOP#${shopId}`;
  const sk = `AITHROTTLE#${userId}`;
  const now = Date.now();
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk } }));
  const windowStart = Number(existing.Item?.windowStart || 0);
  const count = Number(existing.Item?.count || 0);
  if (windowStart && now - windowStart < RATE_LIMIT_WINDOW_MS && count >= RATE_LIMIT_MAX) {
    throw new AuthError('Assistant rate limit exceeded. Try again in a minute.');
  }
  const nextWindowStart = !windowStart || now - windowStart >= RATE_LIMIT_WINDOW_MS ? now : windowStart;
  const nextCount = nextWindowStart === windowStart ? count + 1 : 1;
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { pk, sk, windowStart: nextWindowStart, count: nextCount, updatedAt: new Date().toISOString() },
  }));
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin', 'office', 'service_writer', 'technician']);
    await assertWithinRateLimit(ctx.shopId, ctx.userId);
    const body = JSON.parse(event.body || '{}') as { message?: string; history?: Message[] };
    const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) return json(400, { message: 'A message is required' });
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const context = await shopContext(ctx.shopId);
    const system = `You are MechPro Voice Assistant for an automotive repair shop. Be concise and conversational because your answer may be spoken aloud. Help staff with shop operations, diagnostics education, customer communication, work orders, invoices, and scheduling. Never invent customer records, prices, appointment availability, payment status, or repair certainty. Treat the shop data below as private. You may explain and recommend, but do not claim that you changed a record or collected a card payment. For safety-critical automotive questions, recommend current manufacturer service information and qualified technician verification. Shop data: ${JSON.stringify(context)}`;
    const response = await bedrock.send(new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [...history, { role: 'user', content: [{ text: message }] }],
      inferenceConfig: { maxTokens: 700, temperature: 0.3 },
    }));
    const text = response.output?.message?.content?.find(block => block.text)?.text || 'I could not produce an answer right now.';
    return json(200, { message: text, model: MODEL_ID });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(502, { message: 'The live assistant is temporarily unavailable.' });
  }
};
