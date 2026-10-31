
import {
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const COOKIE_NAME = "eloina_admin";
export const SESSION_HOURS = 12;

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function sha256(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length &&
    timingSafeEqual(left, right);
}

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function json(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(data);
}

export function onlyMethod(req, res, method) {
  if (req.method !== method) {
    res.setHeader("Allow", method);
    json(res, 405, { error: "Method not allowed" });
    return false;
  }

  return true;
}

export function requireConfiguration() {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase environment variables");
  }
}

export async function dbRequest(
  path,
  {
    method = "GET",
    body,
    prefer
  } = {}
) {
  requireConfiguration();

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/${path}`,
    {
      method,
      headers,
      body: body === undefined
        ? undefined
        : JSON.stringify(body),
      cache: "no-store"
    }
  );

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid database response");
    }
  }

  if (!response.ok) {
    throw new Error(
      `Database request failed (${response.status})`
    );
  }

  return data;
}

export async function getGame() {
  const rows = await dbRequest(
    "bingo_game?select=*&id=eq.1"
  );

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Game row not found");
  }

  return rows[0];
}

export function getCookie(req, name) {
  const header = req.headers.cookie || "";

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");

    if (separator === -1) continue;

    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

export async function isAdmin(req) {
  const token = getCookie(req, COOKIE_NAME);

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  const rows = await dbRequest(
    "bingo_admin?select=activated,session_hash,session_expires_at&id=eq.1"
  );

  const admin = rows?.[0];

  if (
    !admin?.activated ||
    !admin.session_hash ||
    !admin.session_expires_at
  ) {
    return false;
  }

  if (
    Date.parse(admin.session_expires_at) <= Date.now()
  ) {
    return false;
  }

  return safeEqual(
    sha256(token),
    admin.session_hash
  );
}

export function setSessionCookie(res, token) {
  const maxAge = SESSION_HOURS * 60 * 60;

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );
}

export function getPublicGame(game) {
  return {
    called_numbers: game.called_numbers,
    version: game.version,
    celebration_seq: game.celebration_seq,
    celebration_at: game.celebration_at,
    updated_at: game.updated_at
  };
}

export function handleError(res, error) {
  console.error(error);
  return json(res, 500, {
    error: "Server error. Check deployment configuration."
  });
}
