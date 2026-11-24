// mili: the pages. Each function returns what goes into <main>.

import { data, getObject, search, sameArtist, water, inRotation } from "./data.js";
import { h, mi, cover, byline, list, row, dotKey, availabilityText, availabilityDot } from "./ui.js";

const byYearNewest = (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);

// ---------------------------------------------------------------------------
// Home and search
// ---------------------------------------------------------------------------

export function home(query) {
  if (query) {
    const { total, results } = search(query);
    return h(
      "section",
      { class: "page" },
      h("p", { class: "count" },
        total === 0 ? `Nothing found for “${query}”.`
          : total > results.length ? `${total.toLocaleString("en")} found · showing the first ${results.length}`
            : `${total.toLocaleString("en")} found`),
      list(results, ""),
    );
  }

  const releases = data.index.filter((o) => o.kind === "release").length;
  const recent = data.library.items.slice(0, 8).map((i) => data.byId.get(i.id)).filter(Boolean);
  return h(
    "section",
    { class: "page home" },
    h("p", { class: "intro" },
      `A music library outside any platform. ${releases.toLocaleString("en")} releases from ${data.labels.length} labels, `,
      "each one an object that points to everywhere it can be heard or bought."),
    recent.length ? h("h2", {}, "Recently added to the library") : null,
    recent.length ? list(recent) : null,
    recent.length ? h("p", {}, h("a", { href: "#/library" }, `the whole library (${data.library.items.length}) →`)) : null,
    h("h2", {}, "Labels"),
    h("div", { class: "labels" },
      data.labels.map((label) =>
        h("a", { href: `#/label/${encodeURIComponent(label)}` },
          label, h("span", { class: "n" }, data.byLabel.get(label).length.toLocaleString("en"))))),
  );
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

// ---------------------------------------------------------------------------

export function comingSoon(name) {
  return h("section", { class: "page" }, h("h1", {}, name), h("p", { class: "muted" }, "Coming next."));
}

export function notFound(message) {
  return h("section", { class: "page" }, h("p", { class: "empty" }, message), h("a", { href: "#/" }, "← back"));
}
