import { Bot, InlineKeyboard, type Context } from "grammy";

import { getConfig } from "@/lib/config";
import { escapeHtml, formatMmk, statusLabels } from "@/lib/format";
import { backToMenu, mainMenu } from "@/lib/keyboards";
import { getSupabase } from "@/lib/supabase";

type SessionRow = { state: string; context: Record<string, unknown> };
type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_mmk: number;
  image_path: string | null;
  image_url: string | null;
  stock_quantity: number | null;
  is_available: boolean;
  sku: string | null;
};
type CustomerRow = { id: string; telegram_user_id: number; full_name: string | null; phone: string | null };

let singleton: Bot | undefined;

function imageUrl(product: Pick<ProductRow, "image_path" | "image_url">): string | undefined {
  if (product.image_url) return product.image_url;
  if (product.image_path) return `${getConfig().APP_URL}/assets/${encodeURIComponent(product.image_path)}`;
}

async function ensureCustomer(ctx: Context): Promise<CustomerRow> {
  if (!ctx.from) throw new Error("Telegram user is required");
  const db = getSupabase();
  const payload = {
    telegram_user_id: ctx.from.id,
    telegram_username: ctx.from.username ?? null,
    last_seen_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("blissbl_customers")
    .upsert(payload, { onConflict: "telegram_user_id" })
    .select("id,telegram_user_id,full_name,phone")
    .single();
  if (error) throw error;
  return data as CustomerRow;
}

async function isAdmin(userId: number): Promise<boolean> {
  const { data } = await getSupabase()
    .from("blissbl_admins")
    .select("id")
    .eq("telegram_user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function getSession(userId: number): Promise<SessionRow> {
  const { data } = await getSupabase()
    .from("blissbl_bot_sessions")
    .select("state,context")
    .eq("telegram_user_id", userId)
    .maybeSingle();
  return (data as SessionRow | null) ?? { state: "IDLE", context: {} };
}

async function setSession(userId: number, state: string, context: Record<string, unknown> = {}): Promise<void> {
  const { error } = await getSupabase().from("blissbl_bot_sessions").upsert(
    {
      telegram_user_id: userId,
      state,
      context,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "telegram_user_id" },
  );
  if (error) throw error;
}

async function getOrCreateCart(customerId: string): Promise<string> {
  const db = getSupabase();
  const existing = await db.from("blissbl_carts").select("id").eq("customer_id", customerId).maybeSingle();
  if (existing.data) return (existing.data as { id: string }).id;
  const created = await db.from("blissbl_carts").insert({ customer_id: customerId }).select("id").single();
  if (created.error) throw created.error;
  return (created.data as { id: string }).id;
}

async function showMainMenu(ctx: Context, message = "What would you like to do?"): Promise<void> {
  await ctx.reply(message, { reply_markup: mainMenu() });
}

async function showCategories(ctx: Context): Promise<void> {
  const { data, error } = await getSupabase()
    .from("blissbl_categories")
    .select("id,name,emoji")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  const keyboard = new InlineKeyboard();
  for (const [index, category] of ((data ?? []) as Array<{ id: string; name: string; emoji: string }>).entries()) {
    keyboard.text(`${category.emoji} ${category.name}`, `cat:${category.id}:0`);
    if (index % 2 === 1) keyboard.row();
  }
  keyboard.row().text("🛒 My Cart", "cart").text("← Main menu", "main_menu");
  await ctx.reply("✨ <b>Choose a collection</b>\nPick a category to see what is available today.", {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function showProducts(ctx: Context, categoryId: string, page: number): Promise<void> {
  const pageSize = 4;
  const db = getSupabase();
  const [{ data: category }, { data, count, error }] = await Promise.all([
    db.from("blissbl_categories").select("name,emoji").eq("id", categoryId).single(),
    db
      .from("blissbl_products")
      .select("id,name,price_mmk,image_path,image_url,is_available,stock_quantity", { count: "exact" })
      .eq("category_id", categoryId)
      .eq("is_available", true)
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1),
  ]);
  if (error) throw error;
  const products = (data ?? []) as ProductRow[];
  const categoryInfo = category as { name: string; emoji: string };

  if (products.length === 0) {
    await ctx.reply("This collection is resting for a moment. Please check another category.", { reply_markup: backToMenu() });
    return;
  }

  await ctx.reply(`${categoryInfo.emoji} <b>${escapeHtml(categoryInfo.name)}</b>`, { parse_mode: "HTML" });
  for (const product of products) {
    const keyboard = new InlineKeyboard().text("View details", `product:${product.id}`);
    const caption = `<b>${escapeHtml(product.name)}</b>\n${formatMmk(product.price_mmk)}`;
    const url = imageUrl(product);
    if (url) {
      await ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard });
    } else {
      await ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  const totalPages = Math.max(1, Math.ceil((count ?? products.length) / pageSize));
  const nav = new InlineKeyboard();
  if (page > 0) nav.text("← Previous", `cat:${categoryId}:${page - 1}`);
  nav.text(`${page + 1} / ${totalPages}`, "noop");
  if (page + 1 < totalPages) nav.text("Next →", `cat:${categoryId}:${page + 1}`);
  nav.row().text("Collections", "shop").text("🛒 Cart", "cart");
  await ctx.reply("Browse more", { reply_markup: nav });
}

async function showProduct(ctx: Context, productId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("blissbl_products")
    .select("id,name,description,price_mmk,image_path,image_url,stock_quantity,is_available,sku")
    .eq("id", productId)
    .single();
  if (error) throw error;
  const product = data as ProductRow;
  const available = product.is_available && (product.stock_quantity === null || product.stock_quantity > 0);
  const keyboard = new InlineKeyboard();
  if (available) keyboard.text("＋ Add to cart", `add:${product.id}`).row();
  keyboard.text("🛍 Keep shopping", "shop").text("🛒 My Cart", "cart");
  const stock = available ? "✅ Available" : "⏳ Currently unavailable";
  const caption = [
    `<b>${escapeHtml(product.name)}</b>`,
    `<b>${formatMmk(product.price_mmk)}</b>`,
    "",
    escapeHtml(product.description),
    "",
    stock,
    product.sku ? `<code>${escapeHtml(product.sku)}</code>` : "",
  ].filter(Boolean).join("\n");
  const url = imageUrl(product);
  if (url) await ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard });
  else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard });
}

async function showCart(ctx: Context): Promise<void> {
  const customer = await ensureCustomer(ctx);
  const cartId = await getOrCreateCart(customer.id);
  const { data, error } = await getSupabase()
    .from("blissbl_cart_items")
    .select("quantity,products(id,name,price_mmk,is_available,stock_quantity)")
    .eq("cart_id", cartId)
    .order("created_at");
  if (error) throw error;
  const items = (data ?? []) as unknown as Array<{
    quantity: number;
    products: { id: string; name: string; price_mmk: number; is_available: boolean; stock_quantity: number | null };
  }>;
  if (items.length === 0) {
    await ctx.reply("🛒 <b>Your cart is empty.</b>\nLet’s find something lovely.", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Browse shop", "shop").text("← Menu", "main_menu"),
    });
    return;
  }
  const total = items.reduce((sum, item) => sum + item.products.price_mmk * item.quantity, 0);
  const lines = items.map((item, i) => `${i + 1}. <b>${escapeHtml(item.products.name)}</b> × ${item.quantity}\n   ${formatMmk(item.products.price_mmk * item.quantity)}`);
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    keyboard
      .text("−", `qty:-:${item.products.id}`)
      .text(`${item.quantity}`, "noop")
      .text("＋", `qty:+:${item.products.id}`)
      .text("Remove", `remove:${item.products.id}`)
      .row();
  }
  keyboard.text("🧹 Clear", "clear_cart").text("🛍 Continue shopping", "shop").row().text("Checkout →", "checkout");
  await ctx.reply(`🛒 <b>My Cart</b>\n\n${lines.join("\n\n")}\n\n<b>Subtotal: ${formatMmk(total)}</b>`, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function showOrders(ctx: Context): Promise<void> {
  const customer = await ensureCustomer(ctx);
  const { data, error } = await getSupabase()
    .from("blissbl_orders")
    .select("id,order_number,total_mmk,status,placed_at")
    .eq("customer_id", customer.id)
    .order("placed_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const orders = (data ?? []) as Array<{ id: string; order_number: string; total_mmk: number; status: string; placed_at: string }>;
  if (orders.length === 0) {
    await ctx.reply("You have no orders yet. Your first favourite is waiting in the shop.", { reply_markup: backToMenu() });
    return;
  }
  const text = orders.map((order) => `• <b>${order.order_number}</b> — ${formatMmk(order.total_mmk)}\n  ${statusLabels[order.status] ?? order.status}`).join("\n\n");
  await ctx.reply(`📦 <b>My Orders</b>\n\n${text}`, { parse_mode: "HTML", reply_markup: backToMenu() });
}

async function showAdmin(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    await ctx.reply("This menu is only available to a BLISSBL admin.");
    return;
  }
  const db = getSupabase();
  const [{ count: pendingPayments }, { count: activeOrders }, { count: customers }] = await Promise.all([
    db.from("blissbl_payments").select("id", { head: true, count: "exact" }).eq("status", "PENDING"),
    db.from("blissbl_orders").select("id", { head: true, count: "exact" }).in("status", ["CONFIRMED", "PROCESSING", "SHIPPED"]),
    db.from("blissbl_customers").select("id", { head: true, count: "exact" }),
  ]);
  const keyboard = new InlineKeyboard()
    .text("💳 Pending payments", "admin:payments")
    .row()
    .text("📦 Recent orders", "admin:orders")
    .text("📊 Report", "admin:report")
    .row()
    .text("← Customer menu", "main_menu");
  await ctx.reply(
    `🔐 <b>BLISSBL Admin</b>\n\nPending payments: <b>${pendingPayments ?? 0}</b>\nActive orders: <b>${activeOrders ?? 0}</b>\nCustomers: <b>${customers ?? 0}</b>`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showPendingPayments(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_payments")
    .select("id,amount_mmk,slip_object_path,created_at,orders:blissbl_orders(order_number,customers:blissbl_customers(full_name,telegram_username))")
    .eq("status", "PENDING")
    .order("created_at")
    .limit(10);
  if (error) throw error;
  const payments = (data ?? []) as unknown as Array<{
    id: string;
    amount_mmk: number;
    slip_object_path: string;
    orders: { order_number: string; customers: { full_name: string | null; telegram_username: string | null } };
  }>;
  if (payments.length === 0) {
    await ctx.reply("✅ No pending payments.", { reply_markup: new InlineKeyboard().text("← Admin", "admin:home") });
    return;
  }
  for (const payment of payments) {
    const { data: signed } = await getSupabase().storage.from("blissbl-payment-slips").createSignedUrl(payment.slip_object_path, 120);
    const keyboard = new InlineKeyboard()
      .text("✅ Approve", `pay:approve:${payment.id}`)
      .text("Decline", `pay:decline:${payment.id}`);
    const customerName = payment.orders.customers.full_name || payment.orders.customers.telegram_username || "Customer";
    const caption = `💳 <b>New payment</b>\nOrder: <b>${escapeHtml(payment.orders.order_number)}</b>\nCustomer: ${escapeHtml(customerName)}\nAmount: <b>${formatMmk(payment.amount_mmk)}</b>`;
    if (signed?.signedUrl) await ctx.replyWithPhoto(signed.signedUrl, { caption, parse_mode: "HTML", reply_markup: keyboard });
    else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function processDeliveryText(ctx: Context, session: SessionRow, text: string): Promise<boolean> {
  if (!ctx.from) return false;
  const steps: Record<string, { key: string; next: string; prompt: string }> = {
    CHECKOUT_FULL_NAME: { key: "full_name", next: "CHECKOUT_PHONE", prompt: "📱 Your phone number?" },
    CHECKOUT_PHONE: { key: "phone", next: "CHECKOUT_RECIPIENT", prompt: "📦 Recipient name?" },
    CHECKOUT_RECIPIENT: { key: "recipient_name", next: "CHECKOUT_RECIPIENT_PHONE", prompt: "☎️ Recipient phone number?" },
    CHECKOUT_RECIPIENT_PHONE: { key: "recipient_phone", next: "CHECKOUT_ADDRESS", prompt: "🏠 Full delivery address?" },
    CHECKOUT_ADDRESS: { key: "address_line", next: "CHECKOUT_TOWNSHIP", prompt: "📍 Township?" },
    CHECKOUT_TOWNSHIP: { key: "township", next: "CHECKOUT_CITY", prompt: "🌆 City?" },
    CHECKOUT_CITY: { key: "city", next: "CHECKOUT_NOTE", prompt: "📝 Any delivery note? Send “-” if none." },
  };
  const step = steps[session.state];
  if (!step) return false;
  if (text.trim().length < 2 || text.trim().length > 500) {
    await ctx.reply("Please enter a valid value (2–500 characters).");
    return true;
  }
  const nextContext = { ...session.context, [step.key]: text.trim() };
  await setSession(ctx.from.id, step.next, nextContext);
  await ctx.reply(step.prompt);
  return true;
}

async function finishDelivery(ctx: Context, session: SessionRow, note: string): Promise<void> {
  if (!ctx.from) return;
  const delivery = { ...session.context, delivery_note: note === "-" ? "" : note.trim() } as Record<string, string>;
  await setSession(ctx.from.id, "CONFIRM_ORDER", delivery);
  await ctx.reply(
    `🧾 <b>Confirm delivery</b>\n\nRecipient: ${escapeHtml(delivery.recipient_name)}\nPhone: ${escapeHtml(delivery.recipient_phone)}\nAddress: ${escapeHtml(delivery.address_line)}, ${escapeHtml(delivery.township)}, ${escapeHtml(delivery.city)}\nNote: ${escapeHtml(delivery.delivery_note || "—")}`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✅ Confirm order", "confirm_order").row().text("Cancel", "cart"),
    },
  );
}

async function handlePaymentSlip(ctx: Context, session: SessionRow): Promise<boolean> {
  if (session.state !== "AWAITING_PAYMENT" || !ctx.from) return false;
  const message = ctx.message;
  if (!message) return false;
  const photo = message.photo?.at(-1);
  const document = message.document;
  if (!photo && !document) return false;
  const fileId = photo?.file_id ?? document?.file_id;
  const uniqueId = photo?.file_unique_id ?? document?.file_unique_id;
  const fileSize = photo?.file_size ?? document?.file_size ?? 0;
  const mime = document?.mime_type ?? "image/jpeg";
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!fileId || fileSize > 10 * 1024 * 1024 || !allowed.includes(mime)) {
    await ctx.reply("Please upload a JPG, PNG, WebP or PDF payment slip under 10 MB.");
    return true;
  }
  const customer = await ensureCustomer(ctx);
  const orderId = String(session.context.order_id ?? "");
  if (!orderId) {
    await setSession(ctx.from.id, "IDLE");
    await ctx.reply("Your payment session expired. Open My Orders and try again.", { reply_markup: mainMenu() });
    return true;
  }
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram file path missing");
  const response = await fetch(`https://api.telegram.org/file/bot${getConfig().TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) throw new Error("Could not download Telegram file");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1].replace("jpeg", "jpg");
  const path = `${customer.id}/${orderId}/${crypto.randomUUID()}.${ext}`;
  const db = getSupabase();
  const uploaded = await db.storage.from("blissbl-payment-slips").upload(path, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) throw uploaded.error;
  const [{ data: order, error: orderError }, { count }] = await Promise.all([
    db.from("blissbl_orders").select("order_number,total_mmk,status").eq("id", orderId).eq("customer_id", customer.id).single(),
    db.from("blissbl_payments").select("id", { head: true, count: "exact" }).eq("order_id", orderId),
  ]);
  if (orderError) throw orderError;
  const payment = await db
    .from("blissbl_payments")
    .insert({
      order_id: orderId,
      attempt_no: (count ?? 0) + 1,
      telegram_file_unique_id: uniqueId,
      slip_object_path: path,
      amount_mmk: (order as { total_mmk: number }).total_mmk,
    })
    .select("id")
    .single();
  if (payment.error) throw payment.error;
  await Promise.all([
    db.from("blissbl_orders").update({ status: "PAYMENT_REVIEW" }).eq("id", orderId),
    db.from("blissbl_order_status_events").insert({ order_id: orderId, from_status: (order as { status: string }).status, to_status: "PAYMENT_REVIEW", actor_kind: "CUSTOMER", actor_telegram_user_id: ctx.from.id, note: "Payment slip uploaded" }),
  ]);
  await setSession(ctx.from.id, "IDLE");
  await ctx.reply(`💗 <b>Payment slip received!</b>\nOrder: <b>${escapeHtml((order as { order_number: string }).order_number)}</b>\nWe’ll notify you after the admin review.`, { parse_mode: "HTML", reply_markup: mainMenu() });
  const { data: signed } = await db.storage.from("blissbl-payment-slips").createSignedUrl(path, 300);
  const keyboard = new InlineKeyboard().text("✅ Approve", `pay:approve:${(payment.data as { id: string }).id}`).text("Decline", `pay:decline:${(payment.data as { id: string }).id}`);
  if (signed?.signedUrl) {
    await ctx.api.sendPhoto(getConfig().TELEGRAM_ADMIN_USER_ID, signed.signedUrl, {
      caption: `💳 New payment\nOrder: ${(order as { order_number: string }).order_number}\nAmount: ${formatMmk((order as { total_mmk: number }).total_mmk)}`,
      reply_markup: keyboard,
    });
  }
  return true;
}

export function getBot(): Bot {
  if (singleton) return singleton;
  const bot = new Bot(getConfig().TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    await ensureCustomer(ctx);
    await setSession(ctx.from.id, "IDLE");
    const welcomeUrl = `${getConfig().APP_URL}/assets/welcome.jpg`;
    await ctx.replyWithPhoto(welcomeUrl, {
      caption: "💗 <b>BLISSBL မှ ကြိုဆိုပါတယ်!</b>\n\nBL merchandise တွေကို Telegram ကနေ လွယ်လွယ်ကူကူ order မှာယူနိုင်ပါတယ်။",
      parse_mode: "HTML",
    });
    await showMainMenu(ctx, "Shop, cart နဲ့ order status ကို အောက်က menu မှ ရွေးချယ်နိုင်ပါတယ်။");
  });

  bot.command("admin", showAdmin);
  bot.callbackQuery("main_menu", async (ctx) => { await ctx.answerCallbackQuery(); await showMainMenu(ctx); });
  bot.callbackQuery("shop", async (ctx) => { await ctx.answerCallbackQuery(); await showCategories(ctx); });
  bot.callbackQuery("noop", async (ctx) => { await ctx.answerCallbackQuery(); });
  bot.callbackQuery(/^cat:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProducts(ctx, ctx.match[1], Number(ctx.match[2]));
  });
  bot.callbackQuery(/^product:([^:]+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showProduct(ctx, ctx.match[1]); });
  bot.callbackQuery(/^add:([^:]+)$/, async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    const productId = ctx.match[1];
    const { data: existing } = await getSupabase().from("blissbl_cart_items").select("quantity").eq("cart_id", cartId).eq("product_id", productId).maybeSingle();
    const quantity = Math.min(99, Number((existing as { quantity?: number } | null)?.quantity ?? 0) + 1);
    const { error } = await getSupabase().from("blissbl_cart_items").upsert({ cart_id: cartId, product_id: productId, quantity }, { onConflict: "cart_id,product_id" });
    if (error) throw error;
    await ctx.answerCallbackQuery({ text: "Added to your cart 💗" });
  });
  bot.callbackQuery("cart", async (ctx) => { await ctx.answerCallbackQuery(); await showCart(ctx); });
  bot.callbackQuery(/^qty:([+-]):([^:]+)$/, async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    const { data } = await getSupabase().from("blissbl_cart_items").select("quantity").eq("cart_id", cartId).eq("product_id", ctx.match[2]).maybeSingle();
    const current = Number((data as { quantity?: number } | null)?.quantity ?? 0);
    const next = ctx.match[1] === "+" ? Math.min(99, current + 1) : current - 1;
    if (next <= 0) await getSupabase().from("blissbl_cart_items").delete().eq("cart_id", cartId).eq("product_id", ctx.match[2]);
    else await getSupabase().from("blissbl_cart_items").update({ quantity: next }).eq("cart_id", cartId).eq("product_id", ctx.match[2]);
    await ctx.answerCallbackQuery({ text: "Cart updated" });
    await showCart(ctx);
  });
  bot.callbackQuery(/^remove:([^:]+)$/, async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    await getSupabase().from("blissbl_cart_items").delete().eq("cart_id", cartId).eq("product_id", ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "Removed" });
    await showCart(ctx);
  });
  bot.callbackQuery("clear_cart", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    await getSupabase().from("blissbl_cart_items").delete().eq("cart_id", cartId);
    await ctx.answerCallbackQuery({ text: "Cart cleared" });
    await showCart(ctx);
  });
  bot.callbackQuery("checkout", async (ctx) => {
    await ensureCustomer(ctx);
    await setSession(ctx.from.id, "CHECKOUT_FULL_NAME", {});
    await ctx.answerCallbackQuery();
    await ctx.reply("🧾 <b>Delivery information</b>\n\nWhat is your full name?", { parse_mode: "HTML" });
  });
  bot.callbackQuery("confirm_order", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const session = await getSession(ctx.from.id);
    if (session.state !== "CONFIRM_ORDER") {
      await ctx.answerCallbackQuery({ text: "This checkout session expired." });
      return;
    }
    const db = getSupabase();
    const result = await db.rpc("blissbl_checkout_cart", { p_customer_id: customer.id, p_delivery: session.context });
    if (result.error) throw result.error;
    const order = (result.data as Array<{ order_id: string; order_number: string; total_mmk: number }>)[0];
    await db.from("blissbl_customers").update({ full_name: session.context.full_name, phone: session.context.phone }).eq("id", customer.id);
    await setSession(ctx.from.id, "AWAITING_PAYMENT", { order_id: order.order_id });
    await ctx.answerCallbackQuery({ text: "Order created" });
    await ctx.replyWithPhoto(`${getConfig().APP_URL}/assets/kpay-qr.jpg`, {
      caption: `💳 <b>Payment</b>\nOrder: <b>${escapeHtml(order.order_number)}</b>\nTotal: <b>${formatMmk(order.total_mmk)}</b>\n\nKPay QR ကို scan ဖတ်ပြီး payment ပြုလုပ်ပါ။ Payment ပြီးသွားရင် screenshot/slip ကို ဒီ chat ထဲ upload လုပ်ပေးပါ။`,
      parse_mode: "HTML",
    });
  });
  bot.callbackQuery("my_orders", async (ctx) => { await ctx.answerCallbackQuery(); await showOrders(ctx); });
  bot.callbackQuery("account", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(`👤 <b>My Account</b>\n\nName: ${escapeHtml(customer.full_name || "Not set yet")}\nPhone: ${escapeHtml(customer.phone || "Not set yet")}`, { parse_mode: "HTML", reply_markup: backToMenu() });
  });
  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("❓ <b>Need help?</b>\n\nShop → add products → open cart → checkout → pay with KPay → upload your slip. We will notify you after review.", { parse_mode: "HTML", reply_markup: backToMenu() });
  });

  bot.callbackQuery("admin:home", async (ctx) => { await ctx.answerCallbackQuery(); await showAdmin(ctx); });
  bot.callbackQuery("admin:payments", async (ctx) => { await ctx.answerCallbackQuery(); await showPendingPayments(ctx); });
  bot.callbackQuery("admin:orders", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const { data } = await getSupabase().from("blissbl_orders").select("order_number,total_mmk,status,placed_at,customers:blissbl_customers(full_name,telegram_username)").order("placed_at", { ascending: false }).limit(10);
    const lines = ((data ?? []) as unknown as Array<{ order_number: string; total_mmk: number; status: string }>).map((o) => `• <b>${o.order_number}</b> — ${formatMmk(o.total_mmk)}\n  ${statusLabels[o.status] ?? o.status}`).join("\n\n");
    await ctx.answerCallbackQuery();
    await ctx.reply(`📦 <b>Recent orders</b>\n\n${lines || "No orders yet."}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("← Admin", "admin:home") });
  });
  bot.callbackQuery("admin:report", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const { data } = await getSupabase().from("blissbl_orders").select("total_mmk,status");
    const orders = (data ?? []) as Array<{ total_mmk: number; status: string }>;
    const paid = orders.filter((o) => !["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAYMENT_DECLINED", "CANCELLED"].includes(o.status));
    const revenue = paid.reduce((sum, o) => sum + Number(o.total_mmk), 0);
    await ctx.answerCallbackQuery();
    await ctx.reply(`📊 <b>Shop report</b>\n\nOrders: <b>${orders.length}</b>\nPaid orders: <b>${paid.length}</b>\nRevenue: <b>${formatMmk(revenue)}</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("← Admin", "admin:home") });
  });
  bot.callbackQuery(/^pay:approve:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) { await ctx.answerCallbackQuery({ text: "Admin only" }); return; }
    const result = await getSupabase().rpc("blissbl_review_payment", { p_payment_id: ctx.match[1], p_approved: true, p_admin_telegram_id: ctx.from.id, p_reason: null });
    if (result.error) throw result.error;
    const row = (result.data as Array<{ customer_telegram_user_id: number; order_number: string; total_mmk: number }>)[0];
    await ctx.answerCallbackQuery({ text: "Payment approved" });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ Approved", "noop") });
    await ctx.api.sendMessage(row.customer_telegram_user_id, `💗 Payment approved!\n\nOrder: ${row.order_number}\nAmount: ${formatMmk(row.total_mmk)}\nOrder status: Confirmed\n\nBLISSBL ကို အားပေးတဲ့အတွက် ကျေးဇူးတင်ပါတယ်။`);
  });
  bot.callbackQuery(/^pay:decline:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) { await ctx.answerCallbackQuery({ text: "Admin only" }); return; }
    await setSession(ctx.from.id, "ADMIN_DECLINE_REASON", { payment_id: ctx.match[1] });
    await ctx.answerCallbackQuery();
    await ctx.reply("Please send the decline reason.");
  });

  bot.on(["message:text", "message:photo", "message:document"], async (ctx) => {
    const session = await getSession(ctx.from.id);
    if (await handlePaymentSlip(ctx, session)) return;
    if (!ctx.message.text) return;
    const text = ctx.message.text;
    if (await processDeliveryText(ctx, session, text)) return;
    if (session.state === "CHECKOUT_NOTE") { await finishDelivery(ctx, session, text); return; }
    if (session.state === "ADMIN_DECLINE_REASON") {
      if (!(await isAdmin(ctx.from.id))) return;
      const paymentId = String(session.context.payment_id ?? "");
      const result = await getSupabase().rpc("blissbl_review_payment", { p_payment_id: paymentId, p_approved: false, p_admin_telegram_id: ctx.from.id, p_reason: text.trim() });
      if (result.error) throw result.error;
      const row = (result.data as Array<{ customer_telegram_user_id: number; order_number: string }>)[0];
      await setSession(ctx.from.id, "IDLE");
      await ctx.reply("Payment declined and customer notified.", { reply_markup: new InlineKeyboard().text("← Admin", "admin:home") });
      await ctx.api.sendMessage(row.customer_telegram_user_id, `Payment declined for ${row.order_number}.\nReason: ${text.trim()}\n\nPlease open your order and submit a new payment slip.`);
    }
  });

  bot.catch((error) => {
    console.error("Telegram update failed", { updateId: error.ctx.update.update_id, message: error.error instanceof Error ? error.error.message : "unknown" });
  });
  singleton = bot;
  return bot;
}
