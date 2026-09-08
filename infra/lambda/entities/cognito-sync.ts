import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { userPoolId } from '../common/runtime-env';

const cognito = new CognitoIdentityProviderClient({});
const ALLOWED_ROLES = new Set(['admin', 'technician', 'office', 'service_writer']);

/** Keep Cognito custom:role aligned with the employee profile so JWT and DynamoDB do not drift. */
export async function syncEmployeeRoleToCognito(email: string, role: string) {
  const poolId = userPoolId();
  if (!poolId || !email || !ALLOWED_ROLES.has(role)) return;
  const listed = await cognito.send(new ListUsersCommand({
    UserPoolId: poolId,
    Filter: `email = "${email.replace(/"/g, '')}"`,
    Limit: 1,
  }));
  const username = listed.Users?.[0]?.Username;
  if (!username) return;
  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: poolId,
    Username: username,
    UserAttributes: [{ Name: 'custom:role', Value: role }],
  }));
}
