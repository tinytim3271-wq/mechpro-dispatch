import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  AdminResetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb, TABLE_NAME } from '../common/ddb';
import { AuthError, requestContext, requireRole } from '../common/auth';
import { userPoolId } from '../common/runtime-env';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = userPoolId();
const PLATFORM_PK = 'PLATFORM';

interface CustomerAccount {
  id: string;
  shopId: string;
  shopName: string;
  ownerEmail: string;
  ownerName: string;
  creditBalance: number;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string;
  suspended?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AccountUser {
  username?: string;
  email: string;
  name: string;
  shopId: string;
  role: string;
  enabled?: boolean;
  status?: string;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function attributeMap(attributes: { Name?: string; Value?: string }[] = []) {
  return Object.fromEntries(attributes.flatMap(attribute => attribute.Name ? [[attribute.Name, attribute.Value || '']] : []));
}

async function listAccountUsers() {
  const users: AccountUser[] = [];
  let paginationToken: string | undefined;
  do {
    const result = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, PaginationToken: paginationToken }));
    users.push(...(result.Users ?? []).map(user => {
      const attributes = attributeMap(user.Attributes);
      return {
        username: user.Username,
        email: attributes.email,
        name: attributes.name,
        shopId: attributes['custom:shopId'],
        role: attributes['custom:role'],
        enabled: user.Enabled,
        status: user.UserStatus,
      };
    }));
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return users;
}

export function validShopId(value: unknown) {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(String(value || ''));
}

export function creditAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

export function validPassword(value: unknown) {
  const password = String(value || '');
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export function ownerEmployeeProfile(shopId: string, ownerName: string, email: string, createdAt: string) {
  const id = `owner-${shopId}`;
  return {
    id,
    pk: `SHOP#${shopId}`,
    sk: `EMPLOYEE#${id}`,
    gsi1pk: `SHOP#${shopId}#TYPE#EMPLOYEE`,
    gsi1sk: `${createdAt}#${id}`,
    shopId,
    name: ownerName,
    email,
    role: 'admin',
    title: 'Owner',
    department: 'Administration',
    active: true,
    createdAt,
    updatedAt: createdAt,
  };
}

async function listAccounts() {
  const accountResult = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':prefix': 'ACCOUNT#' },
  }));
  const accounts = (accountResult.Items ?? []) as CustomerAccount[];
  const users = await listAccountUsers();
  return accounts.map(account => ({
    ...account,
    users: users.filter(user => user.shopId === account.shopId),
  }));
}

async function createAccount(event: APIGatewayProxyEventV2WithJWTAuthorizer, actorId: string) {
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  const ownerName = String(body.ownerName || '').trim();
  const shopName = String(body.shopName || '').trim();
  const shopId = String(body.shopId || '').trim().toLowerCase();
  if (!email || !ownerName || !shopName || !validShopId(shopId)) {
    return json(400, { message: 'Owner name, email, shop name, and a valid shop ID are required' });
  }
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PLATFORM_PK, sk: `ACCOUNT#${shopId}` } }));
  if (existing.Item) return json(409, { message: 'An account already uses this shop ID' });

  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: ownerName },
      { Name: 'custom:shopId', Value: shopId },
      { Name: 'custom:role', Value: 'admin' },
    ],
  }));

  const now = new Date().toISOString();
  const account: CustomerAccount & Record<string, unknown> = {
    id: shopId,
    pk: PLATFORM_PK,
    sk: `ACCOUNT#${shopId}`,
    shopId,
    shopName,
    ownerEmail: email,
    ownerName,
    creditBalance: 0,
    subscriptionStatus: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  };
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: account,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: ownerEmployeeProfile(shopId, ownerName, email, now),
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        },
      },
    ],
  }));
  return json(201, account);
}

async function resetPassword(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const username = decodeURIComponent(event.pathParameters?.username || '').trim();
  if (!username) return json(400, { message: 'Username is required' });
  await cognito.send(new AdminResetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  return json(202, { message: 'Password reset instructions sent to the verified email address' });
}

async function setPassword(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const username = decodeURIComponent(event.pathParameters?.username || '').trim();
  const body = JSON.parse(event.body || '{}');
  if (!username || !validPassword(body.password)) {
    return json(400, { message: 'A login and a 12+ character password with uppercase, lowercase, number, and symbol are required' });
  }
  const users = await listAccountUsers();
  if (users.some(user => user.username === username && user.role === 'super_admin')) {
    return json(409, { message: 'Platform owner passwords cannot be changed from customer account controls' });
  }
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
    Password: String(body.password),
    Permanent: true,
  }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  return json(200, { message: 'Permanent password updated; existing sessions were signed out' });
}

async function setAccountStatus(event: APIGatewayProxyEventV2WithJWTAuthorizer, actorId: string) {
  const shopId = decodeURIComponent(event.pathParameters?.shopId || '').trim().toLowerCase();
  const body = JSON.parse(event.body || '{}');
  const suspended = body.suspended;
  if (!validShopId(shopId) || typeof suspended !== 'boolean') {
    return json(400, { message: 'A valid shop ID and suspended status are required' });
  }

  const account = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: PLATFORM_PK, sk: `ACCOUNT#${shopId}` },
  }));
  if (!account.Item) return json(404, { message: 'Customer account not found' });

  const users = await listAccountUsers();
  const accountUsers = users.filter(user => user.shopId === shopId);
  if (suspended && accountUsers.some(user => user.role === 'super_admin')) {
    return json(409, { message: 'An account containing a platform owner cannot be suspended' });
  }
  const usernames = accountUsers.flatMap(user => user.username ? [user.username] : []);
  for (const username of usernames) {
    if (suspended) {
      await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    } else {
      await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    }
  }

  const now = new Date().toISOString();
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { pk: PLATFORM_PK, sk: `ACCOUNT#${shopId}` },
          UpdateExpression: 'SET suspended = :suspended, updatedAt = :now, statusUpdatedBy = :actor',
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
          ExpressionAttributeValues: { ':suspended': suspended, ':now': now, ':actor': actorId },
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            pk: PLATFORM_PK,
            sk: `ACCOUNT_STATUS#${shopId}#${now}#${randomUUID()}`,
            shopId,
            suspended,
            createdAt: now,
            createdBy: actorId,
          },
        },
      },
    ],
  }));
  return json(200, { shopId, suspended, affectedUsers: usernames.length });
}

async function grantCredit(event: APIGatewayProxyEventV2WithJWTAuthorizer, actorId: string) {
  const shopId = decodeURIComponent(event.pathParameters?.shopId || '').trim().toLowerCase();
  const body = JSON.parse(event.body || '{}');
  const amount = creditAmount(body.amount);
  const reason = String(body.reason || '').trim();
  if (!validShopId(shopId) || amount === null || !reason) {
    return json(400, { message: 'A valid shop ID, positive credit amount, and reason are required' });
  }
  const now = new Date().toISOString();
  const creditId = randomUUID();
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: { pk: PLATFORM_PK, sk: `ACCOUNT#${shopId}` },
          UpdateExpression: 'SET creditBalance = if_not_exists(creditBalance, :zero) + :amount, updatedAt = :now',
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
          ExpressionAttributeValues: { ':zero': 0, ':amount': amount, ':now': now },
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            pk: PLATFORM_PK,
            sk: `CREDIT#${shopId}#${now}#${creditId}`,
            id: creditId,
            shopId,
            amount,
            reason,
            createdAt: now,
            createdBy: actorId,
          },
        },
      },
    ],
  }));
  return json(201, { id: creditId, shopId, amount, reason, createdAt: now });
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    requireRole(ctx, ['super_admin']);
    const method = event.requestContext.http.method;
    const routeKey = event.routeKey || '';
    if (method === 'GET' && routeKey.includes('/admin/accounts')) return json(200, await listAccounts());
    if (method === 'POST' && routeKey === 'POST /admin/accounts') return createAccount(event, ctx.userId);
    if (method === 'POST' && routeKey.includes('/set-password')) return setPassword(event);
    if (method === 'POST' && routeKey.includes('/reset-password')) return resetPassword(event);
    if (method === 'POST' && routeKey.includes('/status')) return setAccountStatus(event, ctx.userId);
    if (method === 'POST' && routeKey.includes('/credits')) return grantCredit(event, ctx.userId);
    return json(405, { message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    const name = (error as { name?: string }).name;
    if (name === 'UsernameExistsException') return json(409, { message: 'A login already uses this email address' });
    if (name === 'UserNotFoundException') return json(404, { message: 'Login not found' });
    if (name === 'TransactionCanceledException' || name === 'ConditionalCheckFailedException') {
      return json(404, { message: 'Customer account not found' });
    }
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};