-- Family Tree shared storage schema for Supabase.
-- Run this once in the Supabase dashboard: Project > SQL Editor > New query.

create table if not exists family_tree (
  id text primary key,
  data jsonb not null default '{"people": {}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table family_tree enable row level security;

-- Open access model: anyone who loads the page (i.e. anyone holding the
-- anon key, which is public in this app's client code) can read and write
-- the tree. This matches "share one link with the family" usage. If you
-- later add login, replace these with policies scoped to auth.uid().
drop policy if exists "Allow public read" on family_tree;
create policy "Allow public read" on family_tree
  for select using (true);

drop policy if exists "Allow public insert" on family_tree;
create policy "Allow public insert" on family_tree
  for insert with check (true);

drop policy if exists "Allow public update" on family_tree;
create policy "Allow public update" on family_tree
  for update using (true) with check (true);

-- Enable realtime so every open browser tab sees edits from others live.
alter publication supabase_realtime add table family_tree;

-- Photo storage: photos are uploaded here instead of being embedded as
-- base64 directly in family_tree.data, which used to mean every single
-- save re-uploaded every photo in the whole tree along with it. Public
-- (readable by anyone with the link, no signed URLs) and open-write, same
-- access model as the table above.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "Allow public photo read" on storage.objects;
create policy "Allow public photo read" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "Allow public photo insert" on storage.objects;
create policy "Allow public photo insert" on storage.objects
  for insert with check (bucket_id = 'photos');

drop policy if exists "Allow public photo update" on storage.objects;
create policy "Allow public photo update" on storage.objects
  for update using (bucket_id = 'photos') with check (bucket_id = 'photos');

drop policy if exists "Allow public photo delete" on storage.objects;
create policy "Allow public photo delete" on storage.objects
  for delete using (bucket_id = 'photos');
