import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { CreateSecretCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, requireRole, AuthError } from '../common/auth';

const secrets = new SecretsManagerClient({});
const AGENTPHONE_API = 'https://api.agentphone.ai/v1';
const API_URL = process.env.API_URL || 'https://njz0co209l.execute-api.us-east-1.amazonaws.com';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function validAgentId(value: unknown) {
  return /^agt_[A-Za-z0-9_-]{3,128}$/.test(String(value || '').trim());
}

async function saveSecret(name: string, value: string) {
  try {
    await secrets.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
    await secrets.send(new CreateSecretCommand({ Name: name, SecretString: value, Description: 'MechPro AgentPhone integration secret' }));
  }
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    requireRole(ctx, ['admin']);
    const body = JSON.parse(event.body || '{}') as { apiKey?: string; agentId?: string; contextLimit?: number; timeout?: number };
    const apiKey = String(body.apiKey || '').trim();
    const agentId = String(body.agentId || '').trim();
    if (!/^ap_[A-Za-z0-9_-]{12,}$/.test(apiKey)) return json(400, { message: 'Enter a valid AgentPhone API key' });
    if (!validAgentId(agentId)) return json(400, { message: 'Enter a valid AgentPhone agent ID beginning with agt_' });
    const contextLimit = Math.min(50, Math.max(0, Number(body.contextLimit ?? 10) || 10));
    const timeout = Math.min(120, Math.max(5, Number(body.timeout ?? 30) || 30));
    const webhookUrl = `${API_URL}/agentphone/webhook/${encodeURIComponent(ctx.shopId)}`;
    const response = await fetch(`${AGENTPHONE_API}/agents/${encodeURIComponent(agentId)}/webhook`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, contextLimit, timeout }),
    });
    const result = await response.json().catch(() => ({})) as { secret?: string; status?: string; message?: string };
    if (!response.ok || !result.secret) return json(502, { message: result.message || 'AgentPhone rejected the webhook configuration' });
    await Promise.all([
      saveSecret(`mechpro/${ctx.shopId}/agentphone-api-key`, apiKey),
      saveSecret(`mechpro/${ctx.shopId}/agentphone-webhook-secret`, result.secret),
      ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `SHOP#${ctx.shopId}`,
          sk: 'SHOPSETTING#agentphone',
          id: 'agentphone',
          shopId: ctx.shopId,
          provider: 'agentphone.ai',
          agentId,
          webhookUrl,
          contextLimit,
          timeout,
          status: result.status || 'active',
          configuredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })),
    ]);
    return json(200, { configured: true, status: result.status || 'active', agentId, webhookUrl, contextLimit, timeout });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(502, { message: 'AgentPhone configuration failed' });
  }
};
