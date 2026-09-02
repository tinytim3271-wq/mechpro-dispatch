import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type Message, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ddb, TABLE_NAME } from '../common/ddb';
import { appUrl } from '../common/runtime-env';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 5, retryMode: 'adaptive' });
const secrets = new SecretsManagerClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';
const APP_URL = appUrl();

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

export function verifyAgentPhoneSignature(payload: string, signature: string, timestamp: string, secret: string, nowSeconds = Date.now() / 1000) {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature || '');
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function webhookSecret(shopId: string) {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: `mechpro/${shopId}/agentphone-webhook-secret` }));
  return result.SecretString || '';
}

async function activeShop(shopId: string) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: 'PLATFORM', sk: `ACCOUNT#${shopId}` }, ProjectionExpression: 'suspended' }));
  return result.Item?.suspended !== true;
}

async function shopContext(shopId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `SHOP#${shopId}` },
    ProjectionExpression: 'sk, id, #name, #status, customer, vehicle, amount, due, tech, promise, complaint, date, #time, service, phone, email, price, partsPrice, laborHours, description',
    ExpressionAttributeNames: { '#name': 'name', '#status': 'status', '#time': 'time' },
  }));
  return (result.Items || []).filter(item => !String(item.sk || '').startsWith('EMPLOYEE#')).slice(0, 120).map(item => ({
    type: String(item.sk || '').split('#')[0], id: item.id, name: item.name, status: item.status, customer: item.customer,
    vehicle: item.vehicle, amount: item.amount, due: item.due, technician: item.tech, promise: item.promise, concern: item.complaint, date: item.date, time: item.time, service: item.service, phone: item.phone, email: item.email, price: item.price, partsPrice: item.partsPrice, laborHours: item.laborHours, description: item.description,
  }));
}

async function getShopItems(shopId: string, prefix: string) {
  const result = await ddb.send(new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `SHOP#${shopId}`, ':prefix': prefix } }));
  return result.Items || [];
}

async function createPaymentLink(shopId: string, invoiceNumber: string) {
  const pk = `SHOP#${shopId}`;
  const invoiceResult = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk: `INVOICE#${invoiceNumber}` } }));
  const invoice = invoiceResult.Item;
  if (!invoice) return { error: 'Invoice not found.' };
  const payments = await getShopItems(shopId, 'PAYMENT#');
  const paid = payments.filter(item => item.invoiceNumber === invoiceNumber && item.status === 'completed').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const balance = Math.max(0, Math.round((Number(invoice.amount || 0) - paid) * 100) / 100);
  if (balance <= 0) return { error: 'That invoice has no open balance.' };
  const secret = (await secrets.send(new GetSecretValueCommand({ SecretId: `mechpro/${shopId}/stripe-secret-key` }))).SecretString;
  if (!secret) return { error: 'This shop has not connected online payments yet.' };
  const params = new URLSearchParams({ mode: 'payment', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(Math.round(balance * 100)), 'line_items[0][price_data][product_data][name]': `MechPro invoice ${invoiceNumber}`, 'line_items[0][quantity]': '1', success_url: `${APP_URL}/#/invoices?payment=success`, cancel_url: `${APP_URL}/#/invoices?payment=cancelled`, 'metadata[shopId]': shopId, 'metadata[invoiceNumber]': invoiceNumber });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(secret + ':').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!response.ok) return { error: 'The payment provider could not create a link.' };
  const session = await response.json() as { url?: string };
  return { url: session.url, balance };
}

async function runTool(shopId: string, name: string, input: Record<string, unknown>) {
  if (name === 'get_service_pricing') {
    const services = await getShopItems(shopId, 'SERVICE#');
    return { services: services.map(item => ({ name: item.name, description: item.description, laborHours: item.laborHours, price: item.price, partsPrice: item.partsPrice })) };
  }
  if (name === 'find_appointment_slots') {
    const date = String(input.date || '');
    const appointments = (await getShopItems(shopId, 'APPOINTMENT#')).filter(item => item.date === date && item.status !== 'cancelled');
    const taken = new Set(appointments.map(item => String(item.time || '')));
    const available = Array.from({ length: 19 }, (_, index) => `${String(8 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`).filter(time => !taken.has(time));
    return { date, available, existing: appointments.map(item => ({ time: item.time, service: item.service, status: item.status })) };
  }
  if (name === 'book_appointment') {
    if (input.confirmed !== true) return { confirmationRequired: true, message: 'Ask the caller to confirm the exact date, time, service, and customer name before booking.' };
    const date = String(input.date || ''), time = String(input.time || ''), customer = String(input.customerName || '').trim(), service = String(input.service || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !customer || !service) return { error: 'Date, time, customer name, and service are required.' };
    const appointments = await getShopItems(shopId, 'APPOINTMENT#');
    if (appointments.some(item => item.date === date && item.time === time && item.status !== 'cancelled')) return { error: 'That appointment time is no longer available.' };
    const id = `appointment-${Date.now()}`;
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `SHOP#${shopId}`, sk: `APPOINTMENT#${id}`, id, shopId, customer, phone: String(input.phone || ''), vehicle: String(input.vehicle || ''), date, time, service, tech: 'Unassigned', bay: 'Unassigned', status: 'confirmed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
    return { booked: true, date, time, customer, service };
  }
  if (name === 'create_payment_link') {
    if (input.confirmed !== true) return { confirmationRequired: true, message: 'Ask the caller to confirm sending the payment link to the caller.' };
    const result = await createPaymentLink(shopId, String(input.invoiceNumber || ''));
    return result.url ? { paymentLink: result.url, balance: result.balance, send_message: { body: `MechPro payment link for invoice ${input.invoiceNumber}: ${result.url}` } } : result;
  }
  return { error: 'Unknown assistant tool.' };
}

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ toolSpec: { name, description, inputSchema: { json: { type: 'object', properties, required } } } });
const assistantTools: Tool[] = [
  tool('get_service_pricing', 'Look up configured service pricing and descriptions.', {}),
  tool('find_appointment_slots', 'Find open appointment times for a specific YYYY-MM-DD date.', { date: { type: 'string' }, service: { type: 'string' } }, ['date']),
  tool('book_appointment', 'Book an appointment only after the caller confirms the exact details.', { confirmed: { type: 'boolean' }, customerName: { type: 'string' }, phone: { type: 'string' }, vehicle: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, service: { type: 'string' } }, ['confirmed', 'customerName', 'date', 'time', 'service']),
  tool('create_payment_link', 'Create and text a hosted invoice payment link only after explicit caller confirmation.', { confirmed: { type: 'boolean' }, invoiceNumber: { type: 'string' } }, ['confirmed', 'invoiceNumber']),
] as Tool[];

async function answer(shopId: string, transcript: string, recentHistory: Array<{ content?: string; direction?: string; channel?: string }>) {
  const context = await shopContext(shopId);
  const history = recentHistory.slice(-10).map(item => ({ role: item.direction === 'outbound' ? 'assistant' as const : 'user' as const, content: [{ text: String(item.content || '').slice(0, 2000) }] }));
  const messages: Message[] = [...history, { role: 'user', content: [{ text: transcript.slice(0, 4000) }] }];
  const request: ConverseCommandInput = { modelId: MODEL_ID, system: [{ text: `You are MechPro's live phone receptionist for an automotive repair shop. Answer briefly and naturally for text-to-speech. You can answer configured pricing, look up appointment slots, book appointments after exact caller confirmation, and create/send hosted payment links after explicit confirmation. Use tools for all records and actions; never invent availability, prices, payment status, or bookings. Do not collect card numbers. For safety-critical symptoms, recommend qualified technician review. Current date is ${new Date().toISOString().slice(0, 10)}. Shop data: ${JSON.stringify(context)}` }], messages, inferenceConfig: { maxTokens: 600, temperature: 0.2 }, toolConfig: { tools: assistantTools } };
  let response = await bedrock.send(new ConverseCommand(request));
  let action;
  if (response.stopReason === 'tool_use' && response.output?.message) {
    messages.push(response.output.message);
    const results = [];
    for (const block of response.output.message.content || []) {
      if (!block.toolUse?.name || !block.toolUse.toolUseId) continue;
      const result = await runTool(shopId, block.toolUse.name, (block.toolUse.input || {}) as Record<string, unknown>);
      if ((result as { send_message?: unknown }).send_message) action = (result as { send_message: unknown }).send_message;
      results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, content: [{ text: JSON.stringify(result) }] } });
    }
    messages.push({ role: 'user', content: results });
    response = await bedrock.send(new ConverseCommand({ ...request, messages }));
  }
  const text = response.output?.message?.content?.find(block => block.text)?.text || 'I am sorry, but I could not answer that right now.';
  return action ? { text, send_message: action } : { text };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const shopId = String(event.pathParameters?.shopId || '');
    const payload = event.body || '';
    const signature = event.headers['x-webhook-signature'] || event.headers['X-Webhook-Signature'] || '';
    const timestamp = event.headers['x-webhook-timestamp'] || event.headers['X-Webhook-Timestamp'] || '';
    if (!shopId || !signature || !timestamp) return json(400, { message: 'Missing webhook authentication' });
    const [secret, isActive] = await Promise.all([webhookSecret(shopId), activeShop(shopId)]);
    if (!isActive) return json(403, { message: 'Shop account is suspended' });
    if (!secret || !verifyAgentPhoneSignature(payload, signature, timestamp, secret)) return json(401, { message: 'Invalid webhook signature' });
    const body = JSON.parse(payload) as { event?: string; channel?: string; data?: { transcript?: string; message?: string }; recentHistory?: Array<{ content?: string; direction?: string; channel?: string }> };
    if (body.event === 'agent.call_ended') return json(200, { received: true });
    if (body.event !== 'agent.message' || !body.data || !['voice', 'sms', 'mms', 'imessage'].includes(String(body.channel))) return json(200, { received: true });
    const transcript = String(body.data.transcript || body.data.message || '').trim();
    if (!transcript) return json(200, { text: 'How can I help you today?' });
    return json(200, await answer(shopId, transcript, body.recentHistory || []));
  } catch (error) {
    console.error(error);
    return json(500, { message: 'Webhook processing failed' });
  }
};
