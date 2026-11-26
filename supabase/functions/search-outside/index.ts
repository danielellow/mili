// mili: search outside mili.
//
// A small function that runs at Supabase (an "Edge Function"). It does two things:
//
// 1. Search. When mili doesn't have a release, the website asks this function,
//    which asks four catalogues at the same time:
//      MusicBrainz   the open music encyclopedia (release groups: the album
//                    above all its editions)
//      Apple Music   Apple's public search
//      Deezer        Deezer's public search
//      Discogs       the record database (needs your Discogs token)
//    It puts results that are the same release together (same artist and
//    title), and sends back one list, best matches first.
//      body: {"query": "aphex twin syro"}
//
// 2. Find everywhere. Given one link to a release (Apple Music or Deezer),
//    it asks Odesli (song.link) for the same release on the other platforms:
//    Spotify, YouTube, YouTube Music, Tidal, Amazon Music, SoundCloud …
//      body: {"everywhere": "https://music.apple.com/us/album/syro/905386014"}
//
// The website calls it like this:
//   POST https://<project>.supabase.co/functions/v1/search-outside
//   headers: apikey: <the publishable key>
//
// Two secrets are set at Supabase (Edge Functions → Secrets), never in the
// website: DISCOGS_TOKEN and ODESLI_API_KEY, the same as in your .env.
// Without them, the search skips Discogs and "find everywhere" says so.
// It checks that the caller sends mili's publishable key, so it isn't open to anyone.
//
// Deployed from the Supabase dashboard (Edge Functions → Deploy a new function
// → Via Editor), with "Verify JWT" turned off: the publishable key isn't a JWT,
// so this code checks it instead.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// MusicBrainz asks every app to say who it is and how to reach whoever runs it
const USER_AGENT = "mili/0.1 ( https://github.com/danielellow/mili )";
const PER_SOURCE = 10;      // results asked from each catalogue
const MAX_RESULTS = 20;     // results sent back
const WAIT_MS = 6000;       // how long to wait for each catalogue

type Found = {
  source: string;
  rank: number;             // its place in that catalogue's answer (0 = first)
  title: string;
  artist: string;
  year: number | null;
  type: string | null;      // album, ep, single … when the catalogue says
  cover: string | null;
  url: string;
  tracks: number | null;
};

// "Björk – Homogenic (Remastered)" -> "bjork homogenic remastered"
function normalize(text: string): string {
  return (text || "")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// the core of a title, for telling whether two results are the same release:
// no "(Deluxe Edition)", no " - EP" or " - Single" (Apple adds these)
function coreTitle(title: string): string {
  return normalize(
    (title || "")
      .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "")
      .replace(/\s+-\s+(ep|single)$/i, ""),
  );
}

async function getJson(url: string, extraHeaders: Record<string, string> = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...extraHeaders },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// MusicBrainz: every word has to be in the title or the artist
async function musicbrainz(query: string): Promise<Found[]> {
  const escape = (word: string) => word.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, "\\$1");
  const words = normalize(query).split(" ").filter(Boolean);
  const lucene = words.map((w) => `(releasegroup:${escape(w)} OR artist:${escape(w)})`).join(" AND ");
  const data = await getJson(
    `https://musicbrainz.org/ws/2/release-group?fmt=json&limit=${PER_SOURCE}&query=${encodeURIComponent(lucene)}`,
  );
  return (data["release-groups"] || []).map((rg: any, rank: number) => ({
    source: "musicbrainz",
    rank,
    title: rg.title,
    artist: (rg["artist-credit"] || []).map((c: any) => (c.name || "") + (c.joinphrase || "")).join(""),
    year: rg["first-release-date"] ? Number(String(rg["first-release-date"]).slice(0, 4)) || null : null,
    type: rg["primary-type"] ? String(rg["primary-type"]).toLowerCase() : null,
    cover: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
    url: `https://musicbrainz.org/release-group/${rg.id}`,
    tracks: null,
  }));
}

async function apple(query: string): Promise<Found[]> {
  const data = await getJson(
    `https://itunes.apple.com/search?entity=album&country=us&limit=${PER_SOURCE}&term=${encodeURIComponent(query)}`,
  );
  return (data.results || []).map((a: any, rank: number) => ({
    source: "apple_music",
    rank,
    title: String(a.collectionName || "").replace(/\s+-\s+(EP|Single)$/, ""),
    artist: a.artistName || "",
    year: a.releaseDate ? Number(String(a.releaseDate).slice(0, 4)) || null : null,
    type: / - EP$/.test(a.collectionName || "") ? "ep" : / - Single$/.test(a.collectionName || "") ? "single" : null,
    cover: a.artworkUrl100 ? String(a.artworkUrl100).replace("100x100bb", "300x300bb") : null,
    url: String(a.collectionViewUrl || "").split("?")[0],
    tracks: a.trackCount ?? null,
  }));
}

async function deezer(query: string): Promise<Found[]> {
  const data = await getJson(
    `https://api.deezer.com/search/album?limit=${PER_SOURCE}&q=${encodeURIComponent(query)}`,
  );
  if (data.error) throw new Error(data.error.message || "answered with an error");
  return (data.data || []).map((a: any, rank: number) => ({
    source: "deezer",
    rank,
    title: a.title || "",
    artist: a.artist?.name || "",
    year: null,
    type: a.record_type || null,
    cover: a.cover_medium || null,
    url: a.link || "",
    tracks: a.nb_tracks ?? null,
  }));
}

// Discogs: masters (the album above all its pressings) and single releases.
// Discogs writes titles as "Artist - Title", and adds "(2)" or "*" to some
// artist names; those are taken off.
async function discogs(query: string): Promise<Found[]> {
  const token = Deno.env.get("DISCOGS_TOKEN");
  if (!token) throw new Error("not set up (no DISCOGS_TOKEN)");
  const data = await getJson(
    `https://api.discogs.com/database/search?per_page=15&q=${encodeURIComponent(query)}`,
    { Authorization: `Discogs token=${token}` },
  );
  const clean = (name: string) => name.replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();
  return (data.results || [])
    .filter((r: any) => r.type === "master" || r.type === "release")
    .map((r: any, rank: number) => {
      const full = String(r.title || "");
      const cut = full.indexOf(" - ");
      const formats = (r.format || []).map((f: string) => String(f).toLowerCase());
      const image = r.cover_image && !String(r.cover_image).includes("spacer.gif") ? r.cover_image : null;
      return {
        source: "discogs",
        rank,
        title: cut > 0 ? full.slice(cut + 3) : full,
        artist: cut > 0 ? clean(full.slice(0, cut)) : "",
        year: r.year ? Number(r.year) || null : null,
        type: formats.includes("album") ? "album" : formats.includes("ep") ? "ep" : formats.includes("single") ? "single" : null,
        cover: image,
        url: `https://www.discogs.com${r.uri || ""}`,
        tracks: null,
      };
    });
}

// Put results for the same release together, keep the ones that match what was
// typed, best first: found in more catalogues, then higher up in their answers.
function combine(query: string, found: Found[]) {
  const words = normalize(query).split(" ").filter(Boolean);
  const groups = new Map<string, any>();
  for (const item of found) {
    if (!item.title || !item.url) continue;
    const key = `${normalize(item.artist)}|${coreTitle(item.title)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        title: item.title, artist: item.artist, year: item.year, type: item.type,
        cover: null as string | null, coverFrom: "", tracks: item.tracks, sources: [] as any[], best: item.rank,
      });
    }
    const g = groups.get(key);
    if (!g.sources.some((s: any) => s.source === item.source)) g.sources.push({ source: item.source, url: item.url });
    if (item.year && (!g.year || item.year < g.year)) g.year = item.year;
    g.type = g.type || item.type;
    g.tracks = g.tracks || item.tracks;
    g.best = Math.min(g.best, item.rank);
    // Apple's and Deezer's covers always exist; the Cover Art Archive's may not
    if (item.cover && coverRank(item.source) < coverRank(g.coverFrom)) {
      g.cover = item.cover;
      g.coverFrom = item.source;
    }
  }
  const matching = [...groups.values()]
    .map((g) => {
      const text = normalize(`${g.artist} ${g.title}`);
      const share = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
      return { ...g, share };
    })
    .filter((g) => g.share >= 0.5);
  matching.sort((a, b) => b.share - a.share || b.sources.length - a.sources.length || a.best - b.best);
  return matching.slice(0, MAX_RESULTS).map(({ share, best, coverFrom, ...rest }) => rest);
}

function coverRank(source: string): number {
  return ({ apple_music: 1, deezer: 2, discogs: 3, musicbrainz: 4 } as Record<string, number>)[source] ?? 9;
}

// Find everywhere: Odesli's platform names, and mili's names for them
const ODESLI_PLATFORMS: Record<string, [string, string]> = {
  appleMusic: ["apple_music", "Apple Music"],
  spotify: ["spotify", "Spotify"],
  youtube: ["youtube", "YouTube"],
  youtubeMusic: ["youtube_music", "YouTube Music"],
  tidal: ["tidal", "Tidal"],
  deezer: ["deezer", "Deezer"],
  amazonMusic: ["amazon_music", "Amazon Music"],
  soundcloud: ["soundcloud", "SoundCloud"],
  pandora: ["pandora", "Pandora"],
  bandcamp: ["bandcamp", "Bandcamp"],
};

async function everywhere(link: string) {
  const key = Deno.env.get("ODESLI_API_KEY");
  if (!key) return { error: "not set up (no ODESLI_API_KEY)" };
  const started = Date.now();
  try {
    const data = await getJson(
      `https://api.odesli.co/v1-alpha.1/links?userCountry=US&songIfSingle=true&url=${encodeURIComponent(link)}&key=${encodeURIComponent(key)}`,
    );
    const links = Object.entries(data.linksByPlatform || {})
      .filter(([name]) => ODESLI_PLATFORMS[name])
      .map(([name, value]) => ({
        platform: ODESLI_PLATFORMS[name][0],
        name: ODESLI_PLATFORMS[name][1],
        url: (value as any).url,
      }));
    return { links, ms: Date.now() - started };
  } catch (error: any) {
    return { error: error?.name === "AbortError" ? "Odesli didn't answer in time" : `Odesli ${error?.message || error}` };
  }
}

// Only mili's own publishable key may call this. Supabase tells the function
// the project's publishable keys; if it doesn't, the call is let through rather
// than refusing mili's own site by mistake.
function allowed(req: Request): boolean {
  const keys: string[] = [];
  try {
    const publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    if (publishable) keys.push(...Object.values(JSON.parse(publishable)) as string[]);
  } catch (_) { /* not in the expected shape: treat as unknown */ }
  if (!keys.length) return true;
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) keys.push(anon);
  const given = req.headers.get("apikey") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return keys.includes(given);
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Send a POST with {\"query\": \"…\"}" }, 405);
  if (!allowed(req)) return reply({ error: "Not mili's key" }, 401);

  let query = "";
  let link = "";
  try {
    const body = await req.json();
    query = String(body.query || "").trim().slice(0, 120);
    link = String(body.everywhere || "").trim();
  } catch (_) {
    return reply({ error: "The body should be JSON: {\"query\": \"…\"}" }, 400);
  }
  if (link) {
    if (!/^https:\/\/(music\.apple\.com|www\.deezer\.com|open\.spotify\.com|tidal\.com)\//.test(link)) {
      return reply({ error: "find everywhere starts from an Apple Music, Deezer, Spotify or Tidal link" }, 400);
    }
    return reply(await everywhere(link));
  }
  if (!normalize(query)) return reply({ query, results: [], sources: {} });

  const started = Date.now();
  const asked = { musicbrainz, apple_music: apple, deezer, discogs } as Record<string, (q: string) => Promise<Found[]>>;
  const names = Object.keys(asked);
  const answers = await Promise.allSettled(names.map((name) => asked[name](query)));

  const sources: Record<string, unknown> = {};
  const found: Found[] = [];
  answers.forEach((answer, i) => {
    if (answer.status === "fulfilled") {
      found.push(...answer.value);
      sources[names[i]] = { found: answer.value.length };
    } else {
      const reason = answer.reason?.name === "AbortError" ? "didn't answer in time" : String(answer.reason?.message || answer.reason);
      sources[names[i]] = { error: reason };
    }
  });

  return reply({ query, ms: Date.now() - started, sources, results: combine(query, found) });
});
