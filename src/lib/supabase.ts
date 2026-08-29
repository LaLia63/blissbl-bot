import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getConfig } from "@/lib/config";

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const config = getConfig();
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "blissbl-telegram-bot/1.0" } },
    });
  }
  return client;
}
