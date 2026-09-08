-- Run once against the Neon database.
create table if not exists app_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Handy when something looks wrong:
--   select key, length(value) as bytes, updated_at from app_state;
