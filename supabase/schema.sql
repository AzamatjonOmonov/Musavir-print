-- Musavvir Print do'koni uchun baza.
-- Supabase → SQL Editor → shu faylni to'liq joylab "Run" bosing (bir marta).

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null default '',
  description text not null default '',
  price       integer not null default 0,        -- asosiy narx (so'm)
  old_price   integer,                            -- chegirmadan oldingi narx (ixtiyoriy)
  images      jsonb not null default '[]'::jsonb, -- rasm havolalari, birinchisi muqova
  variants    jsonb not null default '[]'::jsonb, -- [{ "name": "100 talik", "price": 120000 }]
  addons      jsonb not null default '[]'::jsonb, -- [{ "name": "Laminatsiya", "price": 15000 }]
  is_bundle   boolean not null default false,     -- tayyor to'plam
  print_qty   integer not null default 0,         -- to'plam ichidagi 10x15 rasm soni (bepul yetkazish uchun)
  active      boolean not null default true,      -- sotuvda bor / yo'q
  sort        integer not null default 0,         -- tartib (kichigi oldinda)
  created_at  timestamptz not null default now()
);

create table if not exists orders (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  phone       text not null,
  address     text not null default '',
  lat         double precision,
  lon         double precision,
  items       jsonb not null default '[]'::jsonb,
  total       integer not null default 0,
  free_delivery boolean not null default false,
  source      text not null default '',
  status      text not null default 'yangi'       -- yangi / ishlanmoqda / yuborildi / bekor
);

-- Admin panelga kirish urinishlari (parol taxmin qilishdan himoya)
create table if not exists admin_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  ip          text not null default '',
  kind        text not null,               -- fail / code_sent / code_fail / code_used / login
  ref         text not null default ''
);
create index if not exists admin_events_lookup on admin_events (kind, created_at);

-- Jadvallarga faqat sayt serveri (secret key) kira oladi.
alter table products     enable row level security;
alter table orders       enable row level security;
alter table admin_events enable row level security;

-- Tovar rasmlari uchun ochiq papka
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;
