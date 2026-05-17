// Shared Telegram WebApp init_data validator (HMAC-SHA256).
// Mirrors logic used by get-subscriber-status / get-payment-history / cancel-subscription.

import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface InitDataValidation {
  ok: boolean;
  telegramUserId?: number;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
  reason?: string;
}

async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return dec.decode(hexEncode(new Uint8Array(sig)));
}

async function hmacSha256Raw(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

export async function validateTelegramInitData(
  initData: string,
  botToken: string,
): Promise<InitDataValidation> {
  try {
    if (!initData) return { ok: false, reason: "missing_init_data" };
    if (!botToken) return { ok: false, reason: "missing_bot_token" };

    const params = new URLSearchParams(initData);
    const entries: [string, string][] = [];
    let receivedHash: string | null = null;
    for (const [k, v] of params.entries()) {
      if (k === "hash") {
        receivedHash = v;
        continue;
      }
      entries.push([k, v]);
    }
    if (!receivedHash) return { ok: false, reason: "missing_hash" };

    entries.sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secret = await hmacSha256Raw(enc.encode("WebAppData"), botToken);
    const computedHex = await hmacSha256Hex(secret, dataCheckString);

    if (computedHex !== receivedHash) {
      return { ok: false, reason: "hash_mismatch" };
    }

    const userStr = params.get("user");
    if (!userStr) return { ok: false, reason: "missing_user" };

    let user: Record<string, unknown>;
    try {
      user = JSON.parse(userStr);
    } catch {
      return { ok: false, reason: "bad_user_json" };
    }

    const id = Number((user as any)?.id);
    if (!Number.isFinite(id)) return { ok: false, reason: "bad_user_id" };

    const username = typeof (user as any)?.username === "string" && (user as any).username
      ? String((user as any).username) : null;
    const firstName = typeof (user as any)?.first_name === "string" && (user as any).first_name
      ? String((user as any).first_name) : null;
    const lastName = typeof (user as any)?.last_name === "string" && (user as any).last_name
      ? String((user as any).last_name) : null;

    return {
      ok: true,
      telegramUserId: id,
      telegramUsername: username,
      telegramFirstName: firstName,
      telegramLastName: lastName,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}
