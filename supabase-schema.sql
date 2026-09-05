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
