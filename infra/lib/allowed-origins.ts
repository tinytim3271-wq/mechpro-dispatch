/**
 * Browser origins allowed to call the HTTP API and S3 files bucket.
 * Note: API Gateway HTTP APIs reject the literal origin "null" (Electron file://).
 * Desktop should call the API from a trusted https origin or via main-process proxy.
 */
export const APP_ALLOWED_ORIGINS: string[] = [
  'https://www.yourcarguy806.com',
  // Cloudflare Pages (production project + preview deployments)
  'https://mechpro-dispatch.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Extra origins from CDK context, e.g. -c extraAllowedOrigins=https://preview.example.com */
export function allowedOriginsWithContext(extra: unknown): string[] {
  const extras = String(extra || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...APP_ALLOWED_ORIGINS, ...extras])];
}
