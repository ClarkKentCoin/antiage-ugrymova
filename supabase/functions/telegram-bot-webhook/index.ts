import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // Only accept POST requests from Telegram
  if (req.method !== "POST") {
    console.log(`Rejected ${req.method} request - only POST allowed`);
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify Telegram webhook secret token - REQUIRED for security
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET not configured - webhook disabled for security");
    return new Response(
      JSON.stringify({ error: "Webhook not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const receivedToken = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!receivedToken || receivedToken !== webhookSecret) {
    console.error("Invalid or missing webhook secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get admin settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("admin_settings")
      .select("telegram_bot_token, welcome_message_text, welcome_message_image_url, welcome_message_button_text, welcome_message_button_url")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings?.telegram_bot_token) {
      console.error("Settings error:", settingsError);
      return new Response(
        JSON.stringify({ error: "Bot not configured" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const botToken = settings.telegram_bot_token;
    const update: TelegramUpdate = await req.json();
    
    console.log("Received update:", JSON.stringify(update));

    // Handle /start command
    if (update.message?.text?.startsWith("/start")) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      
      console.log(`Processing /start command from user ${userId}`);

      // Get button URL from settings or use default Mini App URL
      const defaultMiniAppUrl = Deno.env.get("SUPABASE_URL")?.replace('.supabase.co', '.lovable.app') || 
                        `https://zmewfhnaycjuvpjxkiin.lovable.app/telegram`;
      const buttonUrl = settings.welcome_message_button_url || defaultMiniAppUrl;

      const welcomeText = settings.welcome_message_text || 
        `🌟 Добро пожаловать в АНТИЭЙДЖ ЛАБ!\n\nЗакрытый Telegram-канал для женщин о секретах молодости, здоровья и долголетия.\n\n💎 Нажмите кнопку ниже, чтобы выбрать подписку и получить доступ к эксклюзивному контенту.`;
      
      const buttonText = settings.welcome_message_button_text || "Подробнее";
      const imageUrl = settings.welcome_message_image_url;

      // Determine if URL is a web_app or regular URL
      const isWebApp = buttonUrl.includes('/telegram') || buttonUrl.includes('t.me/') && buttonUrl.includes('/app');
      
      const inlineKeyboard = {
        inline_keyboard: [[
          isWebApp 
            ? { text: buttonText, web_app: { url: buttonUrl } }
            : { text: buttonText, url: buttonUrl }
        ]]
      };

      let result: TelegramResponse;

      if (imageUrl) {
        // Send photo with caption
        result = await callTelegramApi(botToken, "sendPhoto", {
          chat_id: chatId,
          photo: imageUrl,
          caption: welcomeText,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        });

        // If photo fails, fall back to text message
        if (!result.ok) {
          console.log("Photo send failed, falling back to text:", result.description);
          result = await callTelegramApi(botToken, "sendMessage", {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: inlineKeyboard,
          });
        }
      } else {
        // Send text message only
        result = await callTelegramApi(botToken, "sendMessage", {
          chat_id: chatId,
          text: welcomeText,
          parse_mode: "HTML",
          reply_markup: inlineKeyboard,
        });
      }

      console.log("Send result:", JSON.stringify(result));

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Return ok for other updates
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
