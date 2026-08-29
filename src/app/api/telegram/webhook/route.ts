import { getBot } from "@/bot/bot";
import { getConfig } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("x-telegram-bot-api-secret-token") !== getConfig().TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as { update_id?: number };
  if (!Number.isInteger(update.update_id)) {
    return Response.json({ error: "Invalid Telegram update" }, { status: 400 });
  }

  const db = getSupabase();
  const existing = await db.from("blissbl_telegram_updates").select("status").eq("update_id", update.update_id).maybeSingle();
  if (existing.data?.status === "PROCESSED") return Response.json({ ok: true, duplicate: true });

  await db.from("blissbl_telegram_updates").upsert({ update_id: update.update_id, status: "RECEIVED", received_at: new Date().toISOString() }, { onConflict: "update_id" });
  try {
    const bot = getBot();
    await bot.init();
    await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    await db.from("blissbl_telegram_updates").update({ status: "PROCESSED", processed_at: new Date().toISOString(), error_code: null }).eq("update_id", update.update_id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    // Telegram retries callback updates when the callback query has already expired.
    // Treat those updates as handled so an old button cannot keep the webhook in a retry loop.
    if (/query is too old|query id is invalid|response timeout expired/i.test(message)) {
      await db.from("blissbl_telegram_updates").update({ status: "PROCESSED", processed_at: new Date().toISOString(), error_code: "STALE_CALLBACK" }).eq("update_id", update.update_id);
      return Response.json({ ok: true, stale_callback: true });
    }
    await db.from("blissbl_telegram_updates").update({ status: "FAILED", error_code: error instanceof Error ? error.name : "UNKNOWN" }).eq("update_id", update.update_id);
    console.error("Webhook processing failed", {
      updateId: update.update_id,
      message,
      error: error instanceof Error ? { name: error.name, stack: error.stack } : error,
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
