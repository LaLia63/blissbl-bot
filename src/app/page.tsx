import Image from "next/image";
import { ArrowRight, CheckCircle2, CreditCard, PackageCheck, Send, ShoppingBag, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const products = [
  { name: "Avocean Mascot", price: "28,000 MMK", image: "/assets/mascot-avocasian.jpg", tag: "Best seller" },
  { name: "Ceri Mascot", price: "28,000 MMK", image: "/assets/mascot-ceri.jpg", tag: "New" },
  { name: "Babii Mascot", price: "30,000 MMK", image: "/assets/mascot-papii.jpg", tag: "Fan favourite" },
  { name: "Permpoon Mascot", price: "32,000 MMK", image: "/assets/mascot-permpoon.jpg", tag: "Limited" },
  { name: "JoongDunk Photocard Set", price: "18,000 MMK", image: "/assets/photocard-joongdunk.jpg", tag: "Popular" },
  { name: "Pond Naravit Photocard", price: "12,000 MMK", image: "/assets/photocard-pond-naravit.jpg", tag: "New" },
  { name: "BLISSBL Merchandise Set", price: "38,000 MMK", image: "/assets/merchandise.jpg", tag: "Bundle" },
  { name: "BLISSBL Keychain", price: "15,000 MMK", image: "/assets/keychain.jpg", tag: "Everyday" },
];

export default function Home() {
  const telegramUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^\uFEFF/, "").trim() || "blissbl_bot";
  const botUrl = `https://t.me/${telegramUsername}`;
  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Image
            src="/assets/logo.jpg"
            alt="BLISSBL logo"
            width={48}
            height={48}
            className="size-11 rounded-full border-2 border-white object-cover shadow-sm"
            priority
          />
          <div>
            <p className="font-heading text-lg font-black tracking-[-0.03em]">BLISSBL</p>
            <p className="text-xs font-medium text-muted-foreground">Official merchandise shop</p>
          </div>
        </div>
        <Button render={<a href={botUrl} target="_blank" rel="noreferrer" />} className="rounded-full px-5 shadow-lg shadow-primary/20">
            Open Telegram <ArrowRight className="size-4" />
        </Button>
      </header>

      <section className="mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:py-20">
        <div className="relative z-10">
          <Badge className="mb-6 rounded-full bg-primary/10 px-3 py-1 text-primary hover:bg-primary/10">
            <Sparkles className="mr-1 size-3.5" /> New collection is here
          </Badge>
          <h1 className="max-w-2xl font-heading text-5xl font-black leading-[.96] tracking-[-0.055em] text-balance sm:text-7xl">
            Your BL favourites, one tap away.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Mascots, photocards and little pieces of joy—discover, order and track everything directly in Telegram.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button render={<a href={botUrl} target="_blank" rel="noreferrer" />} size="lg" className="h-12 rounded-full px-7 text-base shadow-xl shadow-primary/20">
                <Send className="size-5" /> Start shopping in Telegram
            </Button>
            <p className="flex items-center justify-center rounded-full px-5 text-sm font-semibold text-muted-foreground">
              Fast checkout · KPay · Order tracking
            </p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_top_left,var(--blush),transparent_62%)] blur-2xl" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2.5rem] border-8 border-white shadow-2xl shadow-primary/15">
            <Image
              src="/assets/welcome.jpg"
              alt="BLISSBL merchandise collection"
              fill
              sizes="(max-width: 1024px) 90vw, 42vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-x-5 bottom-5 rounded-3xl border border-white/50 bg-white/88 p-4 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold">Made for every fan moment</p>
                  <p className="mt-1 text-xs text-muted-foreground">Authentic picks, thoughtfully packed.</p>
                </div>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">♡</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="catalog" className="border-t border-border/60 bg-card/60 px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-7xl py-6 sm:py-10">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.18em] text-primary">Popular picks</p>
              <h2 className="mt-2 font-heading text-3xl font-black tracking-tight sm:text-5xl">Find your next favourite.</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {['🧸 Mascots', '💌 Photocards', '✨ Merchandise'].map((label) => (
                <span key={label} className="rounded-full border bg-white px-4 py-2 shadow-sm">{label}</span>
              ))}
            </div>
          </div>

          <div className="mt-9 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
            {products.map((product) => (
              <Card key={product.name} className="group overflow-hidden border-white/80 bg-white p-0 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-cover transition duration-500 group-hover:scale-105"
                  />
                  <Badge className="absolute left-3 top-3 rounded-full bg-white/90 text-foreground shadow-sm backdrop-blur hover:bg-white/90">{product.tag}</Badge>
                </div>
                <CardContent className="p-4 sm:p-5">
                  <h3 className="min-h-10 text-sm font-bold leading-5 sm:text-base">{product.name}</h3>
                  <p className="mt-2 text-sm font-black text-primary">{product.price}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-9 flex justify-center">
            <Button render={<a href={botUrl} target="_blank" rel="noreferrer" />} size="lg" className="h-12 rounded-full px-8">
              <ShoppingBag className="size-5" /> View all products in Telegram
            </Button>
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-8 overflow-hidden rounded-[2.5rem] bg-[#3d1830] p-5 text-white shadow-2xl shadow-primary/15 sm:p-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div className="p-3 sm:p-6 lg:p-10">
            <Badge className="bg-white/10 text-white hover:bg-white/10">BLISSBL story</Badge>
            <h2 className="mt-5 max-w-xl font-heading text-4xl font-black leading-[1.02] tracking-[-0.04em] sm:text-5xl">The whole shop lives inside one friendly chat.</h2>
            <p className="mt-5 max-w-lg leading-7 text-white/70">Browse by collection, edit your cart, enter delivery details, pay with KPay and follow every status update without leaving Telegram.</p>
            <Button render={<a href={botUrl} target="_blank" rel="noreferrer" />} variant="secondary" size="lg" className="mt-7 rounded-full px-7">
              Chat with @{telegramUsername} <ArrowRight className="size-4" />
            </Button>
          </div>
          <div className="relative aspect-[1.9/1] overflow-hidden rounded-[2rem] border border-white/15">
            <Image src="/og.png" alt="BLISSBL AI-generated merchandise artwork" fill sizes="(max-width: 1024px) 90vw, 45vw" className="object-cover" />
          </div>
        </div>
      </section>

      <section className="border-y bg-white px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[.18em] text-primary">Simple from start to finish</p>
            <h2 className="mt-2 font-heading text-3xl font-black tracking-tight sm:text-4xl">Order in three easy steps.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: ShoppingBag, title: 'Pick your favourites', copy: 'Browse categories and adjust quantities in your Telegram cart.' },
              { icon: CreditCard, title: 'Pay securely with KPay', copy: 'Scan the QR and upload your payment slip in the same chat.' },
              { icon: PackageCheck, title: 'Track every update', copy: 'Get notified when payment is approved and your order moves.' },
            ].map((step, index) => (
              <Card key={step.title} className="border-border/70 bg-background/50 shadow-none">
                <CardContent className="p-6 sm:p-8">
                  <div className="flex items-center justify-between">
                    <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><step.icon className="size-5" /></span>
                    <span className="text-sm font-black text-primary/40">0{index + 1}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-black">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-9 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-bold text-muted-foreground">
            {['Private payment slips', 'Human-readable order IDs', 'Admin-reviewed payments', 'Fast product images'].map((item) => (
              <span key={item} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" />{item}</span>
            ))}
          </div>
        </div>
      </section>

      <footer className="px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <Image src="/assets/logo.jpg" alt="BLISSBL" width={40} height={40} className="size-10 rounded-full object-cover" />
            <div><p className="font-black">BLISSBL</p><p className="text-xs text-muted-foreground">Little things, big fan moments.</p></div>
          </div>
          <a href={botUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-primary hover:underline">Open @{telegramUsername} on Telegram →</a>
        </div>
      </footer>
    </main>
  );
}
