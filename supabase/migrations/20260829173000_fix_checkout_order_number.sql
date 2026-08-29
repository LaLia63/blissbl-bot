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
  select id into v_cart_id
  from public.blissbl_carts
  where customer_id = p_customer_id
  for update;

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
    select 1
    from public.blissbl_cart_items ci
    join public.blissbl_products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
      and (not p.is_available or (p.stock_quantity is not null and p.stock_quantity < ci.quantity))
  ) then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;

  select coalesce(sum(p.price_mmk * ci.quantity), 0)
  into v_subtotal
  from public.blissbl_cart_items ci
  join public.blissbl_products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  select delivery_fee_mmk into v_delivery_fee
  from public.blissbl_app_settings
  where id = true;
  v_delivery_fee := coalesce(v_delivery_fee, 0);

  insert into public.blissbl_orders(customer_id, subtotal_mmk, delivery_fee_mmk, total_mmk, delivery)
  values (p_customer_id, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee, p_delivery)
  returning blissbl_orders.id, blissbl_orders.order_number into v_order_id, v_order_number;

  insert into public.blissbl_order_items(order_id, product_id, product_name, sku, unit_price_mmk, quantity)
  select v_order_id, p.id, p.name, p.sku, p.price_mmk, ci.quantity
  from public.blissbl_cart_items ci
  join public.blissbl_products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  update public.blissbl_products p
  set stock_quantity = p.stock_quantity - ci.quantity
  from public.blissbl_cart_items ci
  where ci.cart_id = v_cart_id
    and ci.product_id = p.id
    and p.stock_quantity is not null;

  insert into public.blissbl_order_status_events(order_id, from_status, to_status, actor_kind, note)
  values (v_order_id, null, 'PENDING_PAYMENT', 'CUSTOMER', 'Order confirmed');

  delete from public.blissbl_cart_items where cart_id = v_cart_id;

  return query select v_order_id, v_order_number, v_subtotal + v_delivery_fee;
end;
$$;

revoke all on function public.blissbl_checkout_cart(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.blissbl_checkout_cart(uuid, jsonb) to service_role;
