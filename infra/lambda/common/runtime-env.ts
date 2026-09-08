const DEFAULT_APP_URL = 'https://www.yourcarguy806.com';

export function envValue(names: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function userPoolId(env: NodeJS.ProcessEnv = process.env): string {
  return envValue(['USER_POOL_ID', 'COGNITO_USER_POOL_ID'], env) || '';
}

export function filesBucketName(env: NodeJS.ProcessEnv = process.env): string {
  return envValue(['FILES_BUCKET_NAME', 'S3_BUCKET'], env) || '';
}

export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  return envValue(['APP_URL', 'FRONTEND_URL'], env) || DEFAULT_APP_URL;
}
