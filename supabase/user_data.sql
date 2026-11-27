-- mili: what people make on the site, saved in Supabase.
--
--   notes           text notes on a release, a mix, a collage, or an item in a
--                   collage; as many as you like on each
--   collages        named lists of releases and mixes (like Are.na channels),
--                   with a cover of their own if you choose one
--   collage_items   what's in each collage, in order
--   gardens         each person's garden (plants and ground marks), one per person
--   rotation        what each person has on rotation (shown in the top bar)
--   library_changes what each person queued, collected or took out of the library
--   covers          (a Storage bucket) images uploaded as collage covers
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
    id          uuid primary key default gen_random_uuid(),
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    about       text not null,              -- what it's on: a mili ID (release or mix),
                                            -- "collage:<collage id>", or for an item in a
                                            -- collage "collage:<collage id>:<mili ID>"
    body        text not null check (length(body) <= 20000),
    is_public   boolean not null default false,   -- notes start private
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Notes used to be one per person per thing, keyed by (owner, about). Now each
-- note has an id of its own, so a thing can have several. This turns an
-- older table into the new shape, keeping every note (it does nothing after that).
alter table public.notes add column if not exists id uuid not null default gen_random_uuid();
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.notes'::regclass and contype = 'p'
          and pg_get_constraintdef(oid) = 'PRIMARY KEY (owner, about)'
    ) then
        alter table public.notes drop constraint notes_pkey;
        alter table public.notes add primary key (id);
    end if;
end
$$;
create index if not exists notes_about on public.notes (about);
create index if not exists notes_owner on public.notes (owner, updated_at desc);

create table if not exists public.collages (
    id          uuid primary key default gen_random_uuid(),
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name        text not null check (length(trim(name)) between 1 and 80),
    is_public   boolean not null default true,    -- collages start public, like on Are.na
    cover       text check (length(cover) <= 500), -- "object:<mili ID>" (an item's art),
                                                  -- or the address of an uploaded image
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists collages_owner on public.collages (owner);
alter table public.collages add column if not exists cover text check (length(cover) <= 500);

create table if not exists public.collage_items (
    collage_id  uuid not null references public.collages (id) on delete cascade,
    object_id   text not null,              -- a mili ID (no foreign key: see the top)
    position    integer not null default 0, -- the order in the collage
    added_at    timestamptz not null default now(),
    primary key (collage_id, object_id)
);
create index if not exists collage_items_object on public.collage_items (object_id);

-- Each person's garden: where their plants are, what species and colours
-- they chose, and the ground marks. Kept as one JSON document, the way the
-- garden page uses it, and only readable by its owner.
create table if not exists public.gardens (
    owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    garden      jsonb not null default '{"plants": {}, "marks": []}'::jsonb
                check (octet_length(garden::text) <= 2000000),
    updated_at  timestamptz not null default now()
);

-- On rotation: releases and mixes you've pinned, to have them close at hand.
create table if not exists public.rotation (
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    object_id   text not null,              -- a mili ID (no foreign key: see the top)
    added_at    timestamptz not null default now(),
    primary key (owner, object_id)
);

-- The library: the queue and collect icons on a release page. What each
-- person sees is the library from the pipeline (public.library) with their
-- own changes on top: "queue" or "collection" puts something there (or moves
-- it), "removed" takes something out of the pipeline's library for them.
create table if not exists public.library_changes (
    owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    object_id   text not null,              -- a mili ID (no foreign key: see the top)
    status      text not null check (status in ('queue', 'collection', 'removed')),
    changed_at  timestamptz not null default now(),
    primary key (owner, object_id)
);

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

drop trigger if exists gardens_touch on public.gardens;
create trigger gardens_touch before update on public.gardens
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
alter table public.gardens enable row level security;
alter table public.rotation enable row level security;
alter table public.library_changes enable row level security;

-- library changes: yours only
drop policy if exists "your own library changes" on public.library_changes;
create policy "your own library changes" on public.library_changes
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

-- rotation: yours only
drop policy if exists "your own rotation" on public.rotation;
create policy "your own rotation" on public.rotation
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

-- gardens: yours only
drop policy if exists "your own garden" on public.gardens;
create policy "your own garden" on public.gardens
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

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
revoke all on public.notes, public.collages, public.collage_items, public.gardens, public.rotation, public.library_changes from anon, authenticated;
grant select, insert, update, delete on public.gardens, public.library_changes to authenticated;
grant select, insert, delete on public.rotation to authenticated;
grant select on public.notes, public.collages, public.collage_items to anon;
grant select, insert, update, delete on public.notes, public.collages, public.collage_items to authenticated;

-- ---------------------------------------------------------------------------
-- Uploaded covers: a public Storage bucket called "covers". Anyone can look at
-- the images (they're collage covers); signed-in people can only upload into
-- a folder named after themselves (covers/<their user id>/…), and only images
-- up to 2 MB. If this can't be set up from here, the loader says so: then make
-- the bucket by hand (Storage → New bucket → "covers", public) and run the
-- loader again for the rules.
-- ---------------------------------------------------------------------------

do $$
begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('covers', 'covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    drop policy if exists "upload covers into your own folder" on storage.objects;
    create policy "upload covers into your own folder" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

    drop policy if exists "delete your own covers" on storage.objects;
    create policy "delete your own covers" on storage.objects
        for delete to authenticated
        using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when others then
    raise warning 'mili: the "covers" bucket for uploaded collage covers could not be set up from here (%). '
                  'Make it in the dashboard (Storage → New bucket → covers, public), then run the loader again.', sqlerrm;
end
$$;
