// mili: the search box, opened with "/" (or ⌘K, or the + in the top bar).
//
// It's the one place to search. As you type it shows:
//   - "go to" places that match: home, queue, collection, settings
//   - releases in mili that match, live from Supabase (or from the browser)
//   - "search everything for …": the full results page, which also looks
//     outside mili (MusicBrainz, Apple Music, Deezer, Discogs)
// Pasting a link (Bandcamp, Spotify, Apple Music, Deezer, Tidal, Discogs,
// MusicBrainz, YouTube …) opens that release if mili has it; if not, it shows
// what the link is and where else it can be heard.
// ↑ ↓ choose, Enter opens, Esc closes.

import { data, normalize, searchLive, findEverywhere, lookUpMix, mixDate, mixLength, findInMili } from "./data.js";
import { h } from "./ui.js";

const PLACES = [
  { name: "home", href: "#/", words: "home start labels" },
  { name: "queue", href: "#/library?show=queue", words: "queue library" },
  { name: "collection", href: "#/library?show=collection", words: "collection library" },
  { name: "settings", href: "#/settings", words: "settings theme dark light accent account sign" },
];

let box = null;   // the open palette, if any

export function openPalette(startWith = "") {
  if (box) { box.input.focus(); return; }
  let rows = [];
  let chosen = 0;
  let latest = 0;

  const input = h("input", {
    class: "pal-input",
    type: "text",
    placeholder: "search, paste a link, or go to…",
    autocomplete: "off",
    spellcheck: "false",
    value: startWith,
  });
  const list = h("div", { class: "pal-list" });
  const panel = h("div", { class: "pal-panel", role: "dialog", "aria-label": "search" }, input, list);
  const shade = h("div", { class: "pal-shade", onclick: (e) => { if (e.target === shade) closePalette(); } }, panel);
  document.body.append(shade);
  document.body.classList.add("pal-open");
  box = { shade, input };

  function draw() {
    list.replaceChildren(...rows.map((r, i) => {
      const node = h(r.href ? "a" : "div", {
        class: `pal-row ${i === chosen ? "on" : ""} ${r.kind || ""}`,
        href: r.href || null,
        target: r.external ? "_blank" : null,
        rel: r.external ? "noopener" : null,
        onmouseenter: () => { chosen = i; mark(); },
        onclick: (e) => { if (r.run) { e.preventDefault(); r.run(); } closePalette(); },
      },
      r.cover !== undefined ? smallCover(r) : null,
      h("span", { class: "pal-text" }, h("span", { class: "pal-title" }, r.title), r.sub ? h("span", { class: "pal-sub" }, r.sub) : null),
      h("span", { class: "pal-action" }, r.action));
      return node;
    }));
  }
  function mark() {
    [...list.children].forEach((n, i) => n.classList.toggle("on", i === chosen));
    list.children[chosen]?.scrollIntoView({ block: "nearest" });
  }

  async function update() {
    const ticket = ++latest;
    const q = input.value.trim();
    const words = normalize(q);
    const places = PLACES
      .filter((p) => !words || words.split(" ").every((w) => p.words.includes(w) || p.name.includes(w)))
      .map((p) => ({ title: p.name, href: p.href, action: "go to" }));

    if (!q) { rows = places; chosen = 0; draw(); return; }

    // a pasted link
    if (/^https?:\/\//i.test(q)) {
      rows = [{ title: "looking up this link…", action: "", kind: "quiet" }];
      chosen = 0; draw();
      const found = await lookUpLink(q);
      if (ticket !== latest) return;
      rows = found;
      chosen = 0; draw();
      return;
    }

    const everything = { title: `search everything for “${q}”`, sub: "in mili and outside it", href: `#/search?q=${encodeURIComponent(q)}`, action: "search", kind: "everything" };
    rows = [...places.slice(0, 3), everything];
    chosen = places.length && words.length > 2 && places[0].title.startsWith(words) ? 0 : Math.min(places.length, 3);
    draw();

    await new Promise((r) => setTimeout(r, 140));      // wait for a pause in typing
    if (ticket !== latest) return;
    const answer = await searchLive(q, 6);
    if (ticket !== latest) return;
    const releases = answer.results.map((o) => ({
      title: o.title, sub: [o.artist, o.year].filter(Boolean).join(" · "), cover: o.cover || null, id: o.id,
      href: `#/release/${o.id}`, action: data.inLibrary.has(o.id) ? data.inLibrary.get(o.id).status : "open",
    }));
    rows = [...places.slice(0, 3), ...releases, everything];
    chosen = places.length && places[0].title.startsWith(words) ? 0 : places.slice(0, 3).length;
    if (chosen >= rows.length) chosen = 0;
    draw();
  }

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); chosen = Math.min(rows.length - 1, chosen + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); chosen = Math.max(0, chosen - 1); mark(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[chosen];
      if (!r) return;
      if (r.run) r.run();
      else if (r.external) window.open(r.href, "_blank", "noopener");
      else if (r.href) location.hash = r.href.slice(1);
      closePalette();
    } else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });
  input.focus();
  update();
}

export function closePalette() {
  if (!box) return;
  box.shade.remove();
  document.body.classList.remove("pal-open");
  box = null;
}

function smallCover(r) {
  if (!r.cover) return h("span", { class: "pal-cover blank" }, (r.title || "?").charAt(0).toUpperCase());
  const img = h("img", { class: "pal-cover", src: r.cover.replace(/front-500$/, "front-250").replace(/_16\.jpg$/, "_9.jpg"), alt: "" });
  img.addEventListener("error", () => img.replaceWith(h("span", { class: "pal-cover blank" }, (r.title || "?").charAt(0).toUpperCase())));
  return img;
}

// ---------------------------------------------------------------------------
// Pasted links
// ---------------------------------------------------------------------------

// the part of a link that names the release, whatever country or tracking
// bits are around it
function linkKey(url) {
  const u = url.trim();
  const tests = [
    [/music\.apple\.com\/.*?\/album\/(?:[^/?]+\/)?(\d+)/i, (m) => m[1]],
    [/open\.spotify\.com\/(?:intl-\w+\/)?(album|track)\/([A-Za-z0-9]+)/i, (m) => m[2]],
    [/deezer\.com\/(?:\w\w\/)?(album|track)\/(\d+)/i, (m) => `${m[1]}/${m[2]}`],
    [/tidal\.com\/(?:browse\/)?(album|track)\/(\d+)/i, (m) => `${m[1]}/${m[2]}`],
    [/discogs\.com\/(?:[^/]+\/)?(master|release)\/(\d+)/i, (m) => `${m[1]}/${m[2]}`],
    [/([a-z0-9-]+\.bandcamp\.com\/(?:album|track)\/[a-z0-9-]+)/i, (m) => m[1].toLowerCase()],
    [/[?&]list=([A-Za-z0-9_-]+)/i, (m) => m[1]],
    [/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/i, (m) => m[1]],
    [/((?:soundcloud|mixcloud)\.com\/[^?#]+)/i, (m) => m[1].replace(/\/$/, "").toLowerCase()],
  ];
  for (const [re, pick] of tests) {
    const m = u.match(re);
    if (m) return pick(m);
  }
  return u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

// mili's own ID for a MusicBrainz album: the first 12 characters of the
// SHA-256 of "musicbrainz:<release-group ID>" (as in macros/object_helpers.sql)
async function miliIdFor(bornFrom) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bornFrom));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

async function lookUpLink(url) {
  const open = (id, how) => {
    const o = data.byId.get(id);
    return [{ title: o.title, sub: [o.artist, o.year, how].filter(Boolean).join(" · "), cover: o.cover || null, href: `#/release/${id}`, action: "open" }];
  };

  // a MusicBrainz album: work out the mili ID straight away
  const mb = url.match(/musicbrainz\.org\/release-group\/([0-9a-f-]{36})/i);
  if (mb && crypto.subtle) {
    const id = await miliIdFor(`musicbrainz:${mb[1].toLowerCase()}`);
    if (data.byId.has(id)) return open(id, "in mili");
  }

  // any other link: ask Supabase which release has a link like it
  if (data.supabase) {
    try {
      const key = linkKey(url);
      const { url: base, key: apikey } = data.supabase;
      const headers = { apikey };
      if (!apikey.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${apikey}`;
      const response = await fetch(`${base}/rest/v1/object_instances?select=object_id&url=ilike.*${encodeURIComponent(key)}*&limit=1`, { headers });
      if (response.ok) {
        const [hit] = await response.json();
        if (hit && data.byId.has(hit.object_id)) return open(hit.object_id, "in mili");
      }
    } catch { /* fall through to looking outside */ }
  }

  // a mix that isn't in mili: ask SoundCloud, Mixcloud or NTS what it is
  if (/soundcloud\.com|mixcloud\.com|nts\.live/i.test(url) && data.supabase) {
    const mix = await lookUpMix(url);
    const known = !mix.error && findInMili(mix.artist, mix.title);
    if (known) return open(known, "in mili");
    if (!mix.error && mix.title) {
      return [
        { title: mix.title, sub: [mix.artist, mixDate(mix.date), mixLength(mix.length), "not in mili yet"].filter(Boolean).join(" · "),
          cover: mix.cover ?? null, kind: "quiet", action: "mix" },
        ...(mix.links || []).map((l) => ({ title: l.name, href: l.url, external: true, action: "listen ↗" })),
      ];
    }
    if (mix.error) {
      return [
        { title: "not in mili yet", sub: mix.error, kind: "quiet", action: "" },
        { title: "open the link", sub: url, href: url, external: true, action: "↗" },
      ];
    }
  }

  // not in mili: ask Odesli what it is and where else it can be heard
  const startable = /music\.apple\.com|deezer\.com|open\.spotify\.com|tidal\.com/i.test(url);
  if (startable && data.supabase) {
    const answer = await findEverywhere(url);
    if (!answer.error && (answer.links || []).length) {
      const title = answer.title || "this release";
      return [
        { title, sub: [answer.artist, "not in mili yet"].filter(Boolean).join(" · "), cover: answer.cover ?? null, kind: "quiet", action: "" },
        ...answer.links.map((l) => ({ title: l.name, href: l.url, external: true, action: "listen ↗" })),
      ];
    }
  }
  return [
    { title: "not in mili yet", sub: "mili doesn't have a release with this link", kind: "quiet", action: "" },
    { title: "open the link", sub: url, href: url, external: true, action: "↗" },
  ];
}
