create extension if not exists pgcrypto;

create sequence if not exists public.blissbl_order_number_seq start with 10001;

create table public.blissbl_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  emoji text not null default '✨',
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blissbl_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.blissbl_categories(id),
  sku text unique,
  name text not null,
  description text not null default '',
  price_mmk bigint not null check (price_mmk >= 0),
  image_path text,
  image_url text,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  is_available boolean not null default true,
  is_new boolean not null default false,
  is_best_seller boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blissbl_customers (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_username text,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.blissbl_delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.blissbl_customers(id) on delete cascade,
  recipient_name text not null,
  phone text not null,
  address_line text not null,
  township text not null,
  city text not null,
  delivery_note text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index blissbl_one_default_address_per_customer
  on public.blissbl_delivery_addresses(customer_id) where is_default;

create table public.blissbl_carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.blissbl_customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blissbl_cart_items (
  cart_id uuid not null references public.blissbl_carts(id) on delete cascade,
  product_id uuid not null references public.blissbl_products(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create table public.blissbl_admins (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  display_name text not null,
  role text not null default 'ADMIN' check (role in ('OWNER', 'ADMIN')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blissbl_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('BLB-' || nextval('public.blissbl_order_number_seq')),
  customer_id uuid not null references public.blissbl_customers(id),
  status text not null default 'PENDING_PAYMENT' check (status in (
    'PENDING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_APPROVED', 'CONFIRMED',
    'PROCESSING', 'SHIPPED', 'DELIVERED', 'PAYMENT_DECLINED', 'CANCELLED'
  )),
  subtotal_mmk bigint not null check (subtotal_mmk >= 0),
  delivery_fee_mmk bigint not null default 0 check (delivery_fee_mmk >= 0),
  total_mmk bigint not null check (total_mmk >= 0),
  delivery jsonb not null check (jsonb_typeof(delivery) = 'object'),
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_reason text
);

create table public.blissbl_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.blissbl_orders(id) on delete cascade,
  product_id uuid references public.blissbl_products(id) on delete set null,
  product_name text not null,
  sku text,
  unit_price_mmk bigint not null check (unit_price_mmk >= 0),
  quantity integer not null check (quantity > 0),
  line_total_mmk bigint generated always as (unit_price_mmk * quantity) stored
);

create table public.blissbl_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.blissbl_orders(id) on delete cascade,
  attempt_no integer not null default 1 check (attempt_no > 0),
  telegram_file_unique_id text,
  slip_object_path text not null,
  amount_mmk bigint not null check (amount_mmk >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED')),
  decline_reason text,
  reviewed_by_admin_id uuid references public.blissbl_admins(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_no),
  unique (order_id, telegram_file_unique_id),
  check ((status <> 'DECLINED') or nullif(trim(decline_reason), '') is not null)
);

create unique index blissbl_one_approved_payment_per_order
  on public.blissbl_payments(order_id) where status = 'APPROVED';

create table public.blissbl_order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.blissbl_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_kind text not null check (actor_kind in ('CUSTOMER', 'ADMIN', 'SYSTEM')),
  actor_telegram_user_id bigint,
  note text,
  created_at timestamptz not null default now()
);

create table public.blissbl_bot_sessions (
  telegram_user_id bigint primary key,
  state text not null default 'IDLE',
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  updated_at timestamptz not null default now()
);

create table public.blissbl_telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'FAILED')),
  error_code text
);

create table public.blissbl_app_settings (
  id boolean primary key default true check (id),
  support_text text not null default 'BLISSBL Support',
  delivery_fee_mmk bigint not null default 3000 check (delivery_fee_mmk >= 0),
  kpay_qr_path text not null default 'kpay-qr.jpg',
  updated_at timestamptz not null default now()
);

create index blissbl_products_category_available_idx on public.blissbl_products(category_id, is_available, created_at desc);
create index blissbl_products_available_idx on public.blissbl_products(created_at desc) where is_available;
create index blissbl_addresses_customer_idx on public.blissbl_delivery_addresses(customer_id, created_at desc);
create index blissbl_cart_items_product_idx on public.blissbl_cart_items(product_id);
create index blissbl_orders_customer_recent_idx on public.blissbl_orders(customer_id, placed_at desc, id desc);
create index blissbl_orders_status_recent_idx on public.blissbl_orders(status, placed_at desc);
create index blissbl_order_items_order_idx on public.blissbl_order_items(order_id);
create index blissbl_order_items_product_idx on public.blissbl_order_items(product_id);
create index blissbl_payments_order_idx on public.blissbl_payments(order_id, created_at desc);
create index blissbl_pending_payments_idx on public.blissbl_payments(created_at) where status = 'PENDING';
create index blissbl_order_status_events_order_idx on public.blissbl_order_status_events(order_id, created_at);
create index blissbl_bot_sessions_expiry_idx on public.blissbl_bot_sessions(expires_at);
create index blissbl_telegram_updates_received_idx on public.blissbl_telegram_updates(received_at);

create or replace function public.blissbl_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger categories_updated_at before update on public.blissbl_categories for each row execute function public.blissbl_set_updated_at();
create trigger products_updated_at before update on public.blissbl_products for each row execute function public.blissbl_set_updated_at();
create trigger customers_updated_at before update on public.blissbl_customers for each row execute function public.blissbl_set_updated_at();
create trigger addresses_updated_at before update on public.blissbl_delivery_addresses for each row execute function public.blissbl_set_updated_at();
create trigger carts_updated_at before update on public.blissbl_carts for each row execute function public.blissbl_set_updated_at();
create trigger cart_items_updated_at before update on public.blissbl_cart_items for each row execute function public.blissbl_set_updated_at();
create trigger admins_updated_at before update on public.blissbl_admins for each row execute function public.blissbl_set_updated_at();
create trigger orders_updated_at before update on public.blissbl_orders for each row execute function public.blissbl_set_updated_at();
create trigger payments_updated_at before update on public.blissbl_payments for each row execute function public.blissbl_set_updated_at();

create or replace function public.blissbl_checkout_cart(p_customer_id uuid, p_delivery jsonb)
returns table(order_id uuid, order_number text, total_mmk bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cart_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal bigint;
  v_delivery_fee bigint;
begin
  select id into v_cart_id from public.blissbl_carts where customer_id = p_customer_id for update;
  if v_cart_id is null or not exists (select 1 from public.blissbl_cart_items where cart_id = v_cart_id) then
    raise exception 'CART_EMPTY';
  end if;

  perform 1
  from public.blissbl_products p
  join public.blissbl_cart_items ci on ci.product_id = p.id
  where ci.cart_id = v_cart_id
  order by p.id
  for update of p;

  if exists (
    select 1 from public.blissbl_cart_items ci
    join public.blissbl_products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
      and (not p.is_available or (p.stock_quantity is not null and p.stock_quantity < ci.quantity))
  ) then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;

  select coalesce(sum(p.price_mmk * ci.quantity), 0)
  into v_subtotal
  from public.blissbl_cart_items ci join public.blissbl_products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  select delivery_fee_mmk into v_delivery_fee from public.blissbl_app_settings where id = true;
  v_delivery_fee := coalesce(v_delivery_fee, 0);

  insert into public.blissbl_orders(customer_id, subtotal_mmk, delivery_fee_mmk, total_mmk, delivery)
  values (p_customer_id, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee, p_delivery)
  returning id, orders.order_number into v_order_id, v_order_number;

  insert into public.blissbl_order_items(order_id, product_id, product_name, sku, unit_price_mmk, quantity)
  select v_order_id, p.id, p.name, p.sku, p.price_mmk, ci.quantity
  from public.blissbl_cart_items ci join public.blissbl_products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  update public.blissbl_products p
  set stock_quantity = p.stock_quantity - ci.quantity
  from public.blissbl_cart_items ci
  where ci.cart_id = v_cart_id and ci.product_id = p.id and p.stock_quantity is not null;

  insert into public.blissbl_order_status_events(order_id, from_status, to_status, actor_kind, note)
  values (v_order_id, null, 'PENDING_PAYMENT', 'CUSTOMER', 'Order confirmed');

  delete from public.blissbl_cart_items where cart_id = v_cart_id;

  return query select v_order_id, v_order_number, v_subtotal + v_delivery_fee;
end;
$$;

create or replace function public.blissbl_review_payment(
  p_payment_id uuid,
  p_approved boolean,
  p_admin_telegram_id bigint,
  p_reason text default null
)
returns table(order_id uuid, customer_telegram_user_id bigint, order_number text, total_mmk bigint, result_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_order_id uuid;
  v_old_order_status text;
begin
  select id into v_admin_id from public.blissbl_admins
  where telegram_user_id = p_admin_telegram_id and is_active = true;
  if v_admin_id is null then raise exception 'ADMIN_REQUIRED'; end if;

  select p.order_id, o.status into v_order_id, v_old_order_status
  from public.blissbl_payments p join public.blissbl_orders o on o.id = p.order_id
  where p.id = p_payment_id and p.status = 'PENDING'
  for update of p, o;
  if v_order_id is null then raise exception 'PAYMENT_NOT_PENDING'; end if;

  if p_approved then
    update public.blissbl_payments set status = 'APPROVED', reviewed_by_admin_id = v_admin_id, reviewed_at = now()
    where id = p_payment_id;
    update public.blissbl_orders set status = 'CONFIRMED' where id = v_order_id;
    insert into public.blissbl_order_status_events(order_id, from_status, to_status, actor_kind, actor_telegram_user_id, note)
    values (v_order_id, v_old_order_status, 'PAYMENT_APPROVED', 'ADMIN', p_admin_telegram_id, 'Payment approved'),
           (v_order_id, 'PAYMENT_APPROVED', 'CONFIRMED', 'SYSTEM', null, 'Order confirmed');
  else
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'DECLINE_REASON_REQUIRED'; end if;
    update public.blissbl_payments set status = 'DECLINED', decline_reason = p_reason, reviewed_by_admin_id = v_admin_id, reviewed_at = now()
    where id = p_payment_id;
    update public.blissbl_orders set status = 'PAYMENT_DECLINED' where id = v_order_id;
    insert into public.blissbl_order_status_events(order_id, from_status, to_status, actor_kind, actor_telegram_user_id, note)
    values (v_order_id, v_old_order_status, 'PAYMENT_DECLINED', 'ADMIN', p_admin_telegram_id, p_reason);
  end if;

  return query
  select o.id, c.telegram_user_id, o.order_number, o.total_mmk, o.status
  from public.blissbl_orders o join public.blissbl_customers c on c.id = o.customer_id where o.id = v_order_id;
end;
$$;

revoke all on function public.blissbl_checkout_cart(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.blissbl_review_payment(uuid, boolean, bigint, text) from public, anon, authenticated;
grant execute on function public.blissbl_checkout_cart(uuid, jsonb) to service_role;
grant execute on function public.blissbl_review_payment(uuid, boolean, bigint, text) to service_role;

alter table public.blissbl_categories enable row level security;
alter table public.blissbl_products enable row level security;
alter table public.blissbl_customers enable row level security;
alter table public.blissbl_delivery_addresses enable row level security;
alter table public.blissbl_carts enable row level security;
alter table public.blissbl_cart_items enable row level security;
alter table public.blissbl_admins enable row level security;
alter table public.blissbl_orders enable row level security;
alter table public.blissbl_order_items enable row level security;
alter table public.blissbl_payments enable row level security;
alter table public.blissbl_order_status_events enable row level security;
alter table public.blissbl_bot_sessions enable row level security;
alter table public.blissbl_telegram_updates enable row level security;
alter table public.blissbl_app_settings enable row level security;

revoke all on table
  public.blissbl_categories,
  public.blissbl_products,
  public.blissbl_customers,
  public.blissbl_delivery_addresses,
  public.blissbl_carts,
  public.blissbl_cart_items,
  public.blissbl_admins,
  public.blissbl_orders,
  public.blissbl_order_items,
  public.blissbl_payments,
  public.blissbl_order_status_events,
  public.blissbl_bot_sessions,
  public.blissbl_telegram_updates,
  public.blissbl_app_settings
from anon, authenticated;

grant select, insert, update, delete on table
  public.blissbl_categories,
  public.blissbl_products,
  public.blissbl_customers,
  public.blissbl_delivery_addresses,
  public.blissbl_carts,
  public.blissbl_cart_items,
  public.blissbl_admins,
  public.blissbl_orders,
  public.blissbl_order_items,
  public.blissbl_payments,
  public.blissbl_order_status_events,
  public.blissbl_bot_sessions,
  public.blissbl_telegram_updates,
  public.blissbl_app_settings
to service_role;

revoke all on sequence public.blissbl_order_number_seq, public.blissbl_order_status_events_id_seq from anon, authenticated;
grant usage, select on sequence public.blissbl_order_number_seq, public.blissbl_order_status_events_id_seq to service_role;

insert into public.blissbl_app_settings(id) values (true) on conflict (id) do nothing;
