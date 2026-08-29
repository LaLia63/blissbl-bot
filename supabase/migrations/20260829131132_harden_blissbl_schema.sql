alter function public.blissbl_set_updated_at() set search_path = public, pg_temp;

create index if not exists blissbl_payments_reviewed_by_admin_idx
  on public.blissbl_payments(reviewed_by_admin_id);
