import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveTenantIdFromSlug, DEFAULT_TENANT_ID } from "../_shared/tenant.ts";
import { getCanonicalAppBaseUrl } from "../_shared/appConfig.ts";
import { persistIncomingChatMessage } from "../_shared/chatIngestion.ts";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
}

async function callTelegramApi(botToken: string, method: string, params: Record<string, any> = {}): Promise<TelegramResponse> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  
  return response.json();
}

serve(async (req) => {
  const reqUrl = new URL(req.url);
  const method = req.method;
  console.log("[telegram-bot-webhook] hit", { method, pathname: reqUrl.pathname });

  if (method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (method !== "POST") {
    console.log(`[telegram-bot-webhook] Rejected ${method} request - only POST allowed`);
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify Telegram webhook secret token if configured
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (webhookSecret) {
    const receivedToken = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    console.log(`[telegram-bot-webhook] Secret required, header present: ${Boolean(receivedToken)}`);
    if (!receivedToken || receivedToken !== webhookSecret) {
      console.error("[telegram-bot-webhook] Invalid or missing webhook secret token");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("[telegram-bot-webhook] Secret token verified");
  } else {
    console.warn("[telegram-bot-webhook] WARNING: No TELEGRAM_WEBHOOK_SECRET configured");
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // --- Resolve tenant from ?t=<slug> query param ---
    const tenantSlugParam = reqUrl.searchParams.get("t");
    let tenantId: string;
    let tenantSlug: string | null = null;

    if (tenantSlugParam) {
      const resolved = await resolveTenantIdFromSlug(supabaseAdmin, tenantSlugParam);
      if (resolved.source === "default") {
        // Explicit slug provided but not found — fail safely
        console.error(`[telegram-bot-webhook] Invalid tenant slug: "${tenantSlugParam}"`);
        return new Response(
          JSON.stringify({ ok: false, error: "invalid_tenant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      tenantId = resolved.tenantId;
      tenantSlug = resolved.tenantSlug;
      console.log(`[telegram-bot-webhook] Resolved tenant from slug: id=${tenantId}, slug=${tenantSlug}`);
    } else {
      // No slug — backward-compatible fallback to main production tenant
      tenantId = DEFAULT_TENANT_ID;
      console.log(`[telegram-bot-webhook] No tenant slug, using default: ${tenantId}`);
    }

    // --- Load admin_settings for resolved tenant only ---
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, welcome_message_text, welcome_message_image_url, welcome_message_button_text, welcome_message_button_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("[telegram-bot-webhook] Settings error or no bot token for tenant:", tenantId, settingsError);
      return new Response(
        JSON.stringify({ ok: false, error: "Bot not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token;
    const update: TelegramUpdate = await req.json();
    
    const messageText = (update.message?.text ?? '').trim();
    console.log(`[telegram-bot-webhook] tenant=${tenantId} update_id=${update.update_id} text="${messageText.substring(0, 80)}"`);

    // Handle /start command
    if (messageText.startsWith("/start")) {
      const chatId = update.message!.chat.id;
      const userId = update.message!.from.id;
      
      console.log(`[telegram-bot-webhook] /start chat_id=${chatId} user_id=${userId} tenant=${tenantId}`);

      // Build default Mini App URL with tenant context
      const baseMiniAppUrl = getCanonicalAppBaseUrl();
      const defaultMiniAppUrl = tenantSlug
        ? `${baseMiniAppUrl}/telegram-app?t=${encodeURIComponent(tenantSlug)}`
        : `${baseMiniAppUrl}/telegram-app`;

      const buttonUrl = settings.welcome_message_button_url || defaultMiniAppUrl;

      const welcomeText = settings.welcome_message_text || 
        `🌟 Добро пожаловать в АНТИЭЙДЖ ЛАБ!\n\nЗакрытый Telegram-канал для женщин о секретах молодости, здоровья и долголетия.\n\n💎 Нажмите кнопку ниже, чтобы выбрать подписку и получить доступ к эксклюзивному контенту.`;
      
      const buttonText = settings.welcome_message_button_text || "Подробнее";
      const imageUrl = settings.welcome_message_image_url;

      const canonicalBase = (Deno.env.get("PUBLIC_APP_BASE_URL") || "").replace(/\/+$/, "");
      let isCanonicalMiniAppUrl = false;
      if (canonicalBase) {
        try {
          const btnParsed = new URL(buttonUrl);
          const baseParsed = new URL(canonicalBase);
          isCanonicalMiniAppUrl =
            btnParsed.origin === baseParsed.origin &&
            btnParsed.pathname.replace(/\/+$/, "").startsWith("/telegram-app");
        } catch {
          // buttonUrl is not a valid URL — treat as external
          isCanonicalMiniAppUrl = false;
        }
      }
      console.log("[telegram-bot-webhook] welcome_button_mode", { tenant_slug: tenantSlug, buttonUrl, canonicalBase, mode: isCanonicalMiniAppUrl ? "web_app" : "url" });

      const inlineKeyboard = {
        inline_keyboard: [[
          isCanonicalMiniAppUrl
            ? { text: buttonText, web_app: { url: buttonUrl } }
            : { text: buttonText, url: buttonUrl }
        ]]
      };

      let result: TelegramResponse;

      if (imageUrl) {
        result = await callTelegramApi(botToken, "sendPhoto", {
          chat_id: chatId,
          photo: imageUrl,
          caption: welcomeText,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        });

        if (!result.ok) {
          console.log("[telegram-bot-webhook] Photo send failed, falling back to text:", result.description);
          result = await callTelegramApi(botToken, "sendMessage", {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
          });
        }
      } else {
        result = await callTelegramApi(botToken, "sendMessage", {
          chat_id: chatId,
          text: welcomeText,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        });
      }

      console.log(`[telegram-bot-webhook] send result: ok=${result.ok}, description=${result.description || 'none'}`);

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Chat ingestion for non-/start messages ---
    // Only persist private chat text messages; ignore everything else safely
    if (
      update.message &&
      update.message.chat.type === "private" &&
      update.message.text &&
      !messageText.startsWith("/")
    ) {
      await persistIncomingChatMessage(supabaseAdmin, {
        tenantId,
        telegramUserId: update.message.from.id,
        telegramMessageId: update.message.message_id,
        text: update.message.text,
        messageDate: update.message.date,
      });
    } else if (update.message && !messageText.startsWith("/start")) {
      console.log(`[telegram-bot-webhook] Skipping non-text or non-private message, chat_type=${update.message?.chat?.type}`);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[telegram-bot-webhook] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
