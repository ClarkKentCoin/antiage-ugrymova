import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import { sendAdminNotification } from "../_shared/adminNotifications.ts";
import { logUserNotification } from "../_shared/userNotificationLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default tenant ID for backward compatibility (production main tenant)
const DEFAULT_TENANT_ID = Deno.env.get("PUBLIC_TENANT_ID") ?? "6749bded-94d6-4793-9f46-09724da30ab6";

const enc = new TextEncoder();
const dec = new TextDecoder();

interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
}

// HMAC-SHA256 returning hex string
async function hmacSha256(key: Uint8Array, message: string): Promise<string> {
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

// HMAC-SHA256 returning raw bytes
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

// Build data check string for Telegram validation
function buildDataCheckString(params: URLSearchParams): { dataCheckString: string; receivedHash: string | null } {
  const entries: [string, string][] = [];
  let receivedHash: string | null = null;

  for (const [k, v] of params.entries()) {
    if (k === "hash") {
      receivedHash = v;
      continue;
    }
    entries.push([k, v]);
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  return { dataCheckString, receivedHash };
}

// Validate Telegram WebApp init_data
async function isValidInitData(initData: string, botToken: string): Promise<{ ok: boolean; telegramUserId?: number; reason?: string }> {
  try {
    const params = new URLSearchParams(initData);
    const { dataCheckString, receivedHash } = buildDataCheckString(params);

    if (!receivedHash) return { ok: false, reason: "missing_hash" };

    // secretKey = HMAC_SHA256(key="WebAppData", message=botToken)
    const secret = await hmacSha256Raw(enc.encode("WebAppData"), botToken);

    // computedHash = HMAC_SHA256(key=secretKey, message=data_check_string)
    const computedHex = await hmacSha256(secret, dataCheckString);

    if (computedHex !== receivedHash) {
      console.log("[cancel-subscription] Hash mismatch:", { computed: computedHex, received: receivedHash });
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

    const id = Number(user?.id);
    if (!Number.isFinite(id)) return { ok: false, reason: "bad_user_id" };

    return { ok: true, telegramUserId: id };
  } catch (e) {
    console.error("[cancel-subscription] isValidInitData error:", e);
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}

// Resolve tenant ID from slug or use default
async function resolveTenantId(supabaseAdmin: any, tenantSlug: string | null): Promise<string> {
  if (!tenantSlug) {
    return DEFAULT_TENANT_ID;
  }

  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (error || !tenant) {
    console.log(`[cancel-subscription] Tenant not found for slug: ${tenantSlug}, using default`);
    return DEFAULT_TENANT_ID;
  }

  return tenant.id;
}

// Call Telegram API
async function callTelegramApi(
  botToken: string,
  method: string,
  params: Record<string, any> = {}
): Promise<TelegramResponse> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return response.json();
}

// Revoke old invite links for a subscriber
async function revokeOldInviteLinks(
  supabaseAdmin: any,
  botToken: string,
  channelId: string,
  subscriberId: string
): Promise<number> {
  // Get all non-revoked links for this subscriber
  const { data: oldLinks, error } = await supabaseAdmin
    .from("invite_links")
    .select("id, invite_link")
    .eq("subscriber_id", subscriberId)
    .eq("revoked", false);

  if (error) {
    console.error("[cancel-subscription] Error fetching old invite links:", error.message);
    return 0;
  }

  if (!oldLinks || oldLinks.length === 0) {
    return 0;
  }

  console.log(`[cancel-subscription] Revoking ${oldLinks.length} old invite links for subscriber ${subscriberId}`);

  let revokedCount = 0;
  for (const link of oldLinks) {
    // Revoke the link in Telegram
    const revokeResult = await callTelegramApi(botToken, "revokeChatInviteLink", {
      chat_id: channelId,
      invite_link: link.invite_link,
    });

    if (!revokeResult.ok) {
      console.log(`[cancel-subscription] Could not revoke link (may be expired): ${revokeResult.description}`);
    } else {
      revokedCount++;
    }

    // Mark as revoked in database
    await supabaseAdmin
      .from("invite_links")
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq("id", link.id);
  }

  return revokedCount;
}

const DEFAULT_SUBSCRIPTION_CANCELLED = `❌ Подписка отменена

Ваша подписка на канал "{channel_name}" была отменена по вашему запросу.

Вы были удалены из канала. Если хотите вернуться — оформите новую подписку.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[cancel-subscription] Request received");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { telegram_user_id, init_data, tenant_slug } = await req.json();

    console.log("[cancel-subscription] Request data:", { telegram_user_id, hasInitData: !!init_data, tenant_slug });

    // Validate required fields
    if (!telegram_user_id || !init_data) {
      return new Response(
        JSON.stringify({ error: "telegram_user_id and init_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve tenant ID from slug (or use default)
    const tenantId = await resolveTenantId(supabaseAdmin, tenant_slug);
    console.log(`[cancel-subscription] Resolved tenant_id: ${tenantId} from slug: ${tenant_slug || 'null'}`);

    // Get bot token from admin settings for this tenant
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, telegram_channel_id, channel_name")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("[cancel-subscription] Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "telegram_bot_not_configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate Telegram init_data
    const validation = await isValidInitData(init_data, settings.telegram_bot_token);
    console.log("[cancel-subscription] Validation result:", validation);

    if (!validation.ok) {
      return new Response(
        JSON.stringify({ error: "invalid_init_data", reason: validation.reason }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify user ID matches
    if (validation.telegramUserId !== Number(telegram_user_id)) {
      console.log("[cancel-subscription] User ID mismatch:", { validated: validation.telegramUserId, requested: telegram_user_id });
      return new Response(
        JSON.stringify({ error: "user_id_mismatch" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[cancel-subscription] init_data validated successfully");

    // Find subscriber by telegram_user_id for this tenant
    const { data: subscriber, error: subscriberError } = await supabaseAdmin
      .from("subscribers")
      .select("id, status, telegram_user_id")
      .eq("telegram_user_id", Number(telegram_user_id))
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (subscriberError) {
      console.error("[cancel-subscription] DB error:", subscriberError);
      return new Response(
        JSON.stringify({ error: "db_error", details: subscriberError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!subscriber) {
      console.log("[cancel-subscription] Subscriber not found:", telegram_user_id, "for tenant:", tenantId);
      return new Response(
        JSON.stringify({ error: "subscriber_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[cancel-subscription] Found subscriber:", subscriber.id, "current status:", subscriber.status);

    // Don't update if already cancelled or expired
    if (subscriber.status === "cancelled" || subscriber.status === "expired") {
      console.log("[cancel-subscription] Subscription already cancelled/expired, no update needed");
      return new Response(
        JSON.stringify({ success: true, message: "already_cancelled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update subscriber status
    const { error: updateError } = await supabaseAdmin
      .from("subscribers")
      .update({
        status: "cancelled",
        auto_renewal: false,
        is_in_channel: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriber.id);

    if (updateError) {
      console.error("[cancel-subscription] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "update_failed", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[cancel-subscription] Subscriber updated: status=cancelled, auto_renewal=false, is_in_channel=false");

    const botToken = settings.telegram_bot_token;
    const channelName = settings.channel_name || "Канал";

    // Format channel ID
    let channelId = settings.telegram_channel_id?.toString() || "";
    if (channelId && !channelId.startsWith("-100") && channelId.startsWith("-")) {
      channelId = "-100" + channelId.substring(1);
    }

    const results: {
      banned?: boolean;
      invites_revoked?: number;
      notification_sent?: boolean;
      error?: string;
    } = {};

    // Perform Telegram actions if channel is configured
    if (channelId && botToken) {
      // Revoke all invite links first
      const revokedCount = await revokeOldInviteLinks(supabaseAdmin, botToken, channelId, subscriber.id);
      results.invites_revoked = revokedCount;
      console.log(`[cancel-subscription] Revoked ${revokedCount} invite links`);

      // Ban user from channel (removes them)
      const banResult = await callTelegramApi(botToken, "banChatMember", {
        chat_id: channelId,
        user_id: telegram_user_id,
        revoke_messages: false,
      });

      if (banResult.ok) {
        results.banned = true;
        console.log(`[cancel-subscription] User ${telegram_user_id} banned from channel`);
      } else {
        console.error(`[cancel-subscription] Failed to ban user:`, banResult.description);
        results.error = banResult.description;
      }

      // Send cancellation notification to user
      const message = DEFAULT_SUBSCRIPTION_CANCELLED.replace("{channel_name}", channelName);

      const msgResult = await callTelegramApi(botToken, "sendMessage", {
        chat_id: telegram_user_id,
        text: message,
        parse_mode: "HTML",
      });

      // Log user notification
      await logUserNotification({
        supabaseAdmin,
        source: "cancel-subscription",
        notificationKey: "subscription_cancelled",
        subscriberId: subscriber.id,
        telegramUserId: telegram_user_id,
        telegramOk: msgResult.ok,
        telegramError: msgResult.ok ? null : msgResult.description,
        textPreview: message,
      });

      // Send admin notification
      await sendAdminNotification({
        supabaseAdmin,
        eventType: "SUBSCRIPTION_CANCELLED",
        subscriber: {
          id: subscriber.id,
          name: null,
          username: null,
          telegram_user_id: telegram_user_id,
          email: null,
        },
        status: "cancelled",
        source: "cancel-subscription",
      });

      results.notification_sent = msgResult.ok;
      if (!msgResult.ok) {
        console.error(`[cancel-subscription] Failed to send notification:`, msgResult.description);
      } else {
        console.log(`[cancel-subscription] Cancellation notification sent to user ${telegram_user_id}`);
      }
    }

    console.log("[cancel-subscription] Completed:", results, { tenant_id_used: tenantId });

    // Log successful cancellation to system_logs
    try {
      await supabaseAdmin.from("system_logs").insert({
        level: "info",
        event_type: "subscription.cancelled",
        source: "edge_fn",
        subscriber_id: subscriber.id,
        telegram_user_id: Number(telegram_user_id),
        tenant_id: tenantId,
        message: "Subscription cancelled by user via MiniApp",
        payload: {
          channel_id: channelId,
          banned: results.banned || false,
          invites_revoked: results.invites_revoked || 0,
          notification_sent: results.notification_sent || false,
        },
      });

      if (results.banned) {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          event_type: "telegram.user_banned",
          source: "edge_fn",
          subscriber_id: subscriber.id,
          telegram_user_id: Number(telegram_user_id),
          tenant_id: tenantId,
          message: "User banned from channel after cancellation",
          payload: { channel_id: channelId },
        });
      }

      if (results.invites_revoked && results.invites_revoked > 0) {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          event_type: "telegram.invites_revoked",
          source: "edge_fn",
          subscriber_id: subscriber.id,
          telegram_user_id: Number(telegram_user_id),
          tenant_id: tenantId,
          message: `Revoked ${results.invites_revoked} invite links`,
          payload: { channel_id: channelId, count: results.invites_revoked },
        });
      }
    } catch (logErr) {
      console.warn("[cancel-subscription] Failed to log to system_logs:", logErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        _debug: {
          tenant_id_used: tenantId,
          tenant_slug_used: tenant_slug || null,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[cancel-subscription] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
