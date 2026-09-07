/**
 * Cloudflare Pages Function: Admin user management
 * POST /api/admin/users — create or update a user
 * GET  /api/admin/users — list all users
 */

const ADMIN_TOKEN = "mechpro-admin-2026";

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const salt = crypto.randomUUID();
  const hash = await deriveKey(password, salt);
  return `${salt}:${hash}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    },
  });
}

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token" } });
  }
  const token = request.headers.get("X-Auth-Token");
  if (token !== ADMIN_TOKEN) return json({ error: "Unauthorized" }, 401);

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { email, password, name, role, shopId } = body;
    if (!email || !password) return json({ error: "email and password are required" }, 400);

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await env.USERS_KV.get(`user:${normalizedEmail}`, "json");
    const user = {
      id: existing?.id || crypto.randomUUID(),
      email: normalizedEmail,
      name: name || normalizedEmail,
      role: role || "technician",
      shopId: shopId || "default",
      passwordHash: await hashPassword(password),
      forcePasswordChange: body.forcePasswordChange || false,
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await env.USERS_KV.put(`user:${normalizedEmail}`, JSON.stringify(user));
    return json({ ok: true, email: normalizedEmail, role: user.role, id: user.id });
  }

  if (request.method === "GET") {
    const list = await env.USERS_KV.list({ prefix: "user:" });
    const users = [];
    for (const key of list.keys) {
      const user = await env.USERS_KV.get(key.name, "json");
      if (user) users.push({ id: user.id, email: user.email, name: user.name, role: user.role, shopId: user.shopId, active: user.active });
    }
    return json({ users, count: users.length });
  }

  return json({ error: "Method not allowed" }, 405);
}
