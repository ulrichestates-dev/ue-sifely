create table if not exists public.sifely_passcode_records (
  reservation_id       text primary key,
  hostaway_listing_id  bigint,
  guest_name           text,
  guest_label          text,
  platform             text,
  check_in             date,
  check_out            date,
  status               text not null default 'active',
  record               jsonb not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  failed_at            timestamptz
);

create index if not exists idx_sifely_records_status  on public.sifely_passcode_records(status);
create index if not exists idx_sifely_records_listing on public.sifely_passcode_records(hostaway_listing_id);

alter table public.sifely_passcode_records enable row level security;

create policy "service_role_all" on public.sifely_passcode_records
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
