// mili: loading the exported data and finding things in it.
//
// The export (export/export_site_data.py) writes these files into site/data/:
//   index.json         every release and mix (light version)
//   objects/<xx>.json  the full release pages, grouped by the first two
//                      characters of the mili ID
//   library.json       Daniel's library: items and collages
//   platforms.json     the platforms and their order
//   labels.json        the labels, in Daniel's order, with their pictures
//   supabase.json      where the live database is (address + publishable key)
//   meta.json          counts and where the data comes from

const cache = new Map();          // objects/<xx>.json files already loaded

export const data = {
  index: [],                      // every object, from index.json
  byId: new Map(),                // mili ID -> object
  byArtist: new Map(),            // MusicBrainz artist ID -> objects
  byLabel: new Map(),             // label name -> objects
  labels: [],                     // label names, A to Z
  labelInfo: [],                  // the labels with pictures, from labels.json
  supabase: null,                 // {url, key} for live search, from supabase.json
  library: { items: [], collages: [] },
  inLibrary: new Map(),           // mili ID -> library item (added_on, status, collages)
  platforms: [],
  meta: {},
};

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

// Make text comparable: lowercase, no accents, punctuation as spaces.
// "Björk – Homogenic!" -> "bjork homogenic"
export function normalize(text) {
  return (text || "")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function loadAll() {
  const [index, library, platforms, meta, labelInfo, supabase] = await Promise.all([
    getJson("data/index.json"),
    getJson("data/library.json").catch(() => ({ items: [], collages: [] })),
    getJson("data/platforms.json"),
    getJson("data/meta.json"),
    getJson("data/labels.json").catch(() => []),
    getJson("data/supabase.json").catch(() => null),
  ]);

  data.index = index;
  data.library = library;
  data.platforms = platforms;
  data.meta = meta;
  data.labelInfo = labelInfo || [];
  data.supabase = supabase && supabase.url && supabase.key ? supabase : null;

  for (const obj of index) {
    data.byId.set(obj.id, obj);
    // what search looks through, made comparable once, up front
    obj._search = normalize(`${obj.title} ${obj.artist || ""} ${(obj.labels || []).join(" ")}`);
    obj._title = normalize(obj.title);
    obj._artist = normalize(obj.artist);
    for (const artistId of obj.artist_ids || []) {
      if (!data.byArtist.has(artistId)) data.byArtist.set(artistId, []);
      data.byArtist.get(artistId).push(obj);
    }
    for (const label of obj.labels || []) {
      if (!data.byLabel.has(label)) data.byLabel.set(label, []);
      data.byLabel.get(label).push(obj);
    }
  }
  data.labels = [...data.byLabel.keys()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  for (const item of library.items) {
    if (data.byId.has(item.id)) data.inLibrary.set(item.id, item);
  }
}

// The full version of one object (listen links, buy menu, versions).
// Each objects/<xx>.json file is loaded once and then kept.
export async function getObject(id) {
  const prefix = id.slice(0, 2);
  if (!cache.has(prefix)) cache.set(prefix, getJson(`data/objects/${prefix}.json`));
  const chunk = await cache.get(prefix);
  return chunk[id];
}

// Search titles, artists and labels. Every word typed has to appear somewhere.
// Best first: library items, then titles or artists that start with what was
// typed, then the rest; newer before older.
export function search(query, limit = 60) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return { total: 0, results: [] };
  const q = words.join(" ");
  const hits = [];
  for (const obj of data.index) {
    if (!words.every((w) => obj._search.includes(w))) continue;
    let score = 0;
    if (data.inLibrary.has(obj.id)) score += 4;
    if (obj._title === q || obj._artist === q) score += 3;
    if (obj._title.startsWith(q) || obj._artist.startsWith(q)) score += 2;
    hits.push({ obj, score });
  }
  hits.sort((a, b) => b.score - a.score || (b.obj.year || 0) - (a.obj.year || 0));
  return { total: hits.length, results: hits.slice(0, limit).map((h) => h.obj) };
}

// Live search: asks the search_objects function in Supabase (see
// supabase/schema.sql), which also finds near-misses like typos.
// If Supabase isn't set up, or doesn't answer within 4 seconds, it searches
// in the browser instead, like search() above.
// After a failed try it searches in the browser for a minute before trying
// Supabase again, so a paused or unreachable database doesn't slow every search.
// Returns { total, results, source: "supabase" | "browser", close, ms, why }.
let liveResumesAt = 0;
let liveTrouble = "";

export async function searchLive(query, limit = 60) {
  if (!normalize(query)) return { total: 0, results: [], source: "browser" };
  if (!data.supabase) return { ...search(query, limit), source: "browser" };
  if (Date.now() < liveResumesAt) return { ...search(query, limit), source: "browser", why: liveTrouble };

  const { url, key } = data.supabase;
  const headers = { apikey: key, "Content-Type": "application/json" };
  // the older kind of key (a long "eyJ…" token) also has to be sent as Authorization
  if (!key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const started = performance.now();
  try {
    const response = await fetch(`${url}/rest/v1/rpc/search_objects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, max_results: limit }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Supabase answered ${response.status}`);
    const rows = await response.json();
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      // use the object the site already knows when it can, so covers and
      // library marks work the same; otherwise the row from Supabase itself
      results: rows.map((row) => data.byId.get(row.id) || row),
      close: rows.some((row) => row.close_match),
      source: "supabase",
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    const why = error.name === "AbortError" ? "Supabase didn't answer"
      : error instanceof TypeError ? "couldn't reach Supabase" : error.message;
    console.warn(`Live search: ${why} (${error.message}). Searching in the browser for a minute.`);
    liveResumesAt = Date.now() + 60_000;
    liveTrouble = why;
    return { ...search(query, limit), source: "browser", why };
  } finally {
    clearTimeout(timer);
  }
}

// Everything by the same artist(s), the object itself left out.
export function sameArtist(obj) {
  const seen = new Map();
  for (const artistId of obj.artist_ids || []) {
    for (const other of data.byArtist.get(artistId) || []) {
      if (other.id !== obj.id) seen.set(other.id, other);
    }
  }
  return [...seen.values()];
}

// Watering: each time a listen link is opened from mili, that object gets a
// can of water, and the day is noted. Kept in this browser (localStorage);
// the garden reads it, and "in rotation" means watered in the last 30 days.
function readWater() {
  try {
    return JSON.parse(localStorage.getItem("mili.water") || "{}");
  } catch {
    return {};
  }
}

export function water(id) {
  try {
    const all = readWater();
    const before = typeof all[id] === "number" ? { cans: all[id] } : all[id] || { cans: 0 };
    all[id] = { cans: before.cans + 1, last: Date.now() };
    localStorage.setItem("mili.water", JSON.stringify(all));
  } catch {
    // private browsing or storage turned off: the link still opens
  }
}

export function cansOfWater(id) {
  const entry = readWater()[id];
  return typeof entry === "number" ? entry : entry ? entry.cans : 0;
}

export function inRotation(id, days = 30) {
  const entry = readWater()[id];
  return Boolean(entry && entry.last && Date.now() - entry.last < days * 24 * 60 * 60 * 1000);
}
