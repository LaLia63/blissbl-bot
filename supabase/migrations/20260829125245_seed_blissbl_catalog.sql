insert into public.blissbl_categories(slug, name, emoji, description, sort_order)
values
  ('mascots', 'Mascots', '🧸', 'Soft companions inspired by your favourite fan moments.', 10),
  ('photocards', 'Photocards', '💌', 'Collectible photo cards for every collection.', 20),
  ('merchandise', 'Merchandise', '✨', 'Everyday fan essentials and limited picks.', 30),
  ('new-arrivals', 'New Arrivals', '🌷', 'Freshly added to the BLISSBL shelf.', 40),
  ('best-sellers', 'Best Sellers', '💗', 'Most-loved picks from the community.', 50)
on conflict (slug) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.blissbl_products(category_id, sku, name, description, price_mmk, image_path, stock_quantity, is_available, is_new, is_best_seller)
values
  ((select id from public.blissbl_categories where slug = 'mascots'), 'BLB-MAS-001', 'Avocean Mascot', 'A soft collectible mascot with a playful avocado-inspired look.', 28000, 'mascot-avocasian.jpg', 20, true, false, true),
  ((select id from public.blissbl_categories where slug = 'mascots'), 'BLB-MAS-002', 'Ceri Mascot', 'A sweet cherry-toned mascot made for shelf styling and cosy photos.', 28000, 'mascot-ceri.jpg', 20, true, true, false),
  ((select id from public.blissbl_categories where slug = 'mascots'), 'BLB-MAS-003', 'Domiia Mascot', 'A charming pocket-sized companion from the BLISSBL mascot collection.', 28000, 'mascot-domia.jpg', 20, true, false, false),
  ((select id from public.blissbl_categories where slug = 'mascots'), 'BLB-MAS-004', 'Babii Mascot', 'A cuddly fan favourite with an expressive, lovable design.', 30000, 'mascot-papii.jpg', 15, true, false, true),
  ((select id from public.blissbl_categories where slug = 'mascots'), 'BLB-MAS-005', 'Permpoon Mascot', 'Limited mascot edition for a cheerful collection highlight.', 32000, 'mascot-permpoon.jpg', 10, true, true, false),
  ((select id from public.blissbl_categories where slug = 'photocards'), 'BLB-PHO-001', 'JoongDunk Photocard Set', 'A curated photocard set in a protective collectible sleeve.', 18000, 'photocard-joongdunk.jpg', 30, true, false, true),
  ((select id from public.blissbl_categories where slug = 'photocards'), 'BLB-PHO-002', 'Pond Naravit Photocard', 'Premium printed photocard for your binder or display.', 12000, 'photocard-pond-naravit.jpg', 35, true, true, false),
  ((select id from public.blissbl_categories where slug = 'photocards'), 'BLB-PHO-003', 'PondPhuwin Photocard Set', 'A matching pair of collectible photocards with crisp print detail.', 20000, 'photocard-pond-phuwin.jpg', 25, true, false, true),
  ((select id from public.blissbl_categories where slug = 'merchandise'), 'BLB-MER-001', 'BLISSBL Merchandise Set', 'A coordinated fan merchandise bundle, ready for gifting.', 38000, 'merchandise.jpg', 12, true, true, false),
  ((select id from public.blissbl_categories where slug = 'merchandise'), 'BLB-KEY-001', 'BLISSBL Keychain', 'A lightweight collectible keychain for bags, keys and display.', 15000, 'keychain.jpg', 40, true, false, true)
on conflict (sku) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price_mmk = excluded.price_mmk,
  image_path = excluded.image_path,
  stock_quantity = excluded.stock_quantity,
  is_available = excluded.is_available,
  is_new = excluded.is_new,
  is_best_seller = excluded.is_best_seller;
