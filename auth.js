/**
 * auth.js — Sifely OAuth token management
 */

const BASE_URL = process.env.SIFELY_BASE_URL || "https://app-smart-server.sifely.com";

let cachedToken = null;
let tokenExpiresAt = null;

export async function getToken() {
  const fiveMinutes = 5 * 60 * 1000;
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - fiveMinutes) {
    return cachedToken;
  }
  return await refreshToken();
}

async function refreshToken() {
  const required = ["SIFELY_CLIENT_ID", "SIFELY_USERNAME", "SIFELY_PASSWORD"];
  for (const v of required) {
    if (!process.env[v]) throw new Error(`Missing required environment variable: ${v}`);
  }

  const params = new URLSearchParams({
    client_id: process.env.SIFELY_CLIENT_ID,
    username:  process.env.SIFELY_USERNAME,
    password:  process.env.SIFELY_PASSWORD,
  });

  const res = await fetch(`${BASE_URL}/system/smart/login?${params}`, {
    method: "POST",
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Sifely login HTTP error: ${res.status} — ${raw}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Sifely login: unexpected non-JSON response: ${raw}`);
  }

  // Sifely returns code 200 for success (not 0), token field is "token" (not "access_token")
  if (data.code !== 200 || !data.data?.token) {
    throw new Error(`Sifely login failed: ${raw}`);
  }

  cachedToken = data.data.token;
  const expiresIn = parseInt(data.data.expires_in) ?? 31536000;
  tokenExpiresAt = Date.now() + expiresIn * 1000;

  console.log(`[auth] Token refreshed. Expires in ${Math.round(expiresIn / 3600)} hours.`);
  return cachedToken;
}
