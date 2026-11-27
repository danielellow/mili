// mili: the pages. Each function returns what goes into <main>.

import { data, getObject, searchLive, searchOutside, findEverywhere, sameArtist, water, normalize, mixDate, mixLength } from "./data.js";
import { h, mi, cover, byline, list, row, dotKey, availabilityText, availabilityDot } from "./ui.js";
import { readTheme, saveTheme, DEFAULT_ACCENT } from "./theme.js";
import { openPalette } from "./palette.js";
import { notesBlock } from "./notes.js";
import { collageButton, collageLine, collagePage, profilePage, collageChips, newCollageChip, bringInFileCollages } from "./collages.js";
import { canSave, me, signIn, signInAsGuest, signOut, userData, collagesWith, onRotation, toggleRotation, setLibraryStatus } from "./account.js";

// #/collage/<id> and #/profile (the pages themselves are in collages.js)
export const collage = collagePage;
export const profile = profilePage;

// small choices kept in this browser: getting started shown or not, which
// listen services to show
export function readPrefs() {
  try { return JSON.parse(localStorage.getItem("mili.prefs") || "{}"); } catch { return {}; }
}
function savePrefs(change) {
  const prefs = { ...readPrefs(), ...change };
  try { localStorage.setItem("mili.prefs", JSON.stringify(prefs)); } catch { /* storage off */ }
  return prefs;
}

const byYearNewest = (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);

// ---------------------------------------------------------------------------
// Home and search
// ---------------------------------------------------------------------------

// The results page: what "search everything" in the search box opens.
// Everything in mili that matches, and, when mili has nothing (or only
// near-misses), what MusicBrainz, Apple Music, Deezer and Discogs have.
export function search(query) {
  const results = h("div", { class: "results" });

  // results under the search box, updated as you type (the box keeps its focus)
  let latest = 0;
  async function showResults(q) {
    const ticket = ++latest;
    if (!q) {
      results.replaceChildren(h("p", { class: "count" }, "Press / to search."));
      return;
    }
    // if the answer takes a moment, say so
    const waiting = setTimeout(() => {
      if (ticket === latest) results.querySelector(".count")?.replaceChildren("searching…");
    }, 350);
    const answer = await searchLive(q);
    clearTimeout(waiting);
    // while waiting, a newer search may have started: then this one is old news
    if (ticket !== latest) return;
    const { total, results: found, source, close, ms, why } = answer;

    const where = source === "supabase"
      ? `live from Supabase · ${ms} ms`
      : why ? `searched in this browser (${why})` : "searched in this browser";
    const count = total === 0 ? `Nothing found for “${q}”.`
      : close ? `No exact matches for “${q}”. ${total.toLocaleString("en")} close ${total === 1 ? "match" : "matches"}`
        : total > found.length ? `${total.toLocaleString("en")} found · showing the first ${found.length}`
          : `${total.toLocaleString("en")} found`;
    const outside = h("div", { class: "outside" });
    results.replaceChildren(
      h("p", { class: "count" }, count, h("span", { class: `source ${source}` }, where)),
      list(found, ""),
      outside,
    );
    // outside mili: by itself when mili has nothing (or only near-misses),
    // otherwise on request
    if (data.supabase) {
      if (total === 0 || close) {
        // wait until typing has paused, so half-typed words aren't searched
        setTimeout(() => { if (ticket === latest) showOutside(q, outside, ticket); }, 700);
      } else {
        outside.replaceChildren(h("button", {
          class: "bracket",
          onclick: () => showOutside(q, outside, ticket),
        }, "[search outside mili]"));
      }
    }
  }

  async function showOutside(q, box, ticket) {
    box.replaceChildren(h("h2", {}, "Outside mili"), h("p", { class: "count" }, "searching…"));
    const answer = await searchOutside(q);
    if (ticket !== latest) return;
    if (answer.error) {
      box.replaceChildren(h("h2", {}, "Outside mili"),
        h("p", { class: "count" }, `The outside search didn't work: ${answer.error}.`));
      return;
    }
    const names = { musicbrainz: "MusicBrainz", apple_music: "Apple Music", deezer: "Deezer", discogs: "Discogs", mixcloud: "Mixcloud" };
    const status = Object.entries(answer.sources || {}).map(([name, s]) =>
      s.error ? `${names[name] || name}: ${s.error}` : `${names[name] || name} ${s.found}`).join(" · ");
    const shown = (answer.results || []).map((r) => outsideRow(r, names));
    const mixes = (answer.mixes || []).map(outsideMixRow);
    const found = [
      shown.length ? `${shown.length} release${shown.length === 1 ? "" : "s"}` : null,
      mixes.length ? `${mixes.length} mix${mixes.length === 1 ? "" : "es"}` : null,
    ].filter(Boolean).join(" and ");
    box.replaceChildren(...[      // (empty spots left out, or they'd show as "null")
      h("h2", {}, "Outside mili"),
      h("p", { class: "count" },
        found ? `${found} found online` : `Nothing found online for “${q}”.`,
        h("span", { class: "source" }, `${status} · ${answer.ms} ms`)),
      shown.length ? h("div", { class: "list" }, shown.map((s) => s.row)) : null,
      mixes.length ? h("h3", { class: "outside-mixes" }, "Mixes", h("span", { class: "n" }, "on Mixcloud, where NTS keeps its shows too")) : null,
      mixes.length ? h("div", { class: "list" }, mixes) : null,
    ].filter(Boolean));
    // Odesli allows 10 lookups a minute, so only the top 3 fill in by
    // themselves, one after another; the rest keep the links the search found
    for (const item of shown.filter((s) => s.start).slice(0, 3)) {
      if (ticket !== latest) return;      // a new search has started
      await item.fillIn();
    }
  }

  showResults(query);
  return h("section", { class: "page search-page" },
    h("p", { class: "search-head" },
      "results for ", h("b", {}, `“${query}”`),
      h("button", { class: "bracket", onclick: () => openPalette(query) }, "[search again]")),
    results);
}

// The front page: getting started (until it's hidden in settings), what was
// added to the library lately, and the labels.
export function home() {
  const recent = data.library.items.slice(0, 8).map((i) => data.byId.get(i.id)).filter(Boolean);
  return h("section", { class: "page home" },
    rotationSection(),
    gettingStarted(),
    recent.length ? h("h2", {}, "Recently added to the library") : null,
    recent.length ? list(recent) : null,
    recent.length ? h("p", { class: "count" }, h("a", { href: "#/library" }, `the whole library (${data.library.items.length}) →`)) : null,
    h("h2", { id: "labels" }, "Labels"),
    labelGrid());
}

// ▸ rotation ↻ 2: what you have on rotation, folded or open (remembered)
function rotationSection() {
  const ids = canSave() && me() ? userData.rotation.filter((id) => data.byId.has(id)) : [];
  if (!ids.length) return null;
  return h("details", {
    class: "getting-started rotation-section",
    open: readPrefs().rotationOpen === true,
    ontoggle: (event) => savePrefs({ rotationOpen: event.target.open }),
  },
  h("summary", {}, "rotation", mi("rotation", "inline"), h("span", { class: "n" }, ids.length)),
  list(ids.map((id) => data.byId.get(id))));
}

// ▾ getting started: short, with the top bar's icons. Folding it shut is
// remembered; settings → home hides it altogether.
function gettingStarted() {
  const prefs = readPrefs();
  if (prefs.gettingStarted === false) return null;
  const go = (href, text) => h("a", { class: "dotted", href }, text);
  const icon = (name) => mi(name, "inline");
  const first = data.library.items.find((i) => data.byId.has(i.id));
  return h("details", {
    class: "getting-started",
    open: prefs.gettingStartedOpen !== false,
    ontoggle: (event) => savePrefs({ gettingStartedOpen: event.target.open }),
  },
  h("summary", {}, "getting started", h("a", { class: "info", href: "#/guide", title: "the guide" }, "i")),
  h("ol", {},
    h("li", {}, h("button", { class: "dotted", onclick: () => openPalette() }, "search"), " by pressing ", h("kbd", {}, "/"),
      " or the ", icon("plus"), " in the top bar, in mili and outside it."),
    h("li", {}, first ? go(`#/release/${first.id}`, "open a release") : "open a release",
      " to listen wherever you like, or ", h("code", {}, "[buy]"), " it."),
    h("li", {}, "the library is a ", go("#/library?show=queue", "queue"), " ", icon("queue"), " and a ",
      go("#/library?show=collection", "collection"), " ", icon("collect"), ": add to them with the same icons on a release's page. Gather anything into collages ", icon("collage"), ", and keep notes ", icon("note"), " on what you find."),
    h("li", {}, "put a release ", go("#/guide", "on rotation"), " with ", icon("rotation"),
      " on its page: its cover sits in the top bar, close at hand."),
    h("li", {}, "walk the ", go("#/atlas", "atlas"), " ", icon("network"),
      ": one release in the middle, and what it shares with the rest of the library around it."),
    h("li", {}, "tend the ", go("#/garden", "garden"), " ", icon("garden"),
      ": plant the library, shape the ground, and see what you return to grow."),
    h("li", {}, "browse the ", h("a", {
      class: "dotted", href: "#/",
      onclick: (event) => { event.preventDefault(); document.getElementById("labels")?.scrollIntoView({ behavior: "smooth" }); },
    }, "labels"), " below, choose dark or light in ", go("#/settings", "settings"),
      ", and read more in the ", go("#/guide", "guide"), " ", icon("menu"), ".")));
}

// ---------------------------------------------------------------------------
// Release page
// ---------------------------------------------------------------------------

export async function release(id) {
  const light = data.byId.get(id);
  if (!light) return notFound("This release isn't in the catalogue.");
  const obj = await getObject(id);
  if (!obj) return notFound("This release's page couldn't be loaded.");

  // the row of listen links, in the platforms' order: the first three, [buy],
  // and "…", which shows the rest and [refresh links]
  const listen = h("div", { class: "links folded" });
  const hiddenServices = new Set(readPrefs().hiddenServices || []);
  for (const link of obj.listen.filter((l) => !hiddenServices.has(l.platform))) {
    listen.append(
      h("a", {
        class: "link",
        href: link.url,
        target: "_blank",
        rel: "noopener",
        title: link.version ? `${link.name}: ${link.version}` : link.name,
        onclick: () => water(id),          // the garden grows from use
      }, link.name, " ↗", link.version ? h("span", { class: "version" }, link.version.toLowerCase()) : null),
    );
  }
  if (!obj.listen.length) listen.append(h("span", { class: "muted" }, "no listen links found"));

  // [buy]: a small menu with Bandcamp and Discogs
  if (obj.buy.length) {
    const menu = h("div", { class: "menu", hidden: true },
      obj.buy.map((b) =>
        h("a", { href: b.url, target: "_blank", rel: "noopener" },
          b.name, b.kind === "search" ? h("span", { class: "version" }, "search") : null, " ↗")));
    const toggle = h("button", {
      class: "bracket",
      "aria-expanded": "false",
      onclick: (event) => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        toggle.setAttribute("aria-expanded", String(!menu.hidden));
      },
    }, "[buy]");
    // (a click anywhere else closes the menu: see app.js)
    listen.append(h("span", { class: "buy" }, toggle, menu));
  }
  if (obj.kind !== "mix") {
    const refresh = refreshLinks(obj, listen);    // Odesli only knows releases
    refresh.classList.add("extra");
    listen.append(refresh);
  }
  const moreLinks = h("button", {
    class: "more-links",
    title: "more platforms",
    "aria-expanded": "false",
    onclick: (event) => {
      event.stopPropagation();
      const open = listen.classList.toggle("folded") === false;
      moreLinks.setAttribute("aria-expanded", String(open));
      moreLinks.title = open ? "fewer platforms" : "more platforms";
    },
  }, "…");
  listen.append(moreLinks);
  foldLinks(listen);

  // the icons: queue and collection (your library: click to put it there or
  // take it out), rotation (your pin: its cover sits in the top bar), the
  // atlas, and collages. Signed out, queue, collect and rotation lead to sign in.
  const toSignIn = () => { location.hash = `#/sign-in?back=${encodeURIComponent(location.hash)}`; };
  const libraryLine = h("p", { class: "meta" });
  const libraryButton = (status, icon) => {
    const button = h("button", { class: "act" }, mi(icon));
    button.addEventListener("click", async () => {
      if (!me()) { toSignIn(); return; }
      queue.disabled = collect.disabled = true;
      try { await setLibraryStatus(id, status); } catch { /* stays as it was */ }
      queue.disabled = collect.disabled = false;
      drawLibrary();
    });
    return button;
  };
  const queue = libraryButton("queue", "queue");
  const collect = libraryButton("collection", "collect");
  const drawLibrary = () => {
    const item = data.inLibrary.get(id);
    const status = item?.status;
    queue.classList.toggle("on", status === "queue");
    queue.title = status === "queue" ? "in the queue: click to take it out" : "put it in the queue";
    collect.classList.toggle("on", status === "collection");
    collect.title = status === "collection" ? "in the collection: click to take it out" : "add it to the collection";
    // "added 2026-11-27 · collection" (without the live database, the library
    // file's collages are named here too; with it, they're in collageLine)
    libraryLine.hidden = !item;
    libraryLine.replaceChildren(...(item ? [
      `added ${item.added_on || "(no date)"} · ${item.status}`,
      !canSave() && item.collages.length ? ` · ${item.collages.join(", ")}` : "",
    ] : []));
  };
  drawLibrary();

  const rotation = h("button", { class: "act" }, mi("rotation"));
  const drawRotation = () => {
    const on = onRotation(id);
    rotation.classList.toggle("on", on);
    rotation.title = on ? "on rotation: click to take it off" : "put it on rotation";
  };
  drawRotation();
  rotation.addEventListener("click", async () => {
    if (!me()) { toSignIn(); return; }
    rotation.disabled = true;
    try { await toggleRotation(id); } catch { /* stays as it was */ }
    rotation.disabled = false;
    drawRotation();
  });
  const actions = h(
    "div",
    { class: "actions" },
    queue,
    collect,
    rotation,
    h("a", { class: "act", href: `#/atlas/${id}`, title: "see it in the atlas" }, mi("network")),
    collageButton(id),
  );

  // "2 versions · Wind (Deluxe Version)"
  const others = obj.versions.filter((v) => !v.main);
  const versions = obj.versions_total > 1
    ? h("p", { class: "versions" },
      h("span", { class: "muted" }, `${obj.versions_total} versions · `),
      others.map((v, i) => [i ? h("span", { class: "muted" }, " · ") : null, v.title]))
    : null;

  const more = sameArtist(light).sort(byYearNewest);

  return h(
    "section",
    { class: "page" },
    h(
      "article",
      { class: "release" },
      cover(obj, "large"),
      h(
        "div",
        { class: "release-main" },
        h("h1", {}, obj.title,
          obj.type ? h("span", { class: "badge" }, obj.type) : null,
          obj.kind === "mix" ? h("span", { class: "badge" }, "mix") : null),
        byline(obj),
        obj.kind === "mix" ? mixLine(obj) : null,
        listen,
        actions,
      ),
    ),
    notesBlock(id),
    obj.kind === "mix" ? mixPlayer(obj) : contains(obj),
    versions,
    libraryLine,
    collageLine(id),
    more.length ? h("h2", {}, `More by ${obj.artist}`) : null,
    more.length ? list(more) : null,
  );
}

// Only the first three listen links show until "…" is clicked; the rest get
// the class "extra" (hidden while the row is "folded"). Run again when
// [refresh links] adds some. "…" only shows when there's something behind it.
const SHOWN_LINKS = 3;
function foldLinks(listen) {
  [...listen.querySelectorAll(":scope > .link")].forEach((a, i) => a.classList.toggle("extra", i >= SHOWN_LINKS));
  const more = listen.querySelector(":scope > .more-links");
  if (more) more.hidden = !listen.querySelector(":scope > .extra");
}

// [refresh links] on a release page: asks Odesli, through the function at
// Supabase, for this release on every platform, starting from its Apple Music,
// Deezer, Spotify or Tidal link, and adds the platforms mili didn't have yet,
// marked "new". They show on the page only; saving them comes later.
function refreshLinks(obj, listen) {
  const startFrom = ["apple_music", "deezer", "spotify", "tidal"];
  const start = startFrom.map((p) => obj.listen.find((l) => l.platform === p)).find(Boolean);
  if (!data.supabase || !start) {
    return h("span", {
      class: "bracket muted",
      title: start ? "needs live search (Supabase) to be set up"
        : "needs a link on Apple Music, Deezer, Spotify or Tidal to start from",
    }, "[refresh links]");
  }
  const button = h("button", {
    class: "bracket refresh-links",
    title: "look for this release on more platforms",
    onclick: async (event) => {
      event.stopPropagation();
      button.disabled = true;
      button.textContent = "[refreshing links]";
      const answer = await findEverywhere(start.url);
      if (answer.error) {
        button.disabled = false;
        button.textContent = "[refresh links]";
        button.title = `didn't work: ${answer.error}`;
        return;
      }
      const known = new Set(obj.listen.map((l) => l.platform));
      const allowed = new Set(data.platforms.filter((p) => p.for_releases !== false).map((p) => p.id));
      const fresh = (answer.links || []).filter((l) => !known.has(l.platform) && allowed.has(l.platform));
      const buy = listen.querySelector(".buy");
      for (const l of fresh) {
        obj.listen.push({ platform: l.platform, name: l.name, url: l.url });
        const link = h("a", {
          class: "link new", href: l.url, target: "_blank", rel: "noopener",
          title: `${l.name}: just found`, onclick: () => water(obj.id),
        }, l.name, " ↗", h("span", { class: "version" }, "new"));
        listen.insertBefore(link, buy || button);
      }
      foldLinks(listen);
      button.textContent = fresh.length ? `[${fresh.length} new]` : "[nothing new]";
      button.title = "refreshed just now";
    },
  }, "[refresh links]");
  return button;
}

// Under a mix's byline: "12 Mar 2025 · 1 h 59 min · on NTS Radio"
function mixLine(obj) {
  const mix = obj.mix || {};
  const parts = [mixDate(mix.date), mixLength(mix.length)].filter(Boolean);
  if (mix.uploader && normalize(mix.uploader) !== normalize(obj.artist || "")) parts.push(`on ${mix.uploader}`);
  return parts.length ? h("p", { class: "mix-line" }, parts.join(" · ")) : null;
}

// A mix plays in its platform's own player: Mixcloud's, or SoundCloud's.
// (NTS has no player of its own to embed; its episodes are on Mixcloud.)
function mixPlayer(obj) {
  const theme = readTheme();
  const mixcloud = obj.listen.find((l) => l.platform === "mixcloud");
  const soundcloud = obj.listen.find((l) => l.platform === "soundcloud");
  let player = null;
  if (mixcloud) {
    const feed = new URL(mixcloud.url).pathname;
    player = h("iframe", {
      class: "mix-player mixcloud",
      src: `https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&light=${theme.dark ? 0 : 1}&feed=${encodeURIComponent(feed)}`,
      title: `${obj.title} on Mixcloud`,
      loading: "lazy",
      allow: "encrypted-media; autoplay",
    });
  } else if (soundcloud) {
    const options = [
      `url=${encodeURIComponent(soundcloud.url)}`,
      `color=${encodeURIComponent(theme.accent)}`,
      "auto_play=false", "hide_related=true", "show_comments=false",
      "show_user=true", "show_reposts=false", "show_teaser=false", "visual=false",
    ].join("&");
    player = h("iframe", {
      class: "mix-player soundcloud",
      src: `https://w.soundcloud.com/player/?${options}`,
      title: `${obj.title} on SoundCloud`,
      loading: "lazy",
      allow: "autoplay",
    });
  }
  if (!player) return null;
  return h("div", { class: "contains" },
    h("h3", {}, "listen here"),
    player);
}

// "contains 8": the songs on a release, each with the cover, title and artist,
// and the length on the right. Releases with more than one disc get a small
// "disc 2" between the discs. Releases without a track list of their own, but
// with a Bandcamp ID, have Bandcamp's slim player instead ("listen here").
function contains(obj) {
  const tracks = obj.tracks || [];
  if (tracks.length) {
    const discs = new Set(tracks.map((t) => t.disc)).size;
    return h("div", { class: "contains" },
      h("h3", {}, "contains", h("span", { class: "n" }, tracks.length)),
      h("div", { class: "tracks" },
        tracks.map((t, i) => [
          discs > 1 && (i === 0 || t.disc !== tracks[i - 1].disc)
            ? h("p", { class: "disc" }, `disc ${t.disc}`) : null,
          h("div", { class: "track" },
            cover(obj, "small"),
            h("div", { class: "row-text" },
              h("div", { class: "row-title" }, t.title),
              h("div", { class: "track-artist" }, t.artist || obj.artist || "")),
            t.length_ms ? h("span", { class: "length" }, duration(t.length_ms)) : null),
        ])));
  }
  if (obj.bandcamp_player) {
    // Bandcamp's own player, the slim one: a single line in the site's colours
    // (the cover is already at the top of the page)
    const theme = readTheme();
    const src = "https://bandcamp.com/EmbeddedPlayer/" + [
      obj.bandcamp_player,
      "size=small",
      `bgcol=${theme.dark ? "0b0b0b" : "ffffff"}`,
      `linkcol=${theme.accent.replace("#", "")}`,
      "artwork=none",
      "transparent=true",
    ].join("/") + "/";
    return h("div", { class: "contains" },
      h("h3", {}, "listen here"),
      h("iframe", {
        class: "bandcamp-player",
        src,
        title: `${obj.title} on Bandcamp`,
        loading: "lazy",
        seamless: "",
      }));
  }
  return null;
}

// 241000 milliseconds -> "4:01"; over an hour -> "1:02:03"
function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const h_ = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h_ ? `${h_}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Artist and label pages
// ---------------------------------------------------------------------------

export function artist(artistId) {
  const works = (data.byArtist.get(artistId) || []).slice().sort(byYearNewest);
  if (!works.length) return notFound("No releases for this artist.");
  // the artist's own name: the credit on a release where they are the only artist
  const solo = works.find((o) => o.artist_ids.length === 1 && o.kind !== "mix") ||
    works.find((o) => o.artist_ids.length === 1);
  const name = solo ? solo.artist : works[0].artist;
  const releases = works.filter((o) => o.kind !== "mix");
  const mixes = works.filter((o) => o.kind === "mix");
  const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return h(
    "section",
    { class: "page artist-page" },
    h("h1", {}, name),
    h("p", { class: "count" }, [
      releases.length ? counted(releases.length, "release", "releases") : null,
      mixes.length ? counted(mixes.length, "mix", "mixes") : null,
    ].filter(Boolean).join(" · ")),
    releases.length ? list(releases) : null,
    mixes.length ? h("h2", {}, "Mixes") : null,
    mixes.length ? list(mixes) : null,
  );
}

export function label(name) {
  const works = (data.byLabel.get(name) || []).slice().sort(byYearNewest);
  if (!works.length) return notFound("No releases for this label.");

  // where the label's releases can be heard, as one bar
  const counts = {};
  for (const o of works) counts[o.availability] = (counts[o.availability] || 0) + 1;
  const bar = h("div", { class: "bar" },
    Object.keys(availabilityText).filter((k) => counts[k]).map((k) =>
      h("span", {
        class: `seg ${k}`,
        style: `flex:${counts[k]}`,
        title: `${availabilityText[k]}: ${counts[k]} (${Math.round((100 * counts[k]) / works.length)}%)`,
      })));

  return h(
    "section",
    { class: "page" },
    h("h1", {}, name),
    h("p", { class: "count" }, `${works.length.toLocaleString("en")} releases`),
    bar,
    dotKey(),
    list(works),
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function library(params) {
  const show = params.get("show") || "all";             // all, collection, queue, mixes
  const collage = params.get("collage");
  const isMix = (i) => data.byId.get(i.id)?.kind === "mix";
  const fits = (i, s) => s === "all" || (s === "mixes" ? isMix(i) : i.status === s);
  let items = data.library.items.filter((i) => data.byId.has(i.id));
  if (show !== "all") items = items.filter((i) => fits(i, show));
  if (collage) items = items.filter((i) => i.collages.includes(collage));

  const count = (s) => data.library.items.filter((i) => data.byId.has(i.id) && fits(i, s)).length;
  const tabIcon = { collection: "collect", queue: "queue" };
  const tab = (s) => h("a", {
    class: `chip ${show === s && !collage ? "on" : ""}`,
    href: s === "all" ? "#/library" : `#/library?show=${s}`,
  }, tabIcon[s] ? mi(tabIcon[s], "small") : null, `${s} ${count(s)}`);

  return h(
    "section",
    { class: "page" },
    h("h1", {}, "Library"),
    h("div", { class: "chips" },
      tab("all"), tab("collection"), tab("queue"),
      count("mixes") ? tab("mixes") : null,
      // collages saved in Supabase (each has its own page) ...
      collageChips(),
      // ... and the library file's collages that haven't been brought in yet
      data.library.collages
        .filter((c) => !userData.collages.some((u) => u.name.toLowerCase() === c.name.toLowerCase()))
        .map((c) =>
          h("a", {
            class: `chip collage ${collage === c.name ? "on" : ""}`,
            href: `#/library?collage=${encodeURIComponent(c.name)}`,
            title: "from the library file",
          }, mi("collage", "small"), `${c.name} ${c.items.length}`)),
      newCollageChip()),
    items.length
      ? h("div", { class: "list" },
        items.map((i) => row(data.byId.get(i.id), h("span", { class: "added" }, i.added_on || ""))))
      : h("p", { class: "empty" }, "Nothing here yet. The queue and collect icons on a release's page add it to the library."),
  );
}

// One release found outside mili: cover, title, artist and year, and where it
// was found. If mili has it after all, the row links to it.
// fillIn() asks Odesli for the same release on the other platforms, starting
// from its Apple Music or Deezer link, and puts them in place of the links.
// Each release is looked up once per visit (kept in `everywhereSeen`).
const everywhereSeen = new Map();

function outsideRow(r, names) {
  const sourceLinks = (sources) => sources.map((s) =>
    h("a", { href: s.url, target: "_blank", rel: "noopener" }, `${s.name || names[s.source] || s.source} ↗`));
  const links = h("span", { class: "found-links" }, sourceLinks(r.sources));
  const start = r.sources.find((s) => s.source === "apple_music") || r.sources.find((s) => s.source === "deezer");
  const waiting = h("span", { class: "finding", hidden: true }, "…");
  // [refresh links]: ask Odesli (again) for this result, by hand
  const refresh = start ? h("button", {
    class: "bracket refresh",
    title: "look for this release on the other platforms",
    onclick: () => fillIn(true),
  }, "[refresh links]") : null;
  async function fillIn(again = false) {
    if (again) everywhereSeen.delete(start.url);
    waiting.hidden = false;
    if (refresh) { refresh.disabled = true; refresh.textContent = "[refreshing links]"; }
    if (!everywhereSeen.has(start.url)) everywhereSeen.set(start.url, findEverywhere(start.url));
    const answer = await everywhereSeen.get(start.url);
    waiting.hidden = true;
    if (refresh) { refresh.disabled = false; refresh.textContent = "[refresh links]"; }
    if (answer.error || !(answer.links || []).length) {
      everywhereSeen.delete(start.url);   // try again next time
      if (refresh) refresh.title = answer.error ? `didn't work: ${answer.error}` : "nothing more found";
      return;
    }
    // the platforms in mili's usual order, then MusicBrainz and Discogs
    const order = new Map(data.platforms.map((p) => [p.id, p.default_order ?? 99]));
    const found = answer.links.slice().sort((a, b) => (order.get(a.platform) ?? 99) - (order.get(b.platform) ?? 99));
    const catalogues = r.sources.filter((s) => s.source === "musicbrainz" || s.source === "discogs");
    links.replaceChildren(...sourceLinks([...found, ...catalogues]));
  }

  const picture = r.cover
    ? h("img", { class: "cover small", src: r.cover, alt: "", loading: "lazy" })
    : h("div", { class: "cover placeholder small" }, (r.title || "?").charAt(0).toUpperCase());
  if (picture.tagName === "IMG") {
    picture.addEventListener("error", () =>
      picture.replaceWith(h("div", { class: "cover placeholder small" }, (r.title || "?").charAt(0).toUpperCase())));
  }
  const row = h("div", { class: "row outside-row" },
    picture,
    h("div", { class: "row-text" },
      h("div", { class: "row-title" }, r.title, r.type ? h("span", { class: "badge" }, r.type) : null),
      h("div", { class: "byline" }, [r.artist, r.year].filter(Boolean).join(" · "))),
    h("div", { class: "found-in" },
      r.inMili
        ? h("a", { class: "in-mili", href: `#/release/${r.inMili}` }, "in mili →")
        : h("span", { class: "not-yet" }, "not in mili yet"),
      links,
      waiting,
      refresh));
  return { row, start, fillIn };
}

// One mix found outside mili (on Mixcloud): artwork, title, DJ, date and
// length, and a link to it. If mili has it, the row links to it.
function outsideMixRow(m) {
  const picture = m.cover
    ? h("img", { class: "cover small", src: m.cover, alt: "", loading: "lazy" })
    : h("div", { class: "cover placeholder small" }, (m.title || "?").charAt(0).toUpperCase());
  if (picture.tagName === "IMG") {
    picture.addEventListener("error", () =>
      picture.replaceWith(h("div", { class: "cover placeholder small" }, (m.title || "?").charAt(0).toUpperCase())));
  }
  return h("div", { class: "row outside-row" },
    picture,
    h("div", { class: "row-text" },
      h("div", { class: "row-title" }, m.title, h("span", { class: "badge" }, "mix")),
      h("div", { class: "byline" }, [m.artist, mixDate(m.date), mixLength(m.length)].filter(Boolean).join(" · "))),
    h("div", { class: "found-in" },
      m.inMili
        ? h("a", { class: "in-mili", href: `#/release/${m.inMili}` }, "in mili →")
        : h("span", { class: "not-yet" }, "not in mili yet"),
      h("span", { class: "found-links" },
        (m.links || []).map((l) => h("a", { href: l.url, target: "_blank", rel: "noopener" }, `${l.name} ↗`)))));
}

// The labels as a grid of pictures. Uses labels.json (your order, with
// pictures) when the export has it, otherwise the label names A to Z.
function labelGrid() {
  const labels = data.labelInfo?.length
    ? data.labelInfo.filter((l) => data.byLabel.has(l.name))
    : data.labels.map((name) => ({ name, image: null }));
  return h("div", { class: "label-grid" },
    labels.map((label) => {
      const count = data.byLabel.get(label.name)?.length || 0;
      const letter = h("span", { class: "label-letter" }, label.name.replace(/^the /i, "").charAt(0).toUpperCase());
      const picture = label.image
        ? h("img", {
          src: label.image,
          alt: "",
          loading: "lazy",
          // if the picture can't be loaded, show the first letter instead
          onerror: (event) => event.target.replaceWith(letter),
        })
        : letter;
      return h("a", {
        class: "label-tile",
        href: `#/label/${encodeURIComponent(label.name)}`,
        title: `${label.name} · ${count.toLocaleString("en")} releases`,
      },
      h("span", { class: "label-picture" }, picture),
      h("span", { class: "label-name" }, label.name));
    }));
}

// ---------------------------------------------------------------------------
// Settings: dark or light, and the accent colour (kept in this browser)
// ---------------------------------------------------------------------------

export function settings() {
  const theme = readTheme();
  const prefs = readPrefs();
  const toggle = (on, label, onchange) => {
    const button = h("button", {
      "aria-pressed": String(on),
      "aria-label": label,
      onclick: () => {
        const now = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(now));
        onchange(now);
      },
    });
    return h("div", { class: "toggle" }, button, label);
  };
  const section = (title, small, open, ...content) =>
    h("details", { class: "setting-group", open },
      h("summary", {}, title, small ? h("small", {}, small) : null), ...content);

  // global: dark or light, and the accent
  const picker = h("input", { type: "color", value: theme.accent, "aria-label": "accent colour" });
  const hex = h("input", { type: "text", value: theme.accent, spellcheck: "false", "aria-label": "accent colour as hex" });
  const setAccent = (value) => {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    theme.accent = value.toLowerCase();
    picker.value = theme.accent;
    hex.value = theme.accent;
    saveTheme(theme);
  };
  picker.addEventListener("input", () => setAccent(picker.value));
  hex.addEventListener("change", () => setAccent(hex.value.trim()));

  // listen services: which platforms release pages show
  const hidden = new Set(prefs.hiddenServices || []);
  const services = data.platforms.filter((pl) => pl.listen && pl.for_releases !== false);
  const serviceList = h("div", { class: "services" }, services.map((pl) => toggle(!hidden.has(pl.id), pl.name, (on) => {
    if (on) hidden.delete(pl.id); else hidden.add(pl.id);
    savePrefs({ hiddenServices: [...hidden] });
  })));

  // account: sign in to write notes and make collages
  const account = accountSection(section);

  // the library file's collages, brought into your account (signed in only)
  // (only while some of them, or some of what's in them, aren't in your collages yet)
  const yours = userData.collages.filter((c) => c.owner === me()?.id);
  const notYetIn = (data.library.collages || []).filter((f) => {
    const twin = yours.find((c) => c.name.toLowerCase() === f.name.toLowerCase());
    return !twin || f.items.some((id) => data.byId.has(id) && !twin.items.includes(id));
  });
  const fileCollages = notYetIn.length;
  const bringIn = canSave() && me() && fileCollages
    ? h("button", { class: "bracket" }, `[bring in the ${plural(fileCollages, "collage", "collages")} from the library file]`)
    : null;
  bringIn?.addEventListener("click", async () => {
    bringIn.disabled = true;
    bringIn.textContent = "[bringing them in…]";
    try {
      const { made, added } = await bringInFileCollages();
      bringIn.textContent = `[done: ${plural(made, "new collage", "new collages")}, ${plural(added, "item", "items")} added]`;
    } catch (error) {
      bringIn.textContent = `[didn't work: ${error.message}]`;
      bringIn.disabled = false;
    }
  });

  // library: counts and export
  const items = data.library.items.filter((i) => data.byId.has(i.id));
  const inCollection = items.filter((i) => i.status === "collection").length;

  return h(
    "section",
    { class: "page settings" },
    h("h1", {}, "settings"),
    account,
    section("global", "appearance · theme · accent", true,
      toggle(theme.dark, "dark mode", (on) => { theme.dark = on; saveTheme(theme); }),
      h("p", { class: "help" }, "The accent worn by lit library glyphs and the active filter chip."),
      h("div", { class: "accent-row" },
        picker, hex,
        h("button", { class: "plain-button", onclick: () => setAccent(DEFAULT_ACCENT) }, "reset to default")),
      h("div", { class: "preview" }, "preview", mi("collect"), h("span", { class: "chip on" }, "active"))),
    section("home", null, true,
      toggle(prefs.gettingStarted !== false, "show getting started", (on) => savePrefs({ gettingStarted: on })),
      h("p", { class: "help" }, "The getting-started section on home stays visible until you hide it here.")),
    section("listen services", null, false,
      h("p", { class: "help" }, "The platforms release pages show. Hidden ones are still in mili, just not shown."),
      serviceList),
    section("library", null, false,
      h("p", { class: "help" }, `${inCollection} in the collection · ${items.length - inCollection} in the queue.`),
      h("p", { class: "help" }, "Download the library. JSON keeps everything (status, dates, collages, labels, mili IDs); CSV opens in a spreadsheet."),
      h("p", { class: "exports" },
        h("button", { class: "bracket", onclick: () => exportLibrary("json") }, "[export json]"),
        h("button", { class: "bracket", onclick: () => exportLibrary("csv") }, "[export csv]")),
      bringIn ? h("p", { class: "help" }, "Collages are saved in your account now. The ones in the library file can be brought in once; after that, make and change them on the site.") : null,
      bringIn ? h("p", { class: "exports" }, bringIn) : null),
    section("garden", null, false,
      h("p", { class: "help" }, me()
        ? "Your garden is saved to your account, so it's the same on every device."
        : "Not signed in, the garden is kept in this browser."),
      h("p", { class: "help" }, "“save” on the garden page downloads it as garden.json (with that file in site/data/, the published site shows it to visitors), and “start over” clears it; undo brings it back."),
      h("p", { class: "exports" }, h("a", { class: "bracket", href: "#/garden" }, "[open the garden]"))),
    section("data", "where it comes from", false,
      h("p", { class: "help" },
        `${data.index.length.toLocaleString("en")} objects · data from ${data.meta.exported_at?.slice(0, 10) || "?"}`),
      (data.meta.sources || []).map((source) => h("p", { class: "help" }, source))),
    h("p", { class: "meta" }, "Settings are kept in this browser."),
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Settings → account: signing in with the email and password made in the
// Supabase dashboard. Only shown when the live database is set up.
function accountSection(section) {
  if (!canSave()) return null;
  const user = me();
  if (user) {
    const out = h("button", { class: "bracket" }, "[sign out]");
    out.addEventListener("click", async () => { out.disabled = true; await signOut(); });
    return section("account", "signed in", false,
      h("p", { class: "help" }, user.guest
        ? "Signed in as a guest, trying the beta. Your notes and collages are saved to a guest account that belongs to this browser: logging out ends it."
        : `Signed in as ${user.email}. Notes and collages you make are saved to this account.`),
      h("p", { class: "exports" }, out));
  }
  return section("account", "not signed in", true,
    h("p", { class: "help" }, "Sign in to write notes and make collages. Without signing in you can still read the public ones."),
    h("p", { class: "exports" }, h("a", { class: "bracket", href: `#/sign-in?back=${encodeURIComponent("#/settings")}` }, "[sign in]")));
}

function download(name, text, type) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function exportLibrary(format) {
  const base = `${location.origin}${location.pathname}`;
  const rows = data.library.items.filter((i) => data.byId.has(i.id)).map((i) => {
    const o = data.byId.get(i.id);
    return {
      mili_id: o.id, title: o.title, artist: o.artist || "", year: o.year || "", type: o.type || "",
      labels: (o.labels || []).join("; "), status: i.status, added_on: i.added_on || "",
      collages: [...new Set([...(i.collages || []), ...collagesWith(o.id).map((c) => c.name)])].join("; "),
      page: `${base}#/release/${o.id}`,
    };
  });
  if (format === "json") {
    download("mili-library.json", JSON.stringify({ exported_at: new Date().toISOString(), items: rows }, null, 1), "application/json");
  } else {
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const columns = Object.keys(rows[0] || { mili_id: "" });
    const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
    download("mili-library.csv", csv, "text/csv");
  }
}

// ---------------------------------------------------------------------------
// The guide: how mili works, in folding sections
// ---------------------------------------------------------------------------

// #/sign-in: the word "mili" in dots, email and password, "try the beta"
// (a guest account, for friends trying mili), and "what is mili". It's also
// the front page when no one is signed in. After signing in, it goes back to
// the page you came from (?back=…).
export function signInPage(params) {
  const back = params.get("back") || "#/";
  const page = h("section", { class: "page sign-in-page" },
    h("a", { href: "#/", class: "sign-in-word", "aria-label": "mili" }, mi("wordmark")));
  const links = h("p", { class: "sign-in-links" }, h("a", { href: "#/about" }, "what is mili"));

  if (!canSave()) {
    page.append(h("p", { class: "help" }, "Signing in needs the live database (supabase.json)."), links);
    return page;
  }
  const user = me();
  if (user) {
    const out = h("button", { class: "note-button" }, "sign out");
    out.addEventListener("click", async () => { out.disabled = true; await signOut(); });
    page.append(
      h("p", { class: "help" }, user.guest ? "Signed in as a guest, trying the beta." : `Signed in as ${user.email}.`),
      h("div", { class: "note-row" }, out, h("a", { class: "note-button", href: back }, "go back")),
      links);
    return page;
  }

  const email = h("input", { class: "field", id: "sign-in-email", type: "email", autocomplete: "username", spellcheck: "false" });
  const password = h("input", { class: "field", id: "sign-in-password", type: "password", autocomplete: "current-password" });
  const go = h("button", { class: "note-button", type: "submit", disabled: true }, "sign in");
  const problem = h("p", { class: "note-meta sign-in-problem" });
  const beta = h("button", { class: "note-button beta", type: "button" }, "try the beta");
  beta.addEventListener("click", async () => {
    beta.disabled = true;
    problem.textContent = "making a guest account…";
    try {
      await signInAsGuest();
      location.hash = back;
    } catch (error) {
      problem.textContent = error.message;
      beta.disabled = false;
    }
  });
  const ready = () => { go.disabled = !(email.value.trim() && password.value); };
  email.addEventListener("input", ready);
  password.addEventListener("input", ready);
  const form = h("form", { class: "sign-in" },
    h("label", { for: "sign-in-email" }, "email"), email,
    h("label", { for: "sign-in-password" }, "password"), password,
    go, beta, problem);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    problem.textContent = "signing in…";
    try {
      await signIn(email.value, password.value);
      location.hash = back;
    } catch (error) {
      problem.textContent = /invalid login/i.test(error.message) ? "that email and password don't match" : error.message;
      ready();
    }
  });
  page.append(form, links);
  return page;
}

// #/about: "what is mili", written in site/about.md
export async function aboutPage() {
  let text = "";
  try {
    const response = await fetch("about.md", { cache: "no-store" });
    if (response.ok) text = await response.text();
  } catch { /* shown as empty below */ }
  return h("section", { class: "page about" }, ...(text.trim() ? markdown(text) : [h("p", { class: "empty" }, "Nothing written here yet.")]));
}

// A small part of Markdown, enough for the about page: headings (# and ##),
// paragraphs, lists (- ), links [words](https://…) and **bold**. Built as
// elements, not pasted in as HTML.
function markdown(text) {
  const inline = (line) => {
    const parts = [];
    const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0;
    for (const found of line.matchAll(pattern)) {
      parts.push(line.slice(last, found.index));
      if (found[1]) {
        const external = /^https?:/i.test(found[2]);
        parts.push(h("a", { href: found[2], target: external ? "_blank" : null, rel: external ? "noopener" : null }, found[1]));
      } else {
        parts.push(h("b", {}, found[3]));
      }
      last = found.index + found[0].length;
    }
    parts.push(line.slice(last));
    return parts;
  };
  const blocks = [];
  for (const chunk of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*- /.test(l))) {
      blocks.push(h("ul", {}, lines.map((l) => h("li", {}, inline(l.replace(/^\s*- /, ""))))));
    } else if (/^## /.test(lines[0])) {
      blocks.push(h("h2", {}, inline(lines[0].slice(3))));
      if (lines.length > 1) blocks.push(h("p", {}, inline(lines.slice(1).join(" "))));
    } else if (/^# /.test(lines[0])) {
      blocks.push(h("h1", {}, inline(lines[0].slice(2))));
      if (lines.length > 1) blocks.push(h("p", {}, inline(lines.slice(1).join(" "))));
    } else {
      blocks.push(h("p", {}, inline(lines.join(" "))));
    }
  }
  return blocks;
}

export function guide() {
  const part = (title, ...paragraphs) =>
    h("details", { class: "guide-part" }, h("summary", {}, title), ...paragraphs.map((t) => h("p", {}, t)));
  return h("section", { class: "page guide" },
    h("h1", {}, "guide"),
    part("searching",
      ["Press ", h("kbd", {}, "/"), " anywhere, or the ", mi("plus", "inline"), " in the top bar, to open the search box. Type a title, an artist or a label: mili searches its catalogue as you type, and finds near-misses too, so a typo still lands."],
      "“search everything” opens a page of results that also looks outside mili: releases on MusicBrainz, Apple Music, Deezer and Discogs, and mixes on Mixcloud, where NTS keeps its shows too. The top releases there fill in every platform they can be heard on.",
      "Paste a link from Bandcamp, Spotify, Apple Music, Deezer, Tidal, Discogs, MusicBrainz, YouTube, SoundCloud, Mixcloud or NTS to go straight to it. If mili doesn't have it, the box shows what it is and where else it can be heard."),
    part("release pages",
      "Under the title: the artist, the year and the label, from MusicBrainz, or from Apple Music for releases MusicBrainz doesn't know.",
      "Then where the release can be heard, one link per platform: the first three, and “…” for the rest. A small note like “deluxe edition” means the link goes to another version of the same release.",
      ["[buy] opens Bandcamp and Discogs. [refresh links], behind the “…”, asks for the release on platforms mili doesn't know yet; new ones are marked “new”."],
      "“contains” lists the songs, from MusicBrainz or Apple Music. Releases without a list of songs have Bandcamp's own small player instead."),
    part("queue and collection",
      ["The library has two parts: the queue ", mi("queue", "inline"), ", for what you want to hear, and the collection ", mi("collect", "inline"), ", for what you have. This library is built from a Bandcamp collection: purchases are in the collection, the wishlist is the queue."],
      "On a release or mix page, the same two icons put it in the queue or the collection, or take it out again. That's saved to your account: everyone starts from this library, and what each person changes stays their own.",
      "The library page switches between them, and collages group releases across both."),
    part("mixes",
      "A DJ mix or radio show from SoundCloud, Mixcloud or NTS is kept like a release, marked “mix”. Its page has the date, the length and the platform's own player, and it sits on the DJ's artist page under their releases.",
      "Mixes join the library too, and the library has a “mixes” filter. The DJ is read from the uploader or the title (“Call Super - 12th March 2025” on NTS Radio is Call Super's); a DJ mili doesn't know yet gets a page of their own."),
    part("notes and collages",
      ["The pencil ", mi("note", "inline"), " on a release, a mix or a collage opens its notes. Write anything, then save. A note starts private, so only you see it; click “private” to make it public."],
      ["The collage icon ", mi("collage", "inline"), " on a page adds it to one of your collages, or starts a new one. A collage is a list of releases and mixes, like a channel on Are.na, with a page and a note of its own. Collages start public; [edit] on a collage renames it, makes it private, or deletes it."],
      "Writing needs a sign-in (the menu → sign in). Your profile, in the same menu, lists your collages and every note you've written. Without signing in, you can still read the public notes and collages."),
    part("rotation",
      ["The rotation icon ", mi("rotation", "inline"), " on a release or mix page puts it on rotation: its cover sits in the top bar, and in “rotation” at the top of the front page, until you click the icon again to take it off. It's saved to your account."],
      "Opening a listen link from mili also “waters” the release, which makes its plant grow in the garden."),
    part("labels",
      "The catalogue starts from 20 labels: every release MusicBrainz knows on each, plus what's on the labels' own Bandcamp pages. A label's page shows how much of it can be heard where."),
    part("atlas",
      ["One release sits in the middle of the atlas ", mi("network", "inline"), " with three rings around it: the same artist, the same label or Bandcamp page, and what was added near the same time (or, outside the library, released the same year). Click a dot to move it to the middle; the trail remembers the way back."],
      "Keys: ← → within a ring, ↑ ↓ between rings, enter to recentre, ⌫ to walk back."),
    part("garden",
      ["Plant the library in the garden ", mi("garden", "inline"), ": drag releases up from the tray onto the ground, and shape the ground with ridges, pools, paths, rings, marks, words and drawn outlines."],
      "A plant's family comes from the release's genre: ambient is a fern, techno a crystal, jazz a climber. It grows each time you listen to the release from mili, blooms when you've listened in the last 30 days, and fades when it's left alone for half a year. Ridges are stone, pools moss, outlines loam, rings clay, paths sand; on the ground its species likes, a plant grows a little bigger.",
      "Click a plant to change its species, colours or variation, to water it, or to move or uproot it. “save” downloads the garden as a file; settings has the same, and a way to start over."),
    part("keyboard",
      ["/ or ⌘K: search · ↑ ↓ and enter in the search box · esc closes · ⌘↵ saves a note · in the atlas ← → ↑ ↓ enter ⌫ · in the garden ⌘Z undoes."]),
  );
}

// ---------------------------------------------------------------------------

export function comingSoon(name) {
  return h("section", { class: "page" }, h("h1", {}, name), h("p", { class: "muted" }, "Coming next."));
}

export function notFound(message) {
  return h("section", { class: "page" }, h("p", { class: "empty" }, message), h("a", { href: "#/" }, "← back"));
}
