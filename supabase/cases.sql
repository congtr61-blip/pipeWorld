create table if not exists public.project_cases (
  id uuid primary key default gen_random_uuid(),
  title_en text not null,
  title_zh text not null,
  location_en text not null,
  location_zh text not null,
  category_en text not null,
  category_zh text not null,
  summary_en text not null,
  summary_zh text not null,
  details_en text not null,
  details_zh text not null,
  cover_url text not null default '',
  cover_path text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_cases enable row level security;
revoke all on public.project_cases from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pipeworld-cases',
  'pipeworld-cases',
  true,
  2621440,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pipeworld_case_images_public_read on storage.objects;
create policy pipeworld_case_images_public_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'pipeworld-cases');
