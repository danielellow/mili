// mili: search outside mili.
//
// A small function that runs at Supabase (an "Edge Function"). It does three things:
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
//    It also asks Mixcloud for DJ mixes and radio shows (NTS archives every
//    show there), sent back as a separate list, "mixes".
//      body: {"query": "aphex twin syro"}
//
// 2. Find everywhere. Given one link to a release (Apple Music or Deezer),
//    it asks Odesli (song.link) for the same release on the other platforms:
//    Spotify, YouTube, YouTube Music, Tidal, Amazon Music, SoundCloud …
//      body: {"everywhere": "https://music.apple.com/us/album/syro/905386014"}
//
// 3. A mix. Given a SoundCloud, Mixcloud or NTS link, it says what the mix is:
//    title, DJ, artwork, date, length, and where else it can be heard (an NTS
//    episode's Mixcloud page). The same lookups as ingest/lookup_mixes.py.
//      body: {"mix": "https://www.nts.live/shows/…/episodes/…"}
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

// ---------------------------------------------------------------------------
// Mixes (SoundCloud, Mixcloud, NTS)
// ---------------------------------------------------------------------------

type Mix = {
  platform: string;          // mixcloud, soundcloud or nts
  title: string;
  artist: string;            // the DJ, as well as can be told
  uploader: string | null;   // the account it's on
  cover: string | null;
  url: string;
  date: string | null;       // 2025-03-12
  length: number | null;     // seconds
  tags: string[];
  links: { platform: string; name: string; url: string }[];
};

// Accounts that upload other people's mixes, so the DJ is in the title
// (the same idea as seeds/mix_stations.csv, kept short here)
const STATIONS = new Set([
  "nts radio", "nts", "rinse fm", "worldwide fm", "dublab", "the lot radio", "cashmere radio",
  "noods radio", "kiosk radio", "radio alhara", "threads radio", "foundation fm", "balamii",
  "berlin community radio", "hor berlin", "red light radio", "bbc radio 1", "bbc radio 6 music",
  "resident advisor", "boiler room", "dekmantel", "crack magazine", "fact", "mixmag", "fabric london",
  "xlr8r", "truants", "secret thirteen",
]);

// "Call Super - 12th March 2025" by NTS Radio -> "Call Super";
// "Boiler Room: Objekt" by Boiler Room -> "Objekt";
// "Soup To Nuts w/ Manara" (NTS) -> "Soup To Nuts"; a DJ's own upload -> the uploader
function mixArtist(title: string, uploader: string | null): string {
  if (uploader && !STATIONS.has(normalize(uploader))) return uploader;
  const pieces = title.split(/\s+[-–—|]\s+|:\s+/)
    .map((piece) => piece
      .replace(/^#?[A-Za-z]{0,6}[.#]?\s?\d+[a-z]?[.:]?\s+(?=\S)/, "")   // "RA.912 Tsvi" -> "Tsvi"
      .replace(/\s+(?:w\/|with)\s+.*$/i, "")
      .trim())
    .filter((piece) => piece && !STATIONS.has(normalize(piece)) && normalize(piece) !== normalize(uploader || ""));
  return pieces[0] || uploader || "";
}

function mixcloudMix(c: any): Mix {
  const url = c.url || `https://www.mixcloud.com${c.key}`;
  return {
    platform: "mixcloud",
    title: c.name,
    artist: mixArtist(c.name || "", c.user?.name || null),
    uploader: c.user?.name || null,
    cover: c.pictures?.extra_large || c.pictures?.large || c.pictures?.medium || null,
    url,
    date: (c.created_time || "").slice(0, 10) || null,
    length: c.audio_length ?? null,
    tags: (c.tags || []).map((t: any) => t.name).filter(Boolean),
    links: [{ platform: "mixcloud", name: "Mixcloud", url }],
  };
}

// Mixcloud's public search: mixes and radio shows whose title or DJ fits
async function mixcloud(query: string): Promise<Mix[]> {
  const answer = await getJson(
    `https://api.mixcloud.com/search/?q=${encodeURIComponent(query)}&type=cloudcast&limit=${PER_SOURCE}`,
  );
  const words = normalize(query).split(" ").filter(Boolean);
  return (answer.data || [])
    .map(mixcloudMix)
    .filter((m: Mix) => {
      // at least half the words in the title or the uploader's name
      const text = normalize(`${m.title} ${m.uploader || ""}`);
      return words.filter((w) => text.includes(w)).length >= Math.ceil(words.length / 2);
    })
    .slice(0, 6);
}

// What a SoundCloud, Mixcloud or NTS link is
async function mixDetails(link: string): Promise<Mix | { error: string }> {
  const address = new URL(link);
  const host = address.hostname.replace(/^(www|m)\./, "");
  const parts = address.pathname.split("/").filter(Boolean);

  if (host.endsWith("mixcloud.com")) {
    if (parts.length < 2) return { error: "this is a Mixcloud profile, not a mix" };
    return mixcloudMix(await getJson(`https://api.mixcloud.com/${parts[0]}/${parts[1]}/`));
  }

  if (host.endsWith("nts.live")) {
    const found = address.pathname.match(/\/shows\/([^/]+)\/episodes\/([^/]+)/);
    if (!found) return { error: "this is an NTS show, not an episode" };
    const e = await getJson(`https://www.nts.live/api/v2/shows/${found[1]}/episodes/${found[2]}`);
    const others = [e.mixcloud, ...(e.audio_sources || []).map((a: any) => a?.url)]
      .filter((u: any) => typeof u === "string" && u.startsWith("http"));
    const links = [{ platform: "nts", name: "NTS", url: link }];
    for (const u of new Set(others)) {
      if (u.includes("mixcloud.com")) links.push({ platform: "mixcloud", name: "Mixcloud", url: u });
      else if (u.includes("soundcloud.com")) links.push({ platform: "soundcloud", name: "SoundCloud", url: u });
    }
    return {
      platform: "nts",
      title: e.name,
      artist: mixArtist(e.name || "", null),
      uploader: null,
      cover: e.media?.picture_large || e.media?.background_large || null,
      url: link,
      date: (e.broadcast || "").slice(0, 10) || null,
      length: null,
      tags: (e.genres || []).map((g: any) => g.value).filter(Boolean),
      links,
    };
  }

  if (host.endsWith("soundcloud.com")) {
    const o = await getJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(link)}`);
    const uploader = o.author_name || null;
    const title = String(o.title || "").replace(new RegExp(`\\s+by\\s+${(uploader || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    return {
      platform: "soundcloud",
      title,
      artist: mixArtist(title, uploader),
      uploader,
      cover: o.thumbnail_url ? String(o.thumbnail_url).replace("-large.", "-t500x500.") : null,
      url: link,
      date: null,
      length: null,
      tags: [],
      links: [{ platform: "soundcloud", name: "SoundCloud", url: link }],
    };
  }

  return { error: "not a SoundCloud, Mixcloud or NTS link" };
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
    // what the link is: title, artist and cover, from the entity it started from
    const entity = (data.entitiesByUniqueId || {})[data.entityUniqueId] || {};
    return {
      links,
      title: entity.title || null,
      artist: entity.artistName || null,
      cover: entity.thumbnailUrl || null,
      ms: Date.now() - started,
    };
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
  let mixLink = "";
  try {
    const body = await req.json();
    query = String(body.query || "").trim().slice(0, 120);
    link = String(body.everywhere || "").trim();
    mixLink = String(body.mix || "").trim();
  } catch (_) {
    return reply({ error: "The body should be JSON: {\"query\": \"…\"}" }, 400);
  }
  if (link) {
    if (!/^https:\/\/(music\.apple\.com|www\.deezer\.com|open\.spotify\.com|tidal\.com)\//.test(link)) {
      return reply({ error: "find everywhere starts from an Apple Music, Deezer, Spotify or Tidal link" }, 400);
    }
    return reply(await everywhere(link));
  }
  if (mixLink) {
    if (!/^https:\/\/([a-z]+\.)?(soundcloud\.com|mixcloud\.com|nts\.live)\//.test(mixLink)) {
      return reply({ error: "a mix link is a SoundCloud, Mixcloud or NTS link" }, 400);
    }
    try {
      return reply(await mixDetails(mixLink));
    } catch (error) {
      const reason = (error as Error)?.name === "AbortError" ? "didn't answer in time" : String((error as Error)?.message || error);
      return reply({ error: reason });
    }
  }
  if (!normalize(query)) return reply({ query, results: [], sources: {} });

  const started = Date.now();
  const asked = { musicbrainz, apple_music: apple, deezer, discogs } as Record<string, (q: string) => Promise<Found[]>>;
  const names = Object.keys(asked);
  const mixesAsked = mixcloud(query);              // asked at the same time as the others
  const answers = await Promise.allSettled(names.map((name) => asked[name](query)));
  const [mixAnswer] = await Promise.allSettled([mixesAsked]);

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

  let mixes: Mix[] = [];
  if (mixAnswer.status === "fulfilled") {
    mixes = mixAnswer.value;
    sources.mixcloud = { found: mixes.length };
  } else {
    const reason = mixAnswer.reason?.name === "AbortError" ? "didn't answer in time" : String(mixAnswer.reason?.message || mixAnswer.reason);
    sources.mixcloud = { error: reason };
  }

  return reply({ query, ms: Date.now() - started, sources, results: combine(query, found), mixes });
});
