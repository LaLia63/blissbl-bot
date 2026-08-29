import { z } from "zod";

const configSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_ADMIN_USER_ID: z.coerce.number().int().positive(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  APP_URL: z.url(),
});

export type AppConfig = z.infer<typeof configSchema>;

let cachedConfig: AppConfig | undefined;

function clean(value: string | undefined): string | undefined {
  return value?.replace(/^\uFEFF/, "").trim();
}

export function getConfig(): AppConfig {
  const productionHost = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const vercelOrigin = productionHost
    ? `https://${productionHost}`
    : undefined;
  cachedConfig ??= configSchema.parse({
    SUPABASE_URL: clean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TELEGRAM_BOT_TOKEN: clean(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_ADMIN_USER_ID: clean(process.env.TELEGRAM_ADMIN_USER_ID),
    TELEGRAM_WEBHOOK_SECRET: clean(process.env.TELEGRAM_WEBHOOK_SECRET),
    APP_URL: clean(process.env.APP_URL) ?? vercelOrigin,
  });
  return cachedConfig;
}
