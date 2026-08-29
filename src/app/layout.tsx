import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL?.replace(/^\uFEFF/, "").trim() ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^\uFEFF/, "").trim()}`
        : "http://localhost:3000"),
  ),
  title: "BLISSBL — Official Merchandise Shop",
  description: "Shop BL mascots, photocards and merchandise with fast Telegram ordering, KPay and order tracking.",
  openGraph: {
    title: "BLISSBL — Your BL favourites, one tap away.",
    description: "Shop mascots, photocards and merchandise directly in Telegram.",
    images: [{ url: "/og.png", width: 1730, height: 909, alt: "BLISSBL merchandise shop" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BLISSBL — Your BL favourites, one tap away.",
    description: "Shop mascots, photocards and merchandise directly in Telegram.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { themeColor: "#9d2d63" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
