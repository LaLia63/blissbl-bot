import { InlineKeyboard } from "grammy";

export const mainMenu = () =>
  new InlineKeyboard()
    .text("🛍 Shop", "shop")
    .text("🛒 My Cart", "cart")
    .row()
    .text("📦 My Orders", "my_orders")
    .text("👤 My Account", "account")
    .row()
    .text("❓ Help", "help");

export const backToMenu = () => new InlineKeyboard().text("← Main menu", "main_menu");
