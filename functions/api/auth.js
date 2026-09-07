/**
 * Cloudflare Pages Function: Auth API
 * Mimics Cognito API surface so the frontend needs minimal changes.
 * Uses KV for user storage and Web Crypto for JWT/password hashing.
 */

const JWT_SECRET = "mechpro-cf-auth-2026-secret-key";
const TOKEN_EXPIRY = 3600; // 1 hour
const REFRESH_EXPIRY = 2592000; // 30 days

// ── Crypto helpers ──────────────────────────────────────────────

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createJWT(claims, secret, expiresIn) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url({ ...claims, iat: now, exp: now + expiresIn, auth_time: now });
  const signature = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

async function hashPassword(password) {
  const salt = crypto.randomUUID();
  const hash = await deriveKey(password, salt);
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const computed = await deriveKey(password, salt);
  return computed === hash;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Amz-Target",
    },
  });
}

// ── Route handler ───────────────────────────────────────────────

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Amz-Target", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
  const target = request.headers.get("X-Amz-Target") || "";
  const body = await request.json().catch(() => ({}));

  if (target === "AWSCognitoIdentityProviderService.InitiateAuth") {
    return handleInitiateAuth(env, body);
  }
  if (target === "AWSCognitoIdentityProviderService.RespondToAuthChallenge") {
    return handleRespondToAuthChallenge(env, body);
  }
  if (target === "AWSCognitoIdentityProviderService.ForgotPassword") {
    return handleForgotPassword(env, body);
  }
  if (target === "AWSCognitoIdentityProviderService.ConfirmForgotPassword") {
    return handleConfirmForgotPassword(env, body);
  }

  return jsonResponse({ message: `Unsupported target: ${target}` }, 400);
}

// ── InitiateAuth (login) ───────────────────────────────────────

async function handleInitiateAuth(env, body) {
  const { AuthParameters } = body;
  if (!AuthParameters?.USERNAME || !AuthParameters?.PASSWORD) {
    return jsonResponse({ message: "Username and password are required" }, 400);
  }

  const email = AuthParameters.USERNAME.toLowerCase().trim();
  const userData = await env.USERS_KV.get(`user:${email}`, "json");

  if (!userData) {
    return jsonResponse({ message: "Incorrect email or password" }, 401);
  }

  if (userData.forcePasswordChange) {
    // Return NEW_PASSWORD_REQUIRED challenge
    const session = crypto.randomUUID();
    await env.SESSIONS_KV.put(`challenge:${session}`, JSON.stringify({ email, userId: userData.id }), { expirationTtl: 3600 });
    return jsonResponse({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeParameters: { USER_ID_FOR_SRP: email },
    });
  }

  const valid = await verifyPassword(AuthParameters.PASSWORD, userData.passwordHash);
  if (!valid) {
    return jsonResponse({ message: "Incorrect email or password" }, 401);
  }

  return generateTokens(env, userData);
}

// ── RespondToAuthChallenge (new password) ──────────────────────

async function handleRespondToAuthChallenge(env, body) {
  const { ChallengeName, Session, ChallengeResponses } = body;

  if (ChallengeName !== "NEW_PASSWORD_REQUIRED") {
    return jsonResponse({ message: "Unsupported challenge" }, 400);
  }

  const challengeData = await env.SESSIONS_KV.get(`challenge:${Session}`, "json");
  if (!challengeData) {
    return jsonResponse({ message: "Session expired or invalid" }, 400);
  }

  const newPassword = ChallengeResponses?.NEW_PASSWORD;
  if (!newPassword || newPassword.length < 12) {
    return jsonResponse({ message: "Password must be at least 12 characters" }, 400);
  }

  const email = challengeData.email;
  const userData = await env.USERS_KV.get(`user:${email}`, "json");
  if (!userData) {
    return jsonResponse({ message: "User not found" }, 400);
  }

  // Update password and remove force flag
  userData.passwordHash = await hashPassword(newPassword);
  userData.forcePasswordChange = false;
  await env.USERS_KV.put(`user:${email}`, JSON.stringify(userData));

  // Clean up challenge session
  await env.SESSIONS_KV.delete(`challenge:${Session}`);

  return generateTokens(env, userData);
}

// ── ForgotPassword ─────────────────────────────────────────────

async function handleForgotPassword(env, body) {
  const email = (body.Username || "").toLowerCase().trim();
  const userData = await env.USERS_KV.get(`user:${email}`, "json");

  if (!userData) {
    // Don't reveal whether user exists
    return jsonResponse({ CodeDeliveryDetails: { Destination: email.replace(/(.{2}).*(@.*)/, "$1***$2"), DeliveryMedium: "EMAIL", AttributeName: "email" } });
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.SESSIONS_KV.put(`reset:${email}`, code, { expirationTtl: 900 });

  // In production, send via email. For now, log it.
  console.log(`Password reset code for ${email}: ${code}`);

  return jsonResponse({ CodeDeliveryDetails: { Destination: email.replace(/(.{2}).*(@.*)/, "$1***$2"), DeliveryMedium: "EMAIL", AttributeName: "email" } });
}

// ── ConfirmForgotPassword ──────────────────────────────────────

async function handleConfirmForgotPassword(env, body) {
  const email = (body.Username || "").toLowerCase().trim();
  const { ConfirmationCode, Password } = body;

  if (!ConfirmationCode || !Password) {
    return jsonResponse({ message: "Code and new password are required" }, 400);
  }

  const storedCode = await env.SESSIONS_KV.get(`reset:${email}`);
  if (storedCode !== ConfirmationCode) {
    return jsonResponse({ message: "Invalid or expired code" }, 400);
  }

  if (Password.length < 12) {
    return jsonResponse({ message: "Password must be at least 12 characters" }, 400);
  }

  const userData = await env.USERS_KV.get(`user:${email}`, "json");
  if (!userData) {
    return jsonResponse({ message: "User not found" }, 400);
  }

  userData.passwordHash = await hashPassword(Password);
  userData.forcePasswordChange = false;
  await env.USERS_KV.put(`user:${email}`, JSON.stringify(userData));
  await env.SESSIONS_KV.delete(`reset:${email}`);

  return jsonResponse({});
}

// ── Token generation ───────────────────────────────────────────

async function generateTokens(env, userData) {
  const sub = userData.id || crypto.randomUUID();
  const customClaims = {
    sub,
    email: userData.email,
    name: userData.name || userData.email,
    "custom:role": userData.role || "technician",
    "custom:shopId": userData.shopId || "default",
  };

  const idToken = await createJWT(customClaims, JWT_SECRET, TOKEN_EXPIRY);
  const accessToken = await createJWT({ ...customClaims, token_use: "access" }, JWT_SECRET, TOKEN_EXPIRY);
  const refreshToken = await createJWT({ sub, email: userData.email, token_use: "refresh" }, JWT_SECRET, REFRESH_EXPIRY);

  return jsonResponse({
    AuthenticationResult: {
      IdToken: idToken,
      AccessToken: accessToken,
      RefreshToken: refreshToken,
      ExpiresIn: TOKEN_EXPIRY,
      TokenType: "Bearer",
    },
  });
}
