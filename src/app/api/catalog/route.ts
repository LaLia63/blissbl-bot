import { getSupabase } from "@/lib/supabase";

export async function GET(): Promise<Response> {
  const { data, error } = await getSupabase()
    .from("blissbl_products")
    .select("id,name,description,price_mmk,image_path,is_available,is_new,is_best_seller,categories:blissbl_categories(name,slug)")
    .eq("is_available", true)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: "Catalog unavailable" }, { status: 503 });
  return Response.json({ products: data }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
