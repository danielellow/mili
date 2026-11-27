// mili: signing in, and the notes and collages people make on the site.
//
// They're saved in Supabase (supabase/user_data.sql), next to the catalogue.
// Anyone can read public notes and collages; writing needs a sign-in, and
// Postgres itself checks that people only change their own (row level security).
//
// Signing in uses Supabase Auth with an email and a password. Accounts are
// made in the Supabase dashboard (Authentication → Users → Add user); the
// website has no sign-up form.
//
// "try the beta" signs in as a guest instead: Supabase's anonymous sign-in
// makes a new account for that browser, with no email or password, so each
// friend who tries mili gets a space of their own. It needs "Allow anonymous
// sign-ins" (and "Allow new users to sign up") on in the dashboard.
//
// The session (a short-lived access token and a refresh token) is kept in
// this browser's localStorage under "mili.session", and renewed when it's
// about to run out. Nothing here is secret in the website's code: the
// publishable key only lets Postgres's rules decide.

import { data, applyLibraryChanges } from "./data.js";

const SESSION_KEY = "mili.session";

let session = readSession();
const listeners = new Set();

export const userData = {
  collages: [],          // public ones and your own: {id, owner, name, is_public, updated_at, items: [object_id …]}
  rotation: [],          // what you have on rotation: mili IDs, newest first
  library: new Map(),    // what you've queued, collected or taken out: mili ID -> {status, changed_at}
  loaded: false,
  error: null,
};

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function keepSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage off: the sign-in lasts until the page is closed */ }
}

// Tell whoever is listening that something changed: "session" (signed in or
// out: app.js draws the page again), "collages" (pages update their own parts)
// "rotation" (the top bar redraws its covers) or "library" (queued or collected)
export function onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function changed(kind) { for (const listener of listeners) listener(kind); }

// Is saving possible at all? (no supabase.json: the site only reads files)
export const canSave = () => Boolean(data.supabase);

// The signed-in person, or null. guest: signed in with "try the beta".
export function me() {
  return session ? { id: session.user?.id, email: session.user?.email || null, guest: Boolean(session.user?.guest) } : null;
}

async function authCall(path, body) {
  const { url, key } = data.supabase;
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(answer.error_description || answer.msg || answer.message || answer.error || `answered ${response.status}`);
  }
  return answer;
}

function sessionFrom(answer) {
  return {
    access_token: answer.access_token,
    refresh_token: answer.refresh_token,
    expires_at: answer.expires_at || Math.floor(Date.now() / 1000) + (answer.expires_in || 3600),
    user: { id: answer.user?.id, email: answer.user?.email, guest: Boolean(answer.user?.is_anonymous) },
  };
}

export async function signIn(email, password) {
  if (!canSave()) throw new Error("live data isn't set up (no supabase.json)");
  const answer = await authCall("token?grant_type=password", { email: email.trim(), password });
  keepSession(sessionFrom(answer));
  await loadCollages();
  changed("session");
}

// "try the beta": a guest account for this browser
export async function signInAsGuest() {
  if (!canSave()) throw new Error("live data isn't set up (no supabase.json)");
  try {
    keepSession(sessionFrom(await authCall("signup", { data: {} })));
  } catch (error) {
    if (/signups not allowed|anonymous sign-ins are disabled/i.test(error.message)) {
      throw new Error("the beta isn't open right now");
    }
    throw error;
  }
  await loadCollages();
  changed("session");
}

export async function signOut() {
  if (session) {
    const { url, key } = data.supabase;
    // tell Supabase too; if it doesn't answer, forgetting the session here is enough
    fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } }).catch(() => {});
  }
  keepSession(null);
  await loadCollages();
  changed("session");
}

// A fresh access token, renewing it when it has less than a minute left
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  try {
    keepSession(sessionFrom(await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token })));
    return session.access_token;
  } catch {
    keepSession(null);        // the sign-in ran out: sign in again
    userData.rotation = [];
    userData.library = new Map();
    applyLibraryChanges();    // back to the library file alone
    changed("session");
    return null;
  }
}

// Ask Supabase's database (PostgREST): rest("notes?about=eq.x"), rest("collages", {method: "POST", body})
export async function rest(path, { method = "GET", body, prefer, keepalive = false } = {}) {
  const { url, key } = data.supabase;
  const headers = { apikey: key };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (!key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, keepalive,
    });
    const text = await response.text();
    const answer = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(answer?.message || answer?.hint || `answered ${response.status}`);
    return answer;
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "Supabase didn't answer in time" : error.message);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Collages
// ---------------------------------------------------------------------------

export async function loadCollages() {
  if (!canSave()) return;
  await Promise.all([loadRotation(), loadLibrary()]);
  try {
    const rows = await rest("collages?select=id,owner,name,is_public,created_at,updated_at,collage_items(object_id,position,added_at)&order=updated_at.desc");
    userData.collages = rows.map((c) => ({
      ...c,
      items: (c.collage_items || [])
        .slice()
        .sort((a, b) => a.position - b.position || a.added_at.localeCompare(b.added_at))
        .map((i) => i.object_id),
    }));
    userData.error = null;
  } catch (error) {
    userData.error = error.message;
  }
  userData.loaded = true;
}

// ---------------------------------------------------------------------------
// Rotation: releases and mixes you've pinned. Their covers sit in the top bar.
// ---------------------------------------------------------------------------

async function loadRotation() {
  if (!session) { userData.rotation = []; return; }
  try {
    const rows = await rest(`rotation?owner=eq.${session.user.id}&select=object_id&order=added_at.desc`);
    userData.rotation = rows.map((r) => r.object_id);
  } catch {
    userData.rotation = [];
  }
}

export const onRotation = (objectId) => userData.rotation.includes(objectId);

// put it on rotation, or take it off; gives back whether it's on now
export async function toggleRotation(objectId) {
  if (!session) throw new Error("sign in to put things on rotation");
  if (onRotation(objectId)) {
    await rest(`rotation?owner=eq.${session.user.id}&object_id=eq.${encodeURIComponent(objectId)}`, { method: "DELETE" });
    userData.rotation = userData.rotation.filter((id) => id !== objectId);
  } else {
    await rest("rotation?on_conflict=owner,object_id", {
      method: "POST", body: { owner: session.user.id, object_id: objectId }, prefer: "resolution=ignore-duplicates,return=minimal",
    });
    userData.rotation = [objectId, ...userData.rotation];
  }
  changed("rotation");
  return onRotation(objectId);
}

// ---------------------------------------------------------------------------
// The library: the queue and the collection. What you see is the library file
// (your library from the pipeline) with your own changes on top, kept in the
// library_changes table: "queue", "collection", or "removed" (taken out of the
// file's library). Each account has its own; signed out, it's the file alone.
// ---------------------------------------------------------------------------

async function loadLibrary() {
  userData.library = new Map();
  if (session) {
    try {
      const rows = await rest(`library_changes?owner=eq.${session.user.id}&select=object_id,status,changed_at`);
      for (const r of rows) userData.library.set(r.object_id, { status: r.status, changed_at: r.changed_at });
    } catch { /* the file's library, as it is */ }
  }
  applyLibraryChanges(userData.library);
}

export const libraryStatus = (objectId) => data.inLibrary.get(objectId)?.status || null;

// The queue and collect icons on a release page: put it in the queue or the
// collection, or, when it's there already, take it out. Gives back the new status.
export async function setLibraryStatus(objectId, status) {
  if (!session) throw new Error("sign in to keep a library");
  const next = libraryStatus(objectId) === status ? null : status;
  const inFile = data.libraryFile.some((i) => i.id === objectId);
  const changedAt = new Date().toISOString();
  if (next === null && !inFile) {
    // only ever added on the site: forget the change altogether
    await rest(`library_changes?owner=eq.${session.user.id}&object_id=eq.${encodeURIComponent(objectId)}`, { method: "DELETE" });
    userData.library.delete(objectId);
  } else {
    const row = { owner: session.user.id, object_id: objectId, status: next || "removed", changed_at: changedAt };
    await rest("library_changes?on_conflict=owner,object_id", {
      method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal",
    });
    userData.library.set(objectId, { status: row.status, changed_at: changedAt });
  }
  applyLibraryChanges(userData.library);
  changed("library");
  return libraryStatus(objectId);
}

export const isMine = (collage) => Boolean(session && collage.owner === session.user?.id);
export const myCollages = () => userData.collages.filter(isMine);
export const collageById = (id) => userData.collages.find((c) => c.id === id);
export const collagesWith = (objectId) => userData.collages.filter((c) => c.items.includes(objectId));

function bump(collage) {
  collage.updated_at = new Date().toISOString();
  userData.collages.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createCollage(name, firstItem = null) {
  const [row] = await rest("collages", {
    method: "POST", body: { name: name.trim().slice(0, 80) }, prefer: "return=representation",
  });
  const collage = { ...row, items: [] };
  userData.collages.unshift(collage);
  if (firstItem) await addToCollage(collage.id, firstItem);
  changed("collages");
  return collage;
}

export async function updateCollage(id, change) {
  const [row] = await rest(`collages?id=eq.${id}`, { method: "PATCH", body: change, prefer: "return=representation" });
  const collage = collageById(id);
  if (collage && row) Object.assign(collage, row);
  changed("collages");
}

export async function deleteCollage(id) {
  await rest(`collages?id=eq.${id}`, { method: "DELETE" });
  userData.collages = userData.collages.filter((c) => c.id !== id);
  // its notes go too: on the collage, and on the items in it
  if (session) await rest(`notes?owner=eq.${session.user.id}&about=like.${encodeURIComponent(`collage:${id}`)}*`, { method: "DELETE" }).catch(() => {});
  changed("collages");
}

export async function addToCollage(collageId, objectId) {
  const collage = collageById(collageId);
  if (!collage || collage.items.includes(objectId)) return;
  await rest("collage_items?on_conflict=collage_id,object_id", {
    method: "POST",
    body: { collage_id: collageId, object_id: objectId, position: collage.items.length + 1 },
    prefer: "resolution=ignore-duplicates,return=minimal",
  });
  collage.items.push(objectId);
  bump(collage);
  changed("collages");
}

export async function removeFromCollage(collageId, objectId) {
  await rest(`collage_items?collage_id=eq.${collageId}&object_id=eq.${encodeURIComponent(objectId)}`, { method: "DELETE" });
  // your notes on it in this collage go with it
  if (session) await rest(`notes?owner=eq.${session.user.id}&about=eq.${encodeURIComponent(`collage:${collageId}:${objectId}`)}`, { method: "DELETE" }).catch(() => {});
  const collage = collageById(collageId);
  if (collage) { collage.items = collage.items.filter((id) => id !== objectId); bump(collage); }
  changed("collages");
}

// ---------------------------------------------------------------------------
// The garden: one per account (the gardens table), saved as you change it
// ---------------------------------------------------------------------------

// your garden, or null if you've never had one
export async function loadMyGarden() {
  if (!session) return null;
  const rows = await rest(`gardens?owner=eq.${session.user.id}&select=garden,updated_at`);
  return rows[0] || null;
}

export async function saveMyGarden(garden, { keepalive = false } = {}) {
  if (!session) throw new Error("sign in to keep a garden");
  await rest("gardens?on_conflict=owner", {
    method: "POST",
    body: { owner: session.user.id, garden: { plants: garden.plants || {}, marks: garden.marks || [] } },
    prefer: "resolution=merge-duplicates,return=minimal",
    keepalive,
  });
}

// ---------------------------------------------------------------------------
// Covers: an image you upload for a collage, kept in the public "covers"
// bucket in Supabase Storage, in a folder named after you
// ---------------------------------------------------------------------------

// The picture made square (cut from the middle) and 800 px, as a JPEG
async function squareJpeg(file, size = 800) {
  const picture = await createImageBitmap(file);
  const side = Math.min(picture.width, picture.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  canvas.getContext("2d").drawImage(picture,
    (picture.width - side) / 2, (picture.height - side) / 2, side, side,
    0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

// Upload a picture; gives back its public address
export async function uploadCover(file) {
  if (!session) throw new Error("sign in to upload");
  if (!/^image\//.test(file.type)) throw new Error("that isn't a picture");
  const blob = await squareJpeg(file);
  const path = `${session.user.id}/${crypto.randomUUID()}.jpg`;
  const { url, key } = data.supabase;
  const response = await fetch(`${url}/storage/v1/object/covers/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${await accessToken()}`, "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!response.ok) {
    const answer = await response.json().catch(() => ({}));
    throw new Error(answer.message || answer.error || `the upload answered ${response.status}`);
  }
  return `${url}/storage/v1/object/public/covers/${path}`;
}

// ---------------------------------------------------------------------------
// Notes: as many as you like on each thing. "about" says what a note is on:
// a mili ID, "collage:<id>", or an item in a collage, "collage:<id>:<mili ID>"
// ---------------------------------------------------------------------------

const NOTE_FIELDS = "id,owner,about,body,is_public,created_at,updated_at";

// the notes on one thing that you can see, oldest first
export async function notesAbout(about) {
  if (!canSave()) return [];
  return rest(`notes?about=eq.${encodeURIComponent(about)}&select=${NOTE_FIELDS}&order=created_at.asc`);
}

// the notes on everything whose "about" starts with this (all the items in a collage)
export async function notesStartingWith(prefix) {
  if (!canSave()) return [];
  return rest(`notes?about=like.${encodeURIComponent(prefix)}*&select=${NOTE_FIELDS}&order=created_at.asc`);
}

// Every note you've written, newest first (for the profile page)
export async function myNotes() {
  if (!session) return [];
  return rest(`notes?owner=eq.${session.user.id}&select=${NOTE_FIELDS}&order=updated_at.desc`);
}

export async function addNote(about, body, isPublic = false) {
  if (!session) throw new Error("sign in to write notes");
  const [row] = await rest("notes", {
    method: "POST", body: { owner: session.user.id, about, body, is_public: isPublic }, prefer: "return=representation",
  });
  return row;
}

export async function updateNote(id, change) {
  const [row] = await rest(`notes?id=eq.${id}`, { method: "PATCH", body: change, prefer: "return=representation" });
  return row;
}

export async function deleteNote(id) {
  await rest(`notes?id=eq.${id}`, { method: "DELETE" });
}
