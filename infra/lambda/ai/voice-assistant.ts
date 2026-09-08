import { BedrockRuntimeClient, ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 5, retryMode: 'adaptive' });
const secrets = new SecretsManagerClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';
const MAX_MESSAGE_LENGTH = 4000;

type RecentHistoryEntry = { content?: string; direction?: string; channel?: string };

async function shopContext(shopId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `SHOP#${shopId}` },
    ProjectionExpression: 'sk, id, #name, #status, customer, vehicle, amount, due, tech, promise, complaint',
    ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
  }));
  const items = (result.Items || []).filter(item => !String(item.sk || '').startsWith('EMPLOYEE#')).slice(0, 120);
  return items.map(item => ({
    type: String(item.sk || '').split('#')[0],
    id: item.id,
    name: item.name,
    status: item.status,
    customer: item.customer,
    vehicle: item.vehicle,
    amount: item.amount,
    due: item.due,
    technician: item.tech,
    promise: item.promise,
    concern: item.complaint,
  }));
}

function historyMessages(history: RecentHistoryEntry[]): Message[] {
  const messages: Message[] = [];
  for (const entry of history.slice(-10)) {
    const text = String(entry.content || '').trim();
    if (!text) continue;
    const role = (String(entry.direction || '').toLowerCase() === 'outbound' ? 'assistant' : 'user') as Message['role'];
    messages.push({ role, content: [{ text }] });
  }
  return messages;
}

export async function activeShop(shopId: string): Promise<boolean> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: 'PLATFORM', sk: `ACCOUNT#${shopId}` },
    ProjectionExpression: 'suspended',
  }));
  return result.Item?.suspended !== true;
}

export async function getSecret(secretId: string): Promise<string> {
  try {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    return String(result.SecretString || '').trim();
  } catch (error) {
    if ((error as { name?: string }).name === 'ResourceNotFoundException') return '';
    throw error;
  }
}

export async function answer(shopId: string, transcript: string, recentHistory: RecentHistoryEntry[]) {
  const message = String(transcript || '').trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return { text: 'How can I help you today?', model: MODEL_ID };
  const context = await shopContext(shopId);
  const system = `You are MechPro Voice Assistant for an automotive repair shop. Keep responses concise and conversational for spoken playback. Use only known shop data and avoid inventing records, prices, appointment availability, or payment status. For safety-critical automotive guidance, recommend technician verification and current manufacturer service information. Shop data: ${JSON.stringify(context)}`;
  const response = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: system }],
    messages: [...historyMessages(recentHistory || []), { role: 'user', content: [{ text: message }] }],
    inferenceConfig: { maxTokens: 700, temperature: 0.3 },
  }));
  const text = response.output?.message?.content?.find(block => block.text)?.text || 'I could not produce an answer right now.';
  return { text, model: MODEL_ID };
}

