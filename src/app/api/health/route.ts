import { getBot } from "@/bot/bot";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [me, products] = await Promise.all([
      getBot().api.getMe(),
      getSupabase().from("blissbl_products").select("id", { head: true, count: "exact" }).eq("is_available", true),
    ]);
    if (products.error) throw products.error;
    return Response.json({ status: "ok", bot: `@${me.username}`, database: "ok", products: products.count ?? 0 });
  } catch (error) {
    return Response.json({ status: "error", message: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  }
}
