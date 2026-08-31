/**
 * Shared MechPro client configuration.
 * Values align with deployed infra outputs (see infra/cdk-outputs.json).
 */
export const cognitoConfig = Object.freeze({
  region: 'us-east-1',
  userPoolId: 'us-east-1_Ng8TxYJkm',
  clientId: '3l8ocn4271f12hn6l0g30r8alc',
  apiUrl: 'https://njz0co209l.execute-api.us-east-1.amazonaws.com',
});

export const storageKeys = Object.freeze({
  dispatch: 'mechpro-dispatch-v1',
  session: 'mechpro-session',
  mutationQueue: 'mechpro-mutation-queue-v1',
});
