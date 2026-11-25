// mili: the atlas. One release (or mix) in the middle, and around it three
// rings of things that relate to it:
//
//   ring 1  same artist           MusicBrainz artist IDs, or the artist names
//                                 (so collaborations connect to both artists)
//   ring 2  same label or page    a label from the catalogue, or the same
//                                 Bandcamp page (a small label or an artist's own)
//   ring 3  added near            in your library: added within 14 days of it;
//                                 outside your library: released the same year
//
// Something that relates in several ways sits in the innermost ring it belongs
// to, marked with ″. Each ring shows 16 at a time, the most recently added first.
// Click a dot to put it in the middle; the trail remembers where you've been.
// Keys: ← → within a ring, ↑ ↓ between rings, enter to recenter, ⌫ to walk back.

import { data, normalize } from "./data.js";
import { h, cover } from "./ui.js";

const PAGE = 16;
const NEAR_DAYS = 14;
const RADII = [180, 290, 400];
const CENTER = 500;
const SVG_NS = "http://www.w3.org/2000/svg";
const GAP_AT = -Math.PI / 4;      // the ring tags sit here, upper right
const GAP = 0.95;                 // how wide the empty wedge is (radians)

// ---------------------------------------------------------------------------
// How things relate
// ---------------------------------------------------------------------------

const keyCache = new Map();

// every way of naming the artist(s): MusicBrainz IDs, and each name in the credit
function artistKeys(obj) {
  if (keyCache.has(obj.id)) return keyCache.get(obj.id);
  const keys = new Set((obj.artist_ids || []).map((id) => `id:${id}`));
  for (const part of (obj.artist || "").split(/\s*,\s*|\s+(?:&|\/|\+|x|feat\.?|featuring|ft\.|vs\.?|with|and)\s+/i)) {
    const name = normalize(part).replace(/^the /, "");
    if (name.length >= 2 && name !== "various artists" && name !== "various") keys.add(`name:${name}`);
  }
  keyCache.set(obj.id, keys);
  return keys;
}

function labelKeys(obj) {
  const keys = new Set((obj.labels || []).map((l) => `label:${l}`));
  if (obj.bandcamp_page) keys.add(`page:${obj.bandcamp_page}`);
  return keys;
}

const overlaps = (a, b) => [...a].some((k) => b.has(k));

function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

// The three rings for one object: who goes where, in what order.
function relate(focus) {
  const inLibrary = data.inLibrary.has(focus.id);
  const focusItem = data.inLibrary.get(focus.id);
  const pool = inLibrary
    ? data.library.items.map((i) => data.byId.get(i.id)).filter(Boolean)
    : data.index;

  const fa = artistKeys(focus);
  const fl = labelKeys(focus);
  const rings = [[], [], []];
  const alsoInner = [0, 0, 0];   // relates this way too, but shown in an inner ring

  for (const obj of pool) {
    if (obj.id === focus.id) continue;
    const item = data.inLibrary.get(obj.id);
    const relations = [];
    if (overlaps(fa, artistKeys(obj))) relations.push(0);
    if (overlaps(fl, labelKeys(obj))) relations.push(1);
    if (inLibrary) {
      if (focusItem.added_on && item && item.added_on && daysBetween(focusItem.added_on, item.added_on) <= NEAR_DAYS) relations.push(2);
    } else if (focus.year && obj.year === focus.year) {
      relations.push(2);
    }
    if (!relations.length) continue;
    rings[relations[0]].push({ obj, item, relations, multi: relations.length > 1 });
    for (const r of relations.slice(1)) alsoInner[r] += 1;
  }

  // in the library: most recently added first. In the catalogue: things in
  // your library first, then closest in time, then a mixed but fixed order
  // (by mili ID), so a big ring isn't alphabetical
  const order = (a, b) => {
    if (inLibrary) return (b.item?.added_on || "").localeCompare(a.item?.added_on || "");
    return (b.item ? 1 : 0) - (a.item ? 1 : 0)
      || Math.abs((a.obj.year || 0) - (focus.year || 0)) - Math.abs((b.obj.year || 0) - (focus.year || 0))
      || a.obj.id.localeCompare(b.obj.id);
  };
  rings.forEach((ring) => ring.sort(order));
  return { rings, alsoInner, inLibrary, pool };
}

// ---------------------------------------------------------------------------
// The trail: where you've been, kept in this browser
// ---------------------------------------------------------------------------

function readTrail() {
  try {
    return JSON.parse(localStorage.getItem("mili.trail") || "[]").filter((id) => data.byId.has(id));
  } catch {
    return [];
  }
}

function writeTrail(trail) {
  try {
    localStorage.setItem("mili.trail", JSON.stringify(trail.slice(-30)));
  } catch {
    // storage turned off: the trail just isn't remembered
  }
}

export function walkBack() {
  const trail = readTrail();
  if (trail.length < 2) return;
  trail.pop();
  writeTrail(trail);
  location.hash = `#/atlas/${trail[trail.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

const short = (text, n = 24) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const RING_NAMES = ["same artist", "same label or page", "added near"];

// the current selection and ring pages, kept while you move around one focus
const state = { focus: null, pages: [0, 0, 0], ring: 0, index: 0 };

export function atlas(focusId) {
  // no focus given: the most recently added thing in the library
  if (!focusId || !data.byId.has(focusId)) {
    focusId = data.library.items.find((i) => data.byId.has(i.id))?.id || data.index[0]?.id;
  }
  const focus = data.byId.get(focusId);
  if (!focus) return h("section", { class: "page" }, h("p", { class: "empty" }, "Nothing to show yet."));

  if (state.focus !== focusId) Object.assign(state, { focus: focusId, pages: [0, 0, 0], ring: 0, index: 0 });

  const trail = readTrail();
  if (trail[trail.length - 1] !== focusId) {
    trail.push(focusId);
    writeTrail(trail);
  }

  const { rings, alsoInner, inLibrary, pool } = relate(focus);
  const ringNames = RING_NAMES.map((name, i) => (i === 2 && !inLibrary ? "released same year" : name));
  // start the selection on the first ring that has anything
  if (!rings[state.ring].length) state.ring = Math.max(0, rings.findIndex((r) => r.length));

  const root = h("div", { class: "atlas" });
  const svg = el("svg", { viewBox: "0 0 1000 1000", preserveAspectRatio: "xMidYMid meet", role: "img",
    "aria-label": `atlas around ${focus.title}` });
  root.append(svg);

  function visible(r) {
    const start = state.pages[r] * PAGE;
    return rings[r].slice(start, start + PAGE);
  }

  function draw() {
    svg.replaceChildren();
    RADII.forEach((radius, r) => {
      svg.append(el("circle", { class: "ring", cx: CENTER, cy: CENTER, r: radius }));
      const shown = visible(r);
      const span = 2 * Math.PI - GAP;
      const stagger = [0.5, 0.25, 0.75][r];
      shown.forEach(({ obj, item, relations, multi }, i) => {
        const angle = GAP_AT + GAP / 2 + ((i + stagger) * span) / Math.max(shown.length, 1);
        const x = CENTER + radius * Math.cos(angle);
        const y = CENTER + radius * Math.sin(angle);
        const cos = Math.cos(angle);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const lx = x + (anchor === "start" ? 12 : anchor === "end" ? -12 : 0);
        const ly = y + (anchor === "middle" ? (Math.sin(angle) < 0 ? -14 : 24) : 5);
        const status = item ? item.status : "outside";
        const selected = r === state.ring && i === state.index;
        const node = el("g", {
          class: `node ${status} ${selected ? "selected" : ""}`,
          onclick: () => { location.hash = `#/atlas/${obj.id}`; },
        },
        el("title", {}, `${obj.title} · ${obj.artist || ""}\n${relations.map((n) => ringNames[n]).join(" + ")}`),
        el("circle", { class: "hit", cx: x, cy: y, r: 14 }),
        el("rect", { class: "select-box", x: x - 9, y: y - 9, width: 18, height: 18 }),
        el("circle", { class: "mark", cx: x, cy: y, r: status === "outside" ? 3.5 : 5.5 }),
        el("text", { x: lx, y: ly, "text-anchor": anchor }, short(obj.title)),
        multi ? el("text", { class: "multi", x: x - 4, y: y - 10, "text-anchor": "end" }, "″") : null);
        svg.append(node);
      });

      // the ring's tag: "1 · SAME ARTIST · 9", and its page
      const total = rings[r].length;
      const tagAngle = GAP_AT;
      const tx = CENTER + radius * Math.cos(tagAngle) + 14;
      const ty = CENTER + radius * Math.sin(tagAngle) - 6;
      const label = `${r + 1} · ${ringNames[r].toUpperCase()} · ${total}`;
      const width = label.length * 8.4 + 26;
      const tag = el("g", { class: "tag" },
        el("rect", { x: tx, y: ty - 18, width, height: 28 }),
        el("text", { x: tx + 13, y: ty + 1 }, label));
      svg.append(tag);
      const notes = [];
      if (r === 2) notes.push(inLibrary ? `±${NEAR_DAYS}d of focus` : String(focus.year || "year unknown"));
      if (alsoInner[r]) notes.push(`+${alsoInner[r]} ″ in an inner ring`);
      if (total > PAGE) {
        const from = state.pages[r] * PAGE + 1;
        const to = Math.min(total, from + PAGE - 1);
        notes.push(`${from}–${to} / ${total} · more ▸`);
      }
      if (notes.length) {
        const sub = el("text", { class: "sub", x: tx + 2, y: ty + 30 }, notes.join(" · "));
        if (total > PAGE) {
          const more = el("g", {
            class: "tag more",
            onclick: () => {
              state.pages[r] = (state.pages[r] + 1) % Math.ceil(total / PAGE);
              if (state.ring === r) state.index = 0;
              draw();
            },
          }, sub);
          svg.append(more);
        } else {
          svg.append(el("g", { class: "tag" }, sub));
        }
      }
    });
  }

  // ---- the focus in the middle -------------------------------------------
  const item = data.inLibrary.get(focus.id);
  root.append(h("div", { class: "focus-card" },
    h("a", { href: `#/release/${focus.id}`, title: "open its page" }, cover(focus, "small")),
    h("a", { class: "title", href: `#/release/${focus.id}` }, focus.title),
    h("div", { class: "kind" }, focus.kind === "mix" ? "mix" : focus.type || "release"),
    focus.artist ? h("div", { class: "who" }, focus.artist) : null,
    h("div", { class: "when" },
      item ? `added ${item.added_on || "?"} · ${item.status}`
        : [focus.year, ...(focus.labels || [])].filter(Boolean).join(" · ") || "not in the library")));

  // ---- find ----------------------------------------------------------------
  const hits = h("div", { class: "hits" });
  const findBox = h("input", {
    type: "search",
    placeholder: "find title or artist…",
    oninput: (event) => {
      const words = normalize(event.target.value).split(" ").filter(Boolean);
      hits.replaceChildren(...(words.length ? pool : [])
        .filter((o) => words.every((w) => o._search.includes(w)))
        .slice(0, 8)
        .map((o) => h("a", { href: `#/atlas/${o.id}` }, `${o.title} · ${o.artist || ""}`)));
    },
  });
  root.append(h("div", { class: "atlas-panel atlas-find" },
    h("div", { class: "head" }, h("b", {}, "ATLAS"),
      inLibrary ? `library · ${pool.length} items` : `catalogue · ${pool.length.toLocaleString("en")}`),
    findBox, hits,
    h("p", { class: "atlas-help" },
      "click a dot to recenter", h("br"),
      "← → in a ring · ↑ ↓ between rings", h("br"),
      "enter recenter · ⌫ walk back")));

  // ---- trail ---------------------------------------------------------------
  const shownTrail = trail.slice(-12);
  root.append(h("div", { class: "atlas-panel atlas-trail" },
    h("div", { class: "head" }, h("b", {}, `TRAIL · ${trail.length}`),
      h("button", { onclick: () => { writeTrail([focusId]); location.hash = `#/atlas/${focusId}`; window.dispatchEvent(new HashChangeEvent("hashchange")); } }, "CLEAR")),
    h("div", { class: "steps" }, shownTrail.map((id, i) =>
      h("a", {
        href: `#/atlas/${id}`,
        class: id === focusId && i === shownTrail.length - 1 ? "here" : "",
        title: data.byId.get(id)?.title || "",
      }, String(trail.length - shownTrail.length + i + 1))))));

  root.append(h("div", { class: "atlas-crumbs" },
    trail.length > 5 ? `+${trail.length - 5} · ` : "",
    trail.slice(-5).map((id, i, arr) => [
      h("a", { href: `#/atlas/${id}` }, short(data.byId.get(id)?.title || "?", 22)),
      i < arr.length - 1 ? " › " : "",
    ])));

  // ---- key -----------------------------------------------------------------
  root.append(h("details", { class: "atlas-panel atlas-key" },
    h("summary", {}, "KEY"),
    h("p", {},
      h("span", { class: "k filled" }), "collection", h("br"),
      h("span", { class: "k" }), "queue", h("br"),
      h("span", { class: "k outside" }), "not in the library", h("br"),
      h("span", { class: "k box" }), "selection", h("br"),
      "″  relates in more than one way;", h("br"),
      "    shown in the innermost ring"),
    h("p", {},
      "1  same artist", h("br"),
      "2  same label or Bandcamp page", h("br"),
      `3  ${ringNames[2]}`, h("br"),
      `${PAGE} per ring, ${inLibrary ? "most recently added first" : "your library first"}`)));

  // ---- keys ----------------------------------------------------------------
  root.moveSelection = (key) => {
    const counts = [0, 1, 2].map((r) => visible(r).length);
    if (key === "ArrowRight" || key === "ArrowLeft") {
      const n = counts[state.ring];
      if (!n) return;
      state.index = (state.index + (key === "ArrowRight" ? 1 : n - 1)) % n;
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      let r = state.ring;
      for (let step = 0; step < 3; step++) {
        r = key === "ArrowDown" ? Math.min(2, r + 1) : Math.max(0, r - 1);
        if (counts[r]) break;
      }
      if (counts[r]) { state.ring = r; state.index = Math.min(state.index, counts[r] - 1); }
    } else if (key === "Enter") {
      const chosen = visible(state.ring)[state.index];
      if (chosen) location.hash = `#/atlas/${chosen.obj.id}`;
      return;
    }
    draw();
  };

  draw();
  return root;
}
