// mili: the pages. Each function returns what goes into <main>.

import { data, getObject, searchLive, searchOutside, findEverywhere, sameArtist, water, inRotation } from "./data.js";
import { h, mi, cover, byline, list, row, dotKey, availabilityText, availabilityDot } from "./ui.js";
import { readTheme, saveTheme, DEFAULT_ACCENT } from "./theme.js";
import { openPalette } from "./palette.js";

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
    const names = { musicbrainz: "MusicBrainz", apple_music: "Apple Music", deezer: "Deezer", discogs: "Discogs" };
    const status = Object.entries(answer.sources || {}).map(([name, s]) =>
      s.error ? `${names[name] || name}: ${s.error}` : `${names[name] || name} ${s.found}`).join(" · ");
    const shown = (answer.results || []).map((r) => outsideRow(r, names));
    box.replaceChildren(
      h("h2", {}, "Outside mili"),
      h("p", { class: "count" },
        shown.length ? `${shown.length} found online` : `Nothing found online for “${q}”.`,
        h("span", { class: "source" }, `${status} · ${answer.ms} ms`)),
      shown.length ? h("div", { class: "list" }, shown.map((s) => s.row)) : null,
    );
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
    gettingStarted(),
    recent.length ? h("h2", {}, "Recently added to the library") : null,
    recent.length ? list(recent) : null,
    recent.length ? h("p", { class: "count" }, h("a", { href: "#/library" }, `the whole library (${data.library.items.length}) →`)) : null,
    h("h2", { id: "labels" }, "Labels"),
    labelGrid());
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
      go("#/library?show=collection", "collection"), " ", icon("collect"), ". This one is built from a Bandcamp collection."),
    h("li", {}, "listening from mili puts a release ", go("#/guide", "on rotation"), " ", icon("rotation"),
      " for 30 days, and waters its plant in the garden."),
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

  const item = data.inLibrary.get(id);

  // the row of listen links, in the platforms' order
  const listen = h("div", { class: "links" });
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
  listen.append(refreshLinks(obj, listen));

  // the icons: queue and collection (from the library), rotation (opened from
  // mili in the last 30 days, in this browser), and the atlas
  const rotating = inRotation(id);
  const actions = h(
    "div",
    { class: "actions" },
    h("span", { class: `act ${item && item.status === "queue" ? "on" : ""}`,
      title: item && item.status === "queue" ? "in the queue" : "not in the queue" }, mi("queue")),
    h("span", { class: `act ${item && item.status === "collection" ? "on" : ""}`,
      title: item && item.status === "collection" ? "in the collection" : "not in the collection" }, mi("collect")),
    h("span", { class: `act ${rotating ? "on" : ""}`,
      title: rotating ? "in rotation: opened from mili in the last 30 days" : "not in rotation" }, mi("rotation")),
    h("a", { class: "act", href: `#/atlas/${id}`, title: "see it in the atlas" }, mi("network")),
  );

  // "2 versions · Wind (Deluxe Version)"
  const others = obj.versions.filter((v) => !v.main);
  const versions = obj.versions_total > 1
    ? h("p", { class: "versions" },
      h("span", { class: "muted" }, `${obj.versions_total} versions · `),
      others.map((v, i) => [i ? h("span", { class: "muted" }, " · ") : null, v.title]))
    : null;

  const libraryLine = item
    ? h("p", { class: "meta" },
      `added ${item.added_on || "(no date)"} · ${item.status}`,
      item.collages.length ? ` · ${item.collages.join(", ")}` : "")
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
        listen,
        actions,
      ),
    ),
    contains(obj),
    versions,
    libraryLine,
    h("p", { class: "meta" },
      availabilityDot(obj), " ", availabilityText[obj.availability] || "",
      obj.genres.length ? ` · ${obj.genres.join(", ")}` : "",
      " · mili ", h("code", {}, obj.id),
      " · ", h("a", { href: `#/garden?focus=${id}` }, "find it in the garden →")),
    more.length ? h("h2", {}, `More by ${obj.artist}`) : null,
    more.length ? list(more) : null,
  );
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
      button.textContent = fresh.length ? `[${fresh.length} new]` : "[nothing new]";
      button.title = "refreshed just now";
    },
  }, "[refresh links]");
  return button;
}

// "contains 8": the songs on a release, each with the cover, title and artist,
// and the length on the right. Releases with more than one disc get a small
// "disc 2" between the discs. Releases without a track list of their own, but
// with a Bandcamp ID, show Bandcamp's official embedded player instead.
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
    // Bandcamp's player, in the site's colours; an album gets its track list
    const theme = readTheme();
    const isAlbum = obj.bandcamp_player.startsWith("album=");
    const src = "https://bandcamp.com/EmbeddedPlayer/" + [
      obj.bandcamp_player,
      "size=large",
      `bgcol=${theme.dark ? "0b0b0b" : "ffffff"}`,
      `linkcol=${theme.accent.replace("#", "")}`,
      "artwork=none",
      `tracklist=${isAlbum}`,
      "transparent=true",
    ].join("/") + "/";
    return h("div", { class: "contains" },
      h("h3", {}, "contains"),
      h("iframe", {
        class: `bandcamp-player ${isAlbum ? "player-album" : "player-track"}`,
        src,
        title: `${obj.title} on Bandcamp`,
        loading: "lazy",
        seamless: "",
      }),
      h("p", { class: "player-note" }, "Bandcamp's own player: the songs come straight from Bandcamp"));
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
  const solo = works.find((o) => o.artist_ids.length === 1);
  const name = solo ? solo.artist : works[0].artist;
  return h(
    "section",
    { class: "page" },
    h("h1", {}, name),
    h("p", { class: "count" }, `${works.length} release${works.length === 1 ? "" : "s"}, also with others`),
    list(works),
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
  const show = params.get("show") || "all";             // all, collection, queue
  const collage = params.get("collage");
  let items = data.library.items.filter((i) => data.byId.has(i.id));
  if (show !== "all") items = items.filter((i) => i.status === show);
  if (collage) items = items.filter((i) => i.collages.includes(collage));

  const count = (s) => data.library.items.filter((i) => s === "all" || i.status === s).length;
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
      data.library.collages.map((c) =>
        h("a", {
          class: `chip collage ${collage === c.name ? "on" : ""}`,
          href: `#/library?collage=${encodeURIComponent(c.name)}`,
        }, mi("collage", "small"), `${c.name} ${c.items.length}`))),
    items.length
      ? h("div", { class: "list" },
        items.map((i) => row(data.byId.get(i.id), h("span", { class: "added" }, i.added_on || ""))))
      : h("p", { class: "empty" }, "The library is empty. Add releases to seeds/library.csv and run the export again."),
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

  // library: counts and export
  const items = data.library.items.filter((i) => data.byId.has(i.id));
  const inCollection = items.filter((i) => i.status === "collection").length;

  // garden: save or start over
  let garden = { plants: {}, marks: [] };
  try { garden = JSON.parse(localStorage.getItem("mili.garden") || "null") || garden; } catch { /* none */ }
  const planted = Object.keys(garden.plants || {}).length;
  const startOver = h("button", {
    class: "bracket",
    onclick: () => {
      if (startOver.dataset.sure) {
        try { localStorage.removeItem("mili.garden"); } catch { /* storage off */ }
        startOver.textContent = "[the garden starts over]";
        startOver.disabled = true;
      } else {
        startOver.dataset.sure = "yes";
        startOver.textContent = "[really? click again to start over]";
      }
    },
  }, "[start over]");

  return h(
    "section",
    { class: "page settings" },
    h("h1", {}, "settings"),
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
        h("button", { class: "bracket", onclick: () => exportLibrary("csv") }, "[export csv]"))),
    section("garden", null, false,
      h("p", { class: "help" }, `${planted} planted · ${(garden.marks || []).length} ground marks, kept in this browser.`),
      h("p", { class: "help" }, "Save downloads the garden as garden.json; with that file in site/data/ the published site shows it."),
      h("p", { class: "exports" },
        h("button", { class: "bracket", onclick: () => download("garden.json", JSON.stringify({ saved_at: new Date().toISOString(), ...garden }, null, 1), "application/json") }, "[save garden.json]"),
        startOver)),
    section("data", "where it comes from", false,
      h("p", { class: "help" },
        `${data.index.length.toLocaleString("en")} objects · data from ${data.meta.exported_at?.slice(0, 10) || "?"}`),
      (data.meta.sources || []).map((source) => h("p", { class: "help" }, source))),
    h("p", { class: "meta" }, "Settings are kept in this browser."),
  );
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
      collages: (i.collages || []).join("; "), page: `${base}#/release/${o.id}`,
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

export function guide() {
  const part = (title, ...paragraphs) =>
    h("details", { class: "guide-part" }, h("summary", {}, title), ...paragraphs.map((t) => h("p", {}, t)));
  return h("section", { class: "page guide" },
    h("h1", {}, "guide"),
    part("searching",
      ["Press ", h("kbd", {}, "/"), " anywhere, or the ", mi("plus", "inline"), " in the top bar, to open the search box. Type a title, an artist or a label: mili searches its catalogue as you type, and finds near-misses too, so a typo still lands."],
      "“search everything” opens a page of results that also looks outside mili, on MusicBrainz, Apple Music, Deezer and Discogs. The top results there fill in every platform they can be heard on.",
      "Paste a link from Bandcamp, Spotify, Apple Music, Deezer, Tidal, Discogs, MusicBrainz or YouTube to go straight to that release. If mili doesn't have it, the box shows what it is and where else it can be heard."),
    part("release pages",
      "The links under the title are where the release can be heard, one per platform. A small note like “deluxe edition” means the link goes to another version of the same release.",
      ["[buy] opens Bandcamp and Discogs. [refresh links] asks for the release on platforms mili doesn't know yet; new ones are marked “new”."],
      "“contains” lists the songs, from MusicBrainz or Apple Music. Releases that only exist on Bandcamp show Bandcamp's own player instead.",
      "The dot at the bottom tells where it can be heard: on Bandcamp and streaming, streaming only, Bandcamp only, or nowhere mili has found yet."),
    part("queue and collection",
      ["The library has two parts: the queue ", mi("queue", "inline"), ", for what you want to hear, and the collection ", mi("collect", "inline"), ", for what you have. This library is built from a Bandcamp collection: purchases are in the collection, the wishlist is the queue."],
      "The library page switches between them, and collages group releases across both."),
    part("rotation",
      ["Opening a listen link from mili “waters” the release. Anything watered in the last 30 days is on rotation ", mi("rotation", "inline"), ", lit on its page. The counts are kept in this browser."]),
    part("labels",
      "The catalogue starts from 20 labels: every release MusicBrainz knows on each, plus what's on the labels' own Bandcamp pages. A label's page shows how much of it can be heard where."),
    part("atlas",
      ["One release sits in the middle of the atlas ", mi("network", "inline"), " with three rings around it: the same artist, the same label or Bandcamp page, and what was added near the same time (or, outside the library, released the same year). Click a dot to move it to the middle; the trail remembers the way back."],
      "Keys: ← → within a ring, ↑ ↓ between rings, enter to recentre, ⌫ to walk back."),
    part("garden",
      ["Plant the library in the garden ", mi("garden", "inline"), ": drag releases up from the tray onto the ground, and shape the ground with ridges, pools, paths, rings, marks, words and drawn outlines."],
      "A plant's family comes from the release's genre: ambient is a fern, techno a crystal, jazz a climber. It grows each time you listen to the release from mili, blooms while it's on rotation, and fades when it's left alone for half a year. Ridges are stone, pools moss, outlines loam, rings clay, paths sand; on the ground its species likes, a plant grows a little bigger.",
      "Click a plant to change its species, colours or variation, to water it, or to move or uproot it. “save” downloads the garden as a file; settings has the same, and a way to start over."),
    part("keyboard",
      ["/ or ⌘K: search · ↑ ↓ and enter in the search box · esc closes · in the atlas ← → ↑ ↓ enter ⌫ · in the garden ⌘Z undoes."]),
  );
}

// ---------------------------------------------------------------------------

export function comingSoon(name) {
  return h("section", { class: "page" }, h("h1", {}, name), h("p", { class: "muted" }, "Coming next."));
}

export function notFound(message) {
  return h("section", { class: "page" }, h("p", { class: "empty" }, message), h("a", { href: "#/" }, "← back"));
}
