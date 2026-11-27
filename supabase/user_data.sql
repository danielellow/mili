-- mili: what people make on the site, saved in Supabase.
--
--   notes           a text note on a release, a mix or a collage, one per person per thing
--   collages        named lists of releases and mixes (like Are.na channels)
--   collage_items   what's in each collage, in order
--
-- These tables are different from the ones in schema.sql. Those are the
-- catalogue: export/load_supabase.py empties and refills them on every load.
-- These are written by people on the website, so the loader never empties
-- them. That's why they don't point to public.objects with a foreign key:
-- emptying objects "cascade" would empty every table that points to it.
-- A mili ID stays the same on every rebuild (it's a hash of where the object
-- came from), so a note or collage keeps pointing to the right release.
--
-- Who can do what (row level security, checked by Postgres on every request):
--   anyone, signed in or not   reads public notes and public collages
--   the owner                  reads, writes and deletes their own, public or private
-- "owner" is the signed-in user (auth.uid()), filled in by Postgres itself.
--
-- Run by export/load_supabase.py after schema.sql. Safe to run again and
-- again: nothing here empties or replaces what's saved.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    about       text not null,              -- a mili ID (release or mix), or "collage:<collage id>"
    body        text not null check (length(body) <= 20000),
    is_public   boolean not null default false,   -- notes start private
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (owner, about)
);
create index if not exists notes_about on public.notes (about);

create table if not exists public.collages (
    id          uuid primary key default gen_random_uuid(),
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name        text not null check (length(trim(name)) between 1 and 80),
    is_public   boolean not null default true,    -- collages start public, like on Are.na
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists collages_owner on public.collages (owner);

create table if not exists public.collage_items (
    collage_id  uuid not null references public.collages (id) on delete cascade,
    object_id   text not null,              -- a mili ID (no foreign key: see the top)
    position    integer not null default 0, -- the order in the collage
    added_at    timestamptz not null default now(),
    primary key (collage_id, object_id)
);
create index if not exists collage_items_object on public.collage_items (object_id);

-- ---------------------------------------------------------------------------
-- updated_at: kept up to date by Postgres. Adding or removing something in a
-- collage counts as changing the collage, so recently changed ones come first.
-- ---------------------------------------------------------------------------

create or replace function public.mili_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
    new.updated_at := now();
    return new;
end
$$;

create or replace function public.mili_touch_collage() returns trigger
language plpgsql set search_path = '' as $$
begin
    update public.collages set updated_at = now()
    where id = coalesce(new.collage_id, old.collage_id);
    return null;
end
$$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
    for each row execute function public.mili_touch();

drop trigger if exists collages_touch on public.collages;
create trigger collages_touch before update on public.collages
    for each row execute function public.mili_touch();

drop trigger if exists collage_items_touch on public.collage_items;
create trigger collage_items_touch after insert or update or delete on public.collage_items
    for each row execute function public.mili_touch_collage();

-- ---------------------------------------------------------------------------
-- Who can do what
-- (select auth.uid()) is written in brackets so Postgres works it out once
-- per request, not once per row.
-- ---------------------------------------------------------------------------

alter table public.notes enable row level security;
alter table public.collages enable row level security;
alter table public.collage_items enable row level security;

-- notes
drop policy if exists "read public notes and your own" on public.notes;
create policy "read public notes and your own" on public.notes
    for select to anon, authenticated
    using (is_public or owner = (select auth.uid()));

drop policy if exists "write your own notes" on public.notes;
create policy "write your own notes" on public.notes
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

-- collages
drop policy if exists "read public collages and your own" on public.collages;
create policy "read public collages and your own" on public.collages
    for select to anon, authenticated
    using (is_public or owner = (select auth.uid()));

drop policy if exists "write your own collages" on public.collages;
create policy "write your own collages" on public.collages
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

-- what's in a collage: readable when the collage is, changeable by its owner
drop policy if exists "read items of collages you can see" on public.collage_items;
create policy "read items of collages you can see" on public.collage_items
    for select to anon, authenticated
    using (exists (
        select 1 from public.collages c
        where c.id = collage_id and (c.is_public or c.owner = (select auth.uid()))
    ));

drop policy if exists "change items in your own collages" on public.collage_items;
create policy "change items in your own collages" on public.collage_items
    for all to authenticated
    using (exists (
        select 1 from public.collages c
        where c.id = collage_id and c.owner = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.collages c
        where c.id = collage_id and c.owner = (select auth.uid())
    ));

-- Supabase doesn't hand out access to new tables by itself in this project, so
-- it's given here: reading to everyone, writing to signed-in people. The
-- policies above still decide which rows.
revoke all on public.notes, public.collages, public.collage_items from anon, authenticated;
grant select on public.notes, public.collages, public.collage_items to anon;
grant select, insert, update, delete on public.notes, public.collages, public.collage_items to authenticated;
