export function formatMmk(amount: number | string): string {
  return `${Number(amount).toLocaleString("en-US")} MMK`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const statusLabels: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAYMENT_REVIEW: "Payment under review",
  PAYMENT_APPROVED: "Payment approved",
  PAYMENT_DECLINED: "Payment declined",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};
