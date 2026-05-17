// Shared auth helper for scheduled / background task edge functions.
// Requires Authorization: Bearer ${SCHEDULED_TASK_SECRET}.
// Does NOT accept anon keys, does NOT decode JWTs, no public fallback.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function requireScheduledSecret(
  req: Request,
): Promise<Response | null> {
  const expectedSecret = Deno.env.get("SCHEDULED_TASK_SECRET") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const hasAuthHeader = authHeader.length > 0;
  const hasExpectedSecret = expectedSecret.length > 0;

  if (!hasExpectedSecret) {
    console.error("[scheduledAuth] SCHEDULED_TASK_SECRET not configured", {
      hasAuthHeader,
      hasExpectedSecret,
    });
    return new Response(
      JSON.stringify({ error: "scheduled_secret_not_configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  const tokenLength = token.length;

  if (!token || !timingSafeEqual(token, expectedSecret)) {
    console.warn("[scheduledAuth] unauthorized scheduled task call", {
      hasAuthHeader,
      hasExpectedSecret,
      tokenLength,
    });
    return new Response(
      JSON.stringify({ error: "unauthorized_scheduled_task" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  return null;
}
