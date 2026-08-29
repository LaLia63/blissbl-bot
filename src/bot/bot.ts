import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";

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

async function showHelp(ctx: Context): Promise<void> {
  await ctx.reply("<b>Need help?</b>\n\n1. Open Shop and choose a product.\n2. Add it to My Cart.\n3. Adjust quantities, then choose Checkout.\n4. Confirm delivery details.\n5. Pay with KPay and upload your slip.\n\nWe will notify you after payment review.", { parse_mode: "HTML", reply_markup: backToMenu() });
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
    keyboard.text(category.name, `cat:${category.id}:0`);
    if (index % 2 === 1) keyboard.row();
  }
  keyboard.row().text("My Cart", "cart").text("Main menu", "main_menu");
  await ctx.reply("<b>Choose a collection</b>\nPick a category to see what is available today.", {
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

  await ctx.reply(`<b>${escapeHtml(categoryInfo.name)}</b>`, { parse_mode: "HTML" });
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
  if (page > 0) nav.text("Previous", `cat:${categoryId}:${page - 1}`);
  nav.text(`${page + 1} / ${totalPages}`, "noop");
  if (page + 1 < totalPages) nav.text("Next", `cat:${categoryId}:${page + 1}`);
  nav.row().text("Collections", "shop").text("Cart", "cart");
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
  if (available) keyboard.text("Add to cart", `add:${product.id}`).row();
  keyboard.text("Keep shopping", "shop").text("My Cart", "cart");
  const stock = available ? "Available" : "Currently unavailable";
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
    .select("quantity,products:blissbl_products(id,name,price_mmk,is_available,stock_quantity)")
    .eq("cart_id", cartId)
    .order("created_at");
  if (error) throw error;
  const items = (data ?? []) as unknown as Array<{
    quantity: number;
    products: { id: string; name: string; price_mmk: number; is_available: boolean; stock_quantity: number | null };
  }>;
  if (items.length === 0) {
    await ctx.reply("<b>Your cart is empty.</b>\nLet’s find something lovely.", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Browse shop", "shop").text("Menu", "main_menu"),
    });
    return;
  }
  const total = items.reduce((sum, item) => sum + item.products.price_mmk * item.quantity, 0);
  const hasUnavailable = items.some((item) => !item.products.is_available || (item.products.stock_quantity !== null && item.products.stock_quantity < item.quantity));
  const lines = items.map((item, i) => {
    const unavailable = !item.products.is_available || (item.products.stock_quantity !== null && item.products.stock_quantity < item.quantity);
    return `${i + 1}. <b>${escapeHtml(item.products.name)}</b> x ${item.quantity}\n   ${formatMmk(item.products.price_mmk * item.quantity)}${unavailable ? "\n   Currently unavailable - remove this item to continue" : ""}`;
  });
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    keyboard
      .text("-", `qty:-:${item.products.id}`)
      .text(`${item.quantity}`, "noop")
      .text("+", `qty:+:${item.products.id}`)
      .text("Remove", `remove:${item.products.id}`)
      .row();
  }
  keyboard.text("Clear cart", "clear_cart").text("Continue shopping", "shop").row();
  if (!hasUnavailable) keyboard.text("Checkout", "checkout");
  const checkoutHint = hasUnavailable ? "\n\nRemove unavailable items before checkout." : "\n\nUse - / + to change quantity, or Remove to delete an item.";
  await ctx.reply(`<b>My Cart</b>\n\n${lines.join("\n\n")}\n\n<b>Subtotal: ${formatMmk(total)}</b>${checkoutHint}`, {
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
  const text = orders.map((order) => `<b>${order.order_number}</b> - ${formatMmk(order.total_mmk)}\n${statusLabels[order.status] ?? order.status}`).join("\n\n");
  const keyboard = new InlineKeyboard();
  for (const order of orders) {
    if (order.status === "PAYMENT_DECLINED") keyboard.text(`Resubmit ${order.order_number}`, `resubmit:${order.id}`).row();
  }
  keyboard.text("Main menu", "main_menu");
  await ctx.reply(`<b>My Orders</b>\n\n${text}`, { parse_mode: "HTML", reply_markup: keyboard });
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
    .text("Pending payments", "admin:payments")
    .row()
    .text("Recent orders", "admin:orders")
    .text("Report", "admin:report")
    .row()
    .text("Customers", "admin:customers")
    .text("Inventory", "admin:products")
    .row()
    .text("Addresses", "admin:addresses")
    .text("Export CSV", "admin:export")
    .row()
    .text("Settings", "admin:settings")
    .row()
    .text("Customer menu", "main_menu");
  await ctx.reply(
    `<b>BLISSBL Admin</b>\n\nPending payments: <b>${pendingPayments ?? 0}</b>\nActive orders: <b>${activeOrders ?? 0}</b>\nCustomers: <b>${customers ?? 0}</b>\n\nUse the buttons below to review payments, orders, and shop totals.`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showAdminCustomers(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_customers")
    .select("telegram_user_id,telegram_username,full_name,phone,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const customers = (data ?? []) as Array<{ telegram_user_id: number; telegram_username: string | null; full_name: string | null; phone: string | null }>;
  const lines = customers.map((customer, index) => {
    const name = customer.full_name || customer.telegram_username || "Unnamed customer";
    return `${index + 1}. <b>${escapeHtml(name)}</b>\nTelegram ID: <code>${customer.telegram_user_id}</code>\nPhone: ${escapeHtml(customer.phone || "Not provided")}`;
  });
  await ctx.reply(`<b>Customers</b>\n\n${lines.join("\n\n") || "No customers yet."}`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Admin", "admin:home"),
  });
}

async function showAdminProducts(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_products")
    .select("id,name,sku,price_mmk,stock_quantity,is_available")
    .order("name")
    .limit(50);
  if (error) throw error;
  const products = (data ?? []) as Array<{ id: string; name: string; sku: string | null; price_mmk: number; stock_quantity: number | null; is_available: boolean }>;
  await ctx.reply(`<b>Inventory</b>\n\n${products.length ? "Choose a product to edit, hide, or delete." : "No products yet."}`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Add product", "admin:prod:add").text("Admin", "admin:home"),
  });
  for (const product of products) {
    const status = product.is_available ? "Available" : "Hidden";
    await ctx.reply(`${status} | <b>${escapeHtml(product.name)}</b>\n${product.sku ? `SKU: ${escapeHtml(product.sku)} | ` : ""}${formatMmk(product.price_mmk)} | Stock: ${product.stock_quantity ?? "Unlimited"}`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("Edit", `admin:prod:edit:${product.id}`)
        .text(product.is_available ? "Hide" : "Show", `admin:prod:t:${product.id}`)
        .text("Delete", `admin:prod:d:${product.id}`),
    });
  }
}

type AdminProductDraft = {
  category_id: string;
  name: string;
  description: string;
  price_mmk: number;
  stock_quantity: number | null;
  sku: string | null;
  image_path: string | null;
  image_url: string | null;
};

async function startAdminProductAdd(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_categories")
    .select("id,name")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  const keyboard = new InlineKeyboard();
  for (const category of (data ?? []) as Array<{ id: string; name: string }>) {
    keyboard.text(category.name, `admin:prod:addcat:${category.id}`).row();
  }
  keyboard.text("Cancel", "admin:products");
  await ctx.reply("<b>Add product</b>\n\nFirst choose a category.", { parse_mode: "HTML", reply_markup: keyboard });
}

async function showAdminProductEditMenu(ctx: Context, productId: string): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_products")
    .select("id,name,description,price_mmk,stock_quantity,sku,image_path,image_url,is_available")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await ctx.reply("Product not found.", { reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
    return;
  }
  const product = data as ProductRow;
  const keyboard = new InlineKeyboard()
    .text("Name", `admin:prod:f:name:${productId}`)
    .text("Description", `admin:prod:f:description:${productId}`)
    .row()
    .text("Price", `admin:prod:f:price:${productId}`)
    .text("Stock", `admin:prod:f:stock:${productId}`)
    .row()
    .text("SKU", `admin:prod:f:sku:${productId}`)
    .text("Image", `admin:prod:f:image:${productId}`)
    .row()
    .text(product.is_available ? "Hide from shop" : "Show in shop", `admin:prod:t:${productId}`)
    .text("Delete", `admin:prod:d:${productId}`)
    .row()
    .text("Inventory", "admin:products");
  await ctx.reply(`<b>Edit product</b>\n\n<b>${escapeHtml(product.name)}</b>\n${formatMmk(product.price_mmk)} | Stock: ${product.stock_quantity ?? "Unlimited"}\nSKU: ${escapeHtml(product.sku || "Not set")}\nStatus: ${product.is_available ? "Available" : "Hidden"}\n\nChoose a field to edit.`, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function confirmAdminProductAdd(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const session = await getSession(ctx.from.id);
  if (session.state !== "ADMIN_PRODUCT_ADD_CONFIRM") {
    await ctx.reply("This add-product session has expired. Start again from Inventory.", { reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
    return;
  }
  const draft = { ...session.context } as unknown as AdminProductDraft & { category_name?: string };
  delete draft.category_name;
  const { data: product, error } = await getSupabase()
    .from("blissbl_products")
    .insert({ ...draft, is_available: true, is_new: true, is_best_seller: false })
    .select("id,name")
    .single();
  if (error) {
    if (error.code === "23505") {
      await ctx.reply("That SKU is already in use. Start again with a different SKU.", { reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
      await setSession(ctx.from.id, "IDLE");
      return;
    }
    throw error;
  }
  await setSession(ctx.from.id, "IDLE");
  await ctx.reply(`Product added: <b>${escapeHtml((product as { name: string }).name)}</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
}

async function deleteAdminProduct(ctx: Context, productId: string): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data: product, error: lookupError } = await getSupabase().from("blissbl_products").select("name").eq("id", productId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!product) {
    await ctx.reply("Product not found.", { reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
    return;
  }
  const { error } = await getSupabase().from("blissbl_products").delete().eq("id", productId);
  if (error) throw error;
  await setSession(ctx.from.id, "IDLE");
  await ctx.reply(`Deleted product: <b>${escapeHtml((product as { name: string }).name)}</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Inventory", "admin:products") });
}

async function showAdminAddresses(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_delivery_addresses")
    .select("recipient_name,phone,address_line,township,city,customers:blissbl_customers(full_name,telegram_username)")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const addresses = (data ?? []) as unknown as Array<{ recipient_name: string; phone: string; address_line: string; township: string; city: string; customers: { full_name: string | null; telegram_username: string | null } }>;
  const lines = addresses.map((address, index) => `${index + 1}. <b>${escapeHtml(address.recipient_name)}</b> - ${escapeHtml(address.city)}\nCustomer: ${escapeHtml(address.customers?.full_name || address.customers?.telegram_username || "Unknown")}\nPhone: ${escapeHtml(address.phone)}\n${escapeHtml(address.address_line)}, ${escapeHtml(address.township)}`);
  await ctx.reply(`<b>Delivery addresses</b>\n\n${lines.join("\n\n") || "No saved addresses yet."}`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Admin", "admin:home"),
  });
}

async function exportAdminOrders(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data, error } = await getSupabase()
    .from("blissbl_orders")
    .select("order_number,total_mmk,status,placed_at,customers:blissbl_customers(full_name,telegram_username)")
    .order("placed_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ order_number: string; total_mmk: number; status: string; placed_at: string; customers: { full_name: string | null; telegram_username: string | null } }>;
  const csvEscape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = ["Order,Customer,Amount MMK,Status,Placed at", ...rows.map((row) => [row.order_number, row.customers?.full_name || row.customers?.telegram_username || "", row.total_mmk, row.status, row.placed_at].map(csvEscape).join(","))].join("\n");
  await ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf8"), "blissbl-orders.csv"), { caption: "Your BLISSBL orders export is ready." });
}

async function showAdminSettings(ctx: Context): Promise<void> {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
  const { data } = await getSupabase().from("blissbl_app_settings").select("delivery_fee_mmk,kpay_qr_path,support_text").eq("id", true).maybeSingle();
  const settings = data as { delivery_fee_mmk?: number; kpay_qr_path?: string; support_text?: string } | null;
  await ctx.reply(`<b>Shop settings</b>\n\nDelivery fee: ${formatMmk(settings?.delivery_fee_mmk ?? 0)}\nKPay QR: ${escapeHtml(settings?.kpay_qr_path || "Not configured")}\nSupport: ${escapeHtml(settings?.support_text || "Not configured")}\n\nTo update settings, edit the values in Supabase and use this menu to verify them.`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Admin", "admin:home"),
  });
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
    await ctx.reply("No pending payments.", { reply_markup: new InlineKeyboard().text("Admin", "admin:home") });
    return;
  }
  for (const payment of payments) {
    const { data: signed } = await getSupabase().storage.from("blissbl-payment-slips").createSignedUrl(payment.slip_object_path, 120);
    const keyboard = new InlineKeyboard()
      .text("Approve", `pay:approve:${payment.id}`)
      .text("Decline", `pay:decline:${payment.id}`);
    const customerName = payment.orders.customers.full_name || payment.orders.customers.telegram_username || "Customer";
    const caption = `<b>New payment</b>\nOrder: <b>${escapeHtml(payment.orders.order_number)}</b>\nCustomer: ${escapeHtml(customerName)}\nAmount: <b>${formatMmk(payment.amount_mmk)}</b>`;
    if (signed?.signedUrl) await ctx.replyWithPhoto(signed.signedUrl, { caption, parse_mode: "HTML", reply_markup: keyboard });
    else await ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function processAdminProductText(ctx: Context, session: SessionRow, text: string): Promise<boolean> {
  if (!ctx.from || !session.state.startsWith("ADMIN_PRODUCT_")) return false;
  if (!(await isAdmin(ctx.from.id))) {
    await setSession(ctx.from.id, "IDLE");
    return false;
  }
  const value = text.trim();
  const addSteps: Record<string, { key: keyof AdminProductDraft; next: string; prompt: string }> = {
    ADMIN_PRODUCT_ADD_NAME: { key: "name", next: "ADMIN_PRODUCT_ADD_DESCRIPTION", prompt: "Step 3 of 7: Product description? Send '-' to skip." },
    ADMIN_PRODUCT_ADD_DESCRIPTION: { key: "description", next: "ADMIN_PRODUCT_ADD_PRICE", prompt: "Step 4 of 7: Price in MMK (numbers only)?" },
    ADMIN_PRODUCT_ADD_PRICE: { key: "price_mmk", next: "ADMIN_PRODUCT_ADD_STOCK", prompt: "Step 5 of 7: Stock quantity? Send '-' for unlimited stock." },
    ADMIN_PRODUCT_ADD_STOCK: { key: "stock_quantity", next: "ADMIN_PRODUCT_ADD_SKU", prompt: "Step 6 of 7: SKU? Send '-' to leave it blank." },
    ADMIN_PRODUCT_ADD_SKU: { key: "sku", next: "ADMIN_PRODUCT_ADD_IMAGE", prompt: "Step 7 of 7: Image URL or filename under /assets? Send '-' to skip." },
    ADMIN_PRODUCT_ADD_IMAGE: { key: "image_path", next: "ADMIN_PRODUCT_ADD_CONFIRM", prompt: "" },
  };
  const addStep = addSteps[session.state];
  if (addStep) {
    let parsed: string | number | null = value;
    if (session.state === "ADMIN_PRODUCT_ADD_NAME") {
      if (value.length < 2 || value.length > 120) { await ctx.reply("Name must be between 2 and 120 characters. Try again."); return true; }
    } else if (session.state === "ADMIN_PRODUCT_ADD_DESCRIPTION") {
      parsed = value === "-" ? "" : value;
      if (String(parsed).length > 500) { await ctx.reply("Description must be 500 characters or fewer. Try again."); return true; }
    } else if (session.state === "ADMIN_PRODUCT_ADD_PRICE") {
      if (!/^\d+$/.test(value) || Number(value) <= 0) { await ctx.reply("Price must be a positive whole number in MMK. Try again."); return true; }
      parsed = Number(value);
    } else if (session.state === "ADMIN_PRODUCT_ADD_STOCK") {
      if (value === "-") parsed = null;
      else if (!/^\d+$/.test(value)) { await ctx.reply("Stock must be a whole number, or '-' for unlimited. Try again."); return true; }
      else parsed = Number(value);
    } else if (session.state === "ADMIN_PRODUCT_ADD_SKU") {
      parsed = value === "-" ? null : value;
      if (parsed && (String(parsed).length < 2 || String(parsed).length > 80)) { await ctx.reply("SKU must be between 2 and 80 characters, or '-'. Try again."); return true; }
    } else if (session.state === "ADMIN_PRODUCT_ADD_IMAGE") {
      parsed = value === "-" ? null : value;
      if (parsed && String(parsed).length > 500) { await ctx.reply("Image URL or filename must be 500 characters or fewer. Try again."); return true; }
    }
    const nextContext = { ...session.context, [addStep.key]: parsed };
    await setSession(ctx.from.id, addStep.next, nextContext);
    if (session.state === "ADMIN_PRODUCT_ADD_IMAGE") {
      const draft = nextContext as unknown as AdminProductDraft;
      const imageValue = value === "-" ? null : value;
      const finalDraft = { ...draft, image_path: imageValue && !/^https?:\/\//i.test(imageValue) ? imageValue : null, image_url: imageValue && /^https?:\/\//i.test(imageValue) ? imageValue : null };
      await setSession(ctx.from.id, "ADMIN_PRODUCT_ADD_CONFIRM", finalDraft);
      await ctx.reply(`<b>Review new product</b>\n\nName: ${escapeHtml(finalDraft.name)}\nPrice: ${formatMmk(finalDraft.price_mmk)}\nStock: ${finalDraft.stock_quantity ?? "Unlimited"}\nSKU: ${escapeHtml(finalDraft.sku || "Not set")}\nImage: ${escapeHtml(imageValue || "Not set")}`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("Save product", "admin:prod:addsave").text("Cancel", "admin:products"),
      });
    } else {
      await ctx.reply(addStep.prompt);
    }
    return true;
  }

  const editMatch = /^ADMIN_PRODUCT_EDIT_(NAME|DESCRIPTION|PRICE|STOCK|SKU|IMAGE)$/.exec(session.state);
  if (!editMatch) {
    if (session.state === "ADMIN_PRODUCT_EDIT_MENU" || session.state === "ADMIN_PRODUCT_ADD_CONFIRM") {
      await ctx.reply("Please use the buttons above to continue.");
      return true;
    }
    return false;
  }
  const productId = String(session.context.product_id ?? "");
  if (!productId) { await setSession(ctx.from.id, "IDLE"); return false; }
  const field = editMatch[1].toLowerCase();
  const column: string = field === "image" ? "image_path" : field === "price" ? "price_mmk" : field === "stock" ? "stock_quantity" : field;
  let parsed: string | number | null = value;
  if (field === "name" && (value.length < 2 || value.length > 120)) { await ctx.reply("Name must be between 2 and 120 characters. Try again."); return true; }
  if (field === "description") { parsed = value === "-" ? "" : value; if (String(parsed).length > 500) { await ctx.reply("Description must be 500 characters or fewer. Try again."); return true; } }
  if (field === "price") { if (!/^\d+$/.test(value) || Number(value) <= 0) { await ctx.reply("Price must be a positive whole number in MMK. Try again."); return true; } parsed = Number(value); }
  if (field === "stock") { if (value === "-") parsed = null; else if (!/^\d+$/.test(value)) { await ctx.reply("Stock must be a whole number, or '-' for unlimited. Try again."); return true; } else parsed = Number(value); }
  if (field === "sku") { parsed = value === "-" ? null : value; if (parsed && (String(parsed).length < 2 || String(parsed).length > 80)) { await ctx.reply("SKU must be between 2 and 80 characters, or '-'. Try again."); return true; } }
  if (field === "image") {
    const imageValue = value === "-" ? null : value;
    const update = { image_path: imageValue && !/^https?:\/\//i.test(imageValue) ? imageValue : null, image_url: imageValue && /^https?:\/\//i.test(imageValue) ? imageValue : null };
    const result = await getSupabase().from("blissbl_products").update(update).eq("id", productId);
    if (result.error) throw result.error;
  } else {
    const result = await getSupabase().from("blissbl_products").update({ [column]: parsed }).eq("id", productId);
    if (result.error) {
      if (result.error.code === "23505") { await ctx.reply("That SKU is already in use. Try another one."); return true; }
      throw result.error;
    }
  }
  await setSession(ctx.from.id, "ADMIN_PRODUCT_EDIT_MENU", { product_id: productId });
  await ctx.reply("Product updated.");
  await showAdminProductEditMenu(ctx, productId);
  return true;
}

async function processDeliveryText(ctx: Context, session: SessionRow, text: string): Promise<boolean> {
  if (!ctx.from) return false;
  const steps: Record<string, { key: string; next: string; prompt: string }> = {
    CHECKOUT_FULL_NAME: { key: "full_name", next: "CHECKOUT_PHONE", prompt: "Step 2 of 7: What phone number should we use?" },
    CHECKOUT_PHONE: { key: "phone", next: "CHECKOUT_RECIPIENT", prompt: "Step 3 of 7: Who should receive the package?" },
    CHECKOUT_RECIPIENT: { key: "recipient_name", next: "CHECKOUT_RECIPIENT_PHONE", prompt: "Step 4 of 7: Recipient phone number?" },
    CHECKOUT_RECIPIENT_PHONE: { key: "recipient_phone", next: "CHECKOUT_ADDRESS", prompt: "Step 5 of 7: Full delivery address?" },
    CHECKOUT_ADDRESS: { key: "address_line", next: "CHECKOUT_TOWNSHIP", prompt: "Step 6 of 7: Township?" },
    CHECKOUT_TOWNSHIP: { key: "township", next: "CHECKOUT_CITY", prompt: "Step 7 of 7: City?" },
    CHECKOUT_CITY: { key: "city", next: "CHECKOUT_NOTE", prompt: "Any delivery note? Send '-' if none." },
  };
  const step = steps[session.state];
  if (!step) return false;
  if (text.trim().length < 2 || text.trim().length > 500) {
    await ctx.reply("Please enter a valid value between 2 and 500 characters.");
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
    `<b>Confirm delivery</b>\n\nRecipient: ${escapeHtml(delivery.recipient_name)}\nPhone: ${escapeHtml(delivery.recipient_phone)}\nAddress: ${escapeHtml(delivery.address_line)}, ${escapeHtml(delivery.township)}, ${escapeHtml(delivery.city)}\nNote: ${escapeHtml(delivery.delivery_note || "None")}\n\nKPay payment QR will appear after you press Confirm order.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Confirm order", "confirm_order").row().text("Cancel", "cart"),
    },
  );
}

type PaymentOrder = { order_id: string; order_number: string | number; total_mmk: number };

async function sendPaymentInstructions(ctx: Context, order: PaymentOrder, title = "Payment"): Promise<void> {
  const qrUrl = `${getConfig().APP_URL}/assets/kpay-qr.jpg`;
  const caption = `<b>${title}</b>\nOrder: <b>${escapeHtml(String(order.order_number))}</b>\nTotal: <b>${formatMmk(order.total_mmk)}</b>\n\nScan the KPay QR, complete payment, then upload your screenshot or PDF slip in this chat.`;
  try {
    await ctx.replyWithPhoto(qrUrl, { caption, parse_mode: "HTML" });
  } catch (error) {
    // Telegram may occasionally reject a remote image URL. Keep checkout usable by
    // sending the QR URL as text so the customer can still complete payment.
    console.error("Payment QR delivery failed", error instanceof Error ? { name: error.name, message: error.message } : error);
    await ctx.reply(`${caption.replace(/<[^>]+>/g, "")}\n\nOpen the payment QR here: ${qrUrl}`);
  }
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
  await ctx.reply(`<b>Payment slip received!</b>\nOrder: <b>${escapeHtml((order as { order_number: string }).order_number)}</b>\nWe will notify you after the admin review.`, { parse_mode: "HTML", reply_markup: mainMenu() });
  const { data: signed } = await db.storage.from("blissbl-payment-slips").createSignedUrl(path, 300);
  const keyboard = new InlineKeyboard().text("Approve", `pay:approve:${(payment.data as { id: string }).id}`).text("Decline", `pay:decline:${(payment.data as { id: string }).id}`);
  if (signed?.signedUrl) {
    await ctx.api.sendPhoto(getConfig().TELEGRAM_ADMIN_USER_ID, signed.signedUrl, {
      caption: `New payment\nOrder: ${(order as { order_number: string }).order_number}\nAmount: ${formatMmk((order as { total_mmk: number }).total_mmk)}`,
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
      caption: "<b>Welcome to BLISSBL!</b>\n\nBrowse BL merchandise, add your favourites to the cart, and place your order in this chat.",
      parse_mode: "HTML",
    });
    await showMainMenu(ctx, "Choose Shop to browse, My Cart to review your items, or My Orders to track a purchase.");
  });

  // Keep the Telegram command menu in sync with the inline buttons.
  bot.command("shop", showCategories);
  bot.command("cart", showCart);
  bot.command("orders", showOrders);
  bot.command("help", showHelp);
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
    await ctx.answerCallbackQuery({ text: "Added to your cart" });
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    const productId = ctx.match[1];
    const { data: existing } = await getSupabase().from("blissbl_cart_items").select("quantity").eq("cart_id", cartId).eq("product_id", productId).maybeSingle();
    const quantity = Math.min(99, Number((existing as { quantity?: number } | null)?.quantity ?? 0) + 1);
    const { error } = await getSupabase().from("blissbl_cart_items").upsert({ cart_id: cartId, product_id: productId, quantity }, { onConflict: "cart_id,product_id" });
    if (error) throw error;
    await ctx.reply("Added to your cart. What would you like to do next?", {
      reply_markup: new InlineKeyboard().text("View my cart", "cart").text("Keep shopping", "shop"),
    });
  });
  bot.callbackQuery("cart", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch (error) {
      // An old inline button can have an expired callback query; still show the cart.
      console.warn("Cart callback acknowledgement skipped", error instanceof Error ? error.message : "unknown");
    }
    await showCart(ctx);
  });
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
    await ctx.answerCallbackQuery();
    await ctx.reply("Clear every item from your cart?", {
      reply_markup: new InlineKeyboard().text("Yes, clear cart", "confirm_clear_cart").text("Keep my cart", "cart"),
    });
  });
  bot.callbackQuery("confirm_clear_cart", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    await getSupabase().from("blissbl_cart_items").delete().eq("cart_id", cartId);
    await ctx.answerCallbackQuery({ text: "Cart cleared" });
    await showCart(ctx);
  });
  bot.callbackQuery("checkout", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const cartId = await getOrCreateCart(customer.id);
    const { count, error } = await getSupabase().from("blissbl_cart_items").select("id", { head: true, count: "exact" }).eq("cart_id", cartId);
    if (error) throw error;
    if (!count) {
      await ctx.answerCallbackQuery({ text: "Your cart is empty" });
      await showCart(ctx);
      return;
    }
    await setSession(ctx.from.id, "CHECKOUT_FULL_NAME", {});
    await ctx.answerCallbackQuery();
    await ctx.reply("<b>Delivery information</b>\n\nPayment QR will appear after you finish these details and press Confirm order.\n\nStep 1 of 7: What is your full name?", { parse_mode: "HTML" });
  });
  bot.callbackQuery("confirm_order", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const session = await getSession(ctx.from.id);
    if (session.state === "AWAITING_PAYMENT" && session.context.order_id) {
      const { data: existingOrder } = await getSupabase()
        .from("blissbl_orders")
        .select("id,order_number,total_mmk")
        .eq("id", String(session.context.order_id))
        .eq("customer_id", customer.id)
        .maybeSingle();
      if (existingOrder) {
        try { await ctx.answerCallbackQuery({ text: "Payment details resent" }); } catch { /* callback may be expired */ }
        await sendPaymentInstructions(ctx, { order_id: existingOrder.id, order_number: existingOrder.order_number, total_mmk: existingOrder.total_mmk });
        return;
      }
    }
    if (session.state !== "CONFIRM_ORDER") {
      try { await ctx.answerCallbackQuery({ text: "This checkout session expired." }); } catch { /* callback may be expired */ }
      return;
    }
    const db = getSupabase();
    const result = await db.rpc("blissbl_checkout_cart", { p_customer_id: customer.id, p_delivery: session.context });
    if (result.error) {
      console.error("Checkout order creation failed", result.error);
      try { await ctx.answerCallbackQuery({ text: "Checkout failed" }); } catch { /* callback may be expired */ }
      await ctx.reply("I couldn't create the order yet. Please open My Cart and try Checkout again.");
      return;
    }
    const order = (Array.isArray(result.data) ? result.data[0] : result.data) as PaymentOrder | undefined;
    if (!order?.order_id || order.total_mmk === undefined) {
      console.error("Checkout returned no order", { data: result.data });
      try { await ctx.answerCallbackQuery({ text: "Checkout failed" }); } catch { /* callback may be expired */ }
      await ctx.reply("I couldn't create the order yet. Please open My Cart and try Checkout again.");
      return;
    }
    const delivery = session.context as Record<string, string>;
    const { error: customerError } = await db.from("blissbl_customers").update({ full_name: delivery.full_name, phone: delivery.phone }).eq("id", customer.id);
    if (customerError) throw customerError;
    const { error: addressError } = await db.from("blissbl_delivery_addresses").insert({
      customer_id: customer.id,
      recipient_name: delivery.recipient_name,
      phone: delivery.recipient_phone,
      address_line: delivery.address_line,
      township: delivery.township,
      city: delivery.city,
      delivery_note: delivery.delivery_note || null,
      is_default: false,
    });
    if (addressError) throw addressError;
    await setSession(ctx.from.id, "AWAITING_PAYMENT", { order_id: order.order_id });
    try { await ctx.answerCallbackQuery({ text: "Order created" }); } catch { /* callback may be expired */ }
    await sendPaymentInstructions(ctx, order);
  });
  bot.callbackQuery("my_orders", async (ctx) => { await ctx.answerCallbackQuery(); await showOrders(ctx); });
  bot.callbackQuery(/^resubmit:([^:]+)$/, async (ctx) => {
    const customer = await ensureCustomer(ctx);
    const orderId = ctx.match[1];
    const { data: order, error } = await getSupabase()
      .from("blissbl_orders")
      .select("id,order_number,total_mmk,status")
      .eq("id", orderId)
      .eq("customer_id", customer.id)
      .eq("status", "PAYMENT_DECLINED")
      .single();
    if (error || !order) {
      await ctx.answerCallbackQuery({ text: "This order is not ready for resubmission" });
      return;
    }
    await setSession(ctx.from.id, "AWAITING_PAYMENT", { order_id: order.id });
    await ctx.answerCallbackQuery();
    await sendPaymentInstructions(ctx, { order_id: order.id, order_number: order.order_number, total_mmk: order.total_mmk }, "Resubmit payment");
  });
  bot.callbackQuery("account", async (ctx) => {
    const customer = await ensureCustomer(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>My Account</b>\n\nName: ${escapeHtml(customer.full_name || "Not set yet")}\nPhone: ${escapeHtml(customer.phone || "Not set yet")}`, { parse_mode: "HTML", reply_markup: backToMenu() });
  });
  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHelp(ctx);
  });

  bot.callbackQuery("admin:home", async (ctx) => { await ctx.answerCallbackQuery(); await showAdmin(ctx); });
  bot.callbackQuery("admin:payments", async (ctx) => { await ctx.answerCallbackQuery(); await showPendingPayments(ctx); });
  bot.callbackQuery("admin:customers", async (ctx) => { await ctx.answerCallbackQuery(); await showAdminCustomers(ctx); });
  bot.callbackQuery("admin:products", async (ctx) => { await ctx.answerCallbackQuery(); await showAdminProducts(ctx); });
  bot.callbackQuery("admin:prod:add", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAdminProductAdd(ctx);
  });
  bot.callbackQuery(/^admin:prod:addcat:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const categoryId = ctx.match[1];
    const { data: category, error } = await getSupabase().from("blissbl_categories").select("id,name").eq("id", categoryId).eq("is_active", true).maybeSingle();
    if (error) throw error;
    if (!category) {
      await ctx.answerCallbackQuery({ text: "Category not found" });
      return;
    }
    await setSession(ctx.from.id, "ADMIN_PRODUCT_ADD_NAME", { category_id: categoryId, category_name: (category as { name: string }).name });
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Add product</b>\nCategory: ${escapeHtml((category as { name: string }).name)}\n\nStep 2 of 7: Product name?`, { parse_mode: "HTML" });
  });
  bot.callbackQuery("admin:prod:addsave", async (ctx) => {
    await ctx.answerCallbackQuery();
    await confirmAdminProductAdd(ctx);
  });
  bot.callbackQuery(/^admin:prod:edit:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    await ctx.answerCallbackQuery();
    await setSession(ctx.from.id, "ADMIN_PRODUCT_EDIT_MENU", { product_id: ctx.match[1] });
    await showAdminProductEditMenu(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^admin:prod:f:(name|description|price|stock|sku|image):([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const field = ctx.match[1];
    const prompts: Record<string, string> = {
      name: "Send the new product name (2-120 characters).",
      description: "Send the new description, or '-' to clear it.",
      price: "Send the new price in MMK (positive whole number).",
      stock: "Send the new stock quantity, or '-' for unlimited stock.",
      sku: "Send the new SKU, or '-' to clear it.",
      image: "Send an image URL or filename under /assets, or '-' to clear it.",
    };
    await setSession(ctx.from.id, `ADMIN_PRODUCT_EDIT_${field.toUpperCase()}`, { product_id: ctx.match[2] });
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Edit ${field}</b>\n\n${prompts[field]}`, { parse_mode: "HTML" });
  });
  bot.callbackQuery(/^admin:prod:t:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const productId = ctx.match[1];
    const { data: product, error: lookupError } = await getSupabase().from("blissbl_products").select("name,is_available").eq("id", productId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!product) { await ctx.answerCallbackQuery({ text: "Product not found" }); return; }
    const nextAvailability = !(product as { is_available: boolean }).is_available;
    const { error } = await getSupabase().from("blissbl_products").update({ is_available: nextAvailability }).eq("id", productId);
    if (error) throw error;
    await ctx.answerCallbackQuery({ text: nextAvailability ? "Product visible" : "Product hidden" });
    await ctx.reply(`<b>${escapeHtml((product as { name: string }).name)}</b> is now ${nextAvailability ? "visible in" : "hidden from"} the shop.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Edit product", `admin:prod:edit:${productId}`).text("Inventory", "admin:products") });
  });
  bot.callbackQuery(/^admin:prod:d:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const productId = ctx.match[1];
    const { data: product, error } = await getSupabase().from("blissbl_products").select("name").eq("id", productId).maybeSingle();
    if (error) throw error;
    if (!product) { await ctx.answerCallbackQuery({ text: "Product not found" }); return; }
    await ctx.answerCallbackQuery();
    await ctx.reply(`Delete <b>${escapeHtml((product as { name: string }).name)}</b> permanently? Existing cart rows will be removed and past order items will keep their saved name.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Delete permanently", `admin:prod:dy:${productId}`).text("Keep product", "admin:products"),
    });
  });
  bot.callbackQuery(/^admin:prod:dy:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    await ctx.answerCallbackQuery({ text: "Deleting product" });
    await deleteAdminProduct(ctx, ctx.match[1]);
  });
  bot.callbackQuery("admin:addresses", async (ctx) => { await ctx.answerCallbackQuery(); await showAdminAddresses(ctx); });
  bot.callbackQuery("admin:export", async (ctx) => { await ctx.answerCallbackQuery({ text: "Preparing export" }); await exportAdminOrders(ctx); });
  bot.callbackQuery("admin:settings", async (ctx) => { await ctx.answerCallbackQuery(); await showAdminSettings(ctx); });
  bot.callbackQuery("admin:orders", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const { data } = await getSupabase().from("blissbl_orders").select("order_number,total_mmk,status,placed_at,customers:blissbl_customers(full_name,telegram_username)").order("placed_at", { ascending: false }).limit(10);
    const lines = ((data ?? []) as unknown as Array<{ order_number: string; total_mmk: number; status: string }>).map((o) => `<b>${o.order_number}</b> - ${formatMmk(o.total_mmk)}\n${statusLabels[o.status] ?? o.status}`).join("\n\n");
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Recent orders</b>\n\n${lines || "No orders yet."}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Admin", "admin:home") });
  });
  bot.callbackQuery("admin:report", async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return;
    const { data } = await getSupabase().from("blissbl_orders").select("total_mmk,status");
    const orders = (data ?? []) as Array<{ total_mmk: number; status: string }>;
    const paid = orders.filter((o) => !["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAYMENT_DECLINED", "CANCELLED"].includes(o.status));
    const revenue = paid.reduce((sum, o) => sum + Number(o.total_mmk), 0);
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Shop report</b>\n\nOrders: <b>${orders.length}</b>\nPaid orders: <b>${paid.length}</b>\nRevenue: <b>${formatMmk(revenue)}</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Admin", "admin:home") });
  });
  bot.callbackQuery(/^pay:approve:([^:]+)$/, async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) { await ctx.answerCallbackQuery({ text: "Admin only" }); return; }
    const result = await getSupabase().rpc("blissbl_review_payment", { p_payment_id: ctx.match[1], p_approved: true, p_admin_telegram_id: ctx.from.id, p_reason: null });
    if (result.error) throw result.error;
    const row = (result.data as Array<{ customer_telegram_user_id: number; order_number: string; total_mmk: number }>)[0];
    await ctx.answerCallbackQuery({ text: "Payment approved" });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("Approved", "noop") });
    await ctx.api.sendMessage(row.customer_telegram_user_id, `Payment approved!\n\nOrder: ${row.order_number}\nAmount: ${formatMmk(row.total_mmk)}\nOrder status: Confirmed\n\nYour BLISSBL order is now being prepared.`);
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
    if (await processAdminProductText(ctx, session, text)) return;
    if (await processDeliveryText(ctx, session, text)) return;
    if (session.state === "CHECKOUT_NOTE") { await finishDelivery(ctx, session, text); return; }
    if (session.state === "ADMIN_DECLINE_REASON") {
      if (!(await isAdmin(ctx.from.id))) return;
      const paymentId = String(session.context.payment_id ?? "");
      const result = await getSupabase().rpc("blissbl_review_payment", { p_payment_id: paymentId, p_approved: false, p_admin_telegram_id: ctx.from.id, p_reason: text.trim() });
      if (result.error) throw result.error;
      const row = (result.data as Array<{ customer_telegram_user_id: number; order_number: string }>)[0];
      await setSession(ctx.from.id, "IDLE");
      await ctx.reply("Payment declined and customer notified.", { reply_markup: new InlineKeyboard().text("Admin", "admin:home") });
      await ctx.api.sendMessage(row.customer_telegram_user_id, `Payment declined for ${row.order_number}.\nReason: ${text.trim()}\n\nPlease open your order and submit a new payment slip.`);
    }
  });

  bot.catch(async (error) => {
    console.error("Telegram update failed", { updateId: error.ctx.update.update_id, message: error.error instanceof Error ? error.error.message : "unknown" });
    try {
      await error.ctx.reply("Sorry, something went wrong. Please tap Main menu and try again.", { reply_markup: mainMenu() });
    } catch {
      // Ignore secondary Telegram errors while handling the original failure.
    }
  });
  singleton = bot;
  return bot;
}
