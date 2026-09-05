/**
 * Browser origins allowed to call the HTTP API and S3 files bucket.
 * Note: API Gateway HTTP APIs reject the literal origin "null" (Electron file://).
 * Desktop should call the API from a trusted https origin or via main-process proxy.
 */
export const APP_ALLOWED_ORIGINS: string[] = [
  'https://www.yourcarguy806.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
