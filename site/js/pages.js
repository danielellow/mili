// mili: the pages. Each function returns what goes into <main>.

import { data, getObject, searchLive, sameArtist, water, inRotation } from "./data.js";
import { h, mi, cover, byline, list, row, dotKey, availabilityText, availabilityDot } from "./ui.js";
import { readTheme, saveTheme, DEFAULT_ACCENT } from "./theme.js";

const byYearNewest = (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);

// ---------------------------------------------------------------------------
// Home and search
// ---------------------------------------------------------------------------

export function home(query) {
  const results = h("div", { class: "results" });

  // results under the search box, updated as you type (the box keeps its focus)
  let latest = 0;
  async function showResults(q) {
    const ticket = ++latest;
    if (!q) {
      results.replaceChildren(overview());
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
    results.replaceChildren(
      h("p", { class: "count" }, count, h("span", { class: `source ${source}` }, where)),
      list(found, ""),
    );
  }

  let typing;
  const box = h("input", {
    class: "search",
    type: "search",
    placeholder: "find title, artist or label…",
    autocomplete: "off",
    spellcheck: "false",
    value: query,
    oninput: (event) => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        const q = event.target.value.trim();
        history.replaceState(null, "", q ? `#/?q=${encodeURIComponent(q)}` : "#/");
        showResults(q);
      }, 180);
    },
  });
  setTimeout(() => box.focus(), 0);

  function overview() {
    const recent = data.library.items.slice(0, 8).map((i) => data.byId.get(i.id)).filter(Boolean);
    return h("div", {},
      recent.length ? h("h2", {}, "Recently added to the library") : null,
      recent.length ? list(recent) : null,
      recent.length ? h("p", { class: "count" }, h("a", { href: "#/library" }, `the whole library (${data.library.items.length}) →`)) : null,
      h("h2", {}, "Labels"),
      labelGrid(),
    );
  }

  showResults(query);
  return h("section", { class: "page home" }, box, results);
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
  for (const link of obj.listen) {
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
  listen.append(h("span", {
    class: "bracket muted",
    title: "Looking for new links needs a small server. Coming after the course.",
  }, "[refresh links]…"));

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
  const toggle = h("button", {
    "aria-pressed": String(theme.dark),
    "aria-label": "dark mode",
    onclick: () => {
      theme.dark = !theme.dark;
      toggle.setAttribute("aria-pressed", String(theme.dark));
      saveTheme(theme);
    },
  });
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

  return h(
    "section",
    { class: "page" },
    h("h1", {}, "settings"),
    h("div", { class: "setting-group" },
      h("h3", {}, "global", h("small", {}, "appearance · theme · accent")),
      h("div", { class: "toggle" }, toggle, "dark mode"),
      h("p", { class: "help" }, "The accent worn by lit library glyphs and the active filter chip."),
      h("div", { class: "accent-row" },
        picker, hex,
        h("button", { class: "plain-button", onclick: () => setAccent(DEFAULT_ACCENT) }, "reset to default")),
      h("div", { class: "preview" }, "preview", mi("collect"), h("span", { class: "chip on" }, "active"))),
    h("p", { class: "meta" }, "These are kept in this browser."),
    h("div", { class: "setting-group" },
      h("h3", {}, "data", h("small", {}, "where it comes from")),
      h("p", { class: "meta" },
        `${data.index.length.toLocaleString("en")} objects · data from ${data.meta.exported_at?.slice(0, 10) || "?"}`),
      (data.meta.sources || []).map((source) => h("p", { class: "meta" }, source))),
  );
}

// ---------------------------------------------------------------------------

export function comingSoon(name) {
  return h("section", { class: "page" }, h("h1", {}, name), h("p", { class: "muted" }, "Coming next."));
}

export function notFound(message) {
  return h("section", { class: "page" }, h("p", { class: "empty" }, message), h("a", { href: "#/" }, "← back"));
}
