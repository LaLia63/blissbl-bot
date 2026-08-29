# BLISSBL Telegram Shop Bot

BLISSBL is a Telegram-first beauty and wellness storefront. The Next.js landing page presents the catalog and sends customers into a grammY bot for browsing, cart management, delivery details, KPay payment-slip submission, order tracking, and admin review.

## Live app

- Website: https://blissbl-bot.vercel.app
- Telegram bot: https://t.me/blissbl_bot
- Health check: https://blissbl-bot.vercel.app/api/health

## Stack

- Next.js 16, TypeScript, Tailwind CSS, shadcn/ui
- grammY Telegram Bot API
- Supabase Postgres and private Storage
- Vercel Functions and Telegram webhook delivery

## Local setup

1. Copy `.env.example` to `.env.local` and provide the required values.
2. Apply the SQL files in `supabase/migrations` in filename order.
3. Install and run the app:

```bash
npm install
npm run dev
```

Use `npm run lint` and `npm run build` before deploying. Secrets are intentionally excluded from the repository.

## Bot commands

- `/start` — open the shop menu
- `/shop` — browse categories and products
- `/cart` — review or edit the cart
- `/orders` — view order history
- `/help` — show help
- `/admin` — open the allowlisted admin dashboard

## Security

The Supabase service-role key is used only by server routes. All BLISSBL tables have Row Level Security enabled, client roles are revoked, payment slips are stored in a private bucket, and Telegram webhooks are protected with a secret header and update idempotency.
