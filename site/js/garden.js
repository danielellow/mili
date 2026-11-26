// mili: the garden. Your library as ground you shape and plants you tend.
//
//   - The ground is a map you move around (drag) and zoom (scroll, or − + fit).
//     You shape it with ground marks: ridge, pool, path, ring, mark,
//     inscription and draw (freehand outlines, like islands).
//   - The tray along the bottom holds what isn't planted yet. Drag a release up
//     onto the ground to plant it; drag plants to move them.
//   - Each plant belongs to a species (see plants.js): its family comes from
//     the release's genre, and you can change it. A release in your queue is
//     a seed; in your collection it starts young, older purchases bigger. It
//     grows each time you open the release from mili, or water it here
//     ("water a can"). Opened in the last 30 days, it's in bloom; left alone
//     for half a year, it fades.
//   - The ground under a plant matters a little: ridges are stone (snow at the
//     top), pools are moss, drawn outlines are loam, rings are clay, paths are
//     sand and open ground is meadow. On the ground its species likes, a plant
//     grows a little bigger.
//   - The garden is kept in this browser as you work ("mili.garden").
//     "save" downloads it as garden.json; put that file in site/data/ and the
//     published site shows your garden to anyone who hasn't started their own.

import { data, normalize, water } from "./data.js";
import { h } from "./ui.js";
import {
  el, seeded, drawPlant, defaultSpecies, variation, growthWord,
  SPECIES, FAMILIES, speciesByNo, familyLabel,
} from "./plants.js";

const STORE = "mili.garden";
const DAY = 24 * 60 * 60 * 1000;
const TOOLS = ["ridge", "pool", "path", "ring", "mark", "inscription", "draw"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// a smooth line through points (closed: back to the start)
function smooth(points, closed = false) {
  if (points.length < 2) return "";
  const p = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  let d = `M${p[1][0].toFixed(1)},${p[1][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? `${d} Z` : d;
}

function smallCover(url) {
  return url ? url.replace(/front-500$/, "front-250").replace(/_16\.jpg$/, "_9.jpg") : null;
}

const short = (text, n) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text || "");
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const newId = () => Math.random().toString(36).slice(2, 10);

function readWater(id) {
  try {
    const entry = JSON.parse(localStorage.getItem("mili.water") || "{}")[id];
    if (typeof entry === "number") return { cans: entry, last: 0 };
    return { cans: entry?.cans || 0, last: entry?.last || 0 };
  } catch {
    return { cans: 0, last: 0 };
  }
}

// ---------------------------------------------------------------------------
// The ground marks
// ---------------------------------------------------------------------------

function ellipsePoints(cx, cy, rx, ry, rnd, wobble = 0.12, n = 22) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + (rnd() - 0.5) * wobble;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return pts;
}

function drawMark(m, defs) {
  const g = el("g", { class: `mark ${m.kind}`, "data-mark": m.id });
  const rnd = seeded(m.id);
  if (m.kind === "ridge") {
    for (const s of [1, 0.66, 0.34]) g.append(el("path", { d: smooth(ellipsePoints(m.cx, m.cy, m.rx * s, m.ry * s, rnd, 0.18), true) }));
  } else if (m.kind === "pool") {
    const clip = `clip-${m.id}`;
    defs.append(el("clipPath", { id: clip }, el("ellipse", { cx: m.cx, cy: m.cy, rx: m.rx, ry: m.ry })));
    const lines = el("g", { "clip-path": `url(#${clip})` });
    for (let y = m.cy - m.ry; y <= m.cy + m.ry; y += 3.2) {
      lines.append(el("line", { x1: m.cx - m.rx, y1: y, x2: m.cx + m.rx, y2: y }));
    }
    g.append(lines, el("ellipse", { class: "hit", cx: m.cx, cy: m.cy, rx: m.rx, ry: m.ry }));
  } else if (m.kind === "ring") {
    g.append(el("ellipse", { cx: m.cx, cy: m.cy, rx: m.rx, ry: m.ry }));
  } else if (m.kind === "path") {
    g.append(el("path", { d: smooth(m.points), class: "dashed" }), el("path", { d: smooth(m.points), class: "hit-line" }));
  } else if (m.kind === "draw") {
    g.append(el("path", { d: smooth(m.points, true) }));
  } else if (m.kind === "mark") {
    const r = 4;
    for (const a of [0, 60, 120]) {
      const rad = (a * Math.PI) / 180;
      g.append(el("line", { x1: m.x - Math.cos(rad) * r, y1: m.y - Math.sin(rad) * r, x2: m.x + Math.cos(rad) * r, y2: m.y + Math.sin(rad) * r }));
    }
    g.append(el("circle", { class: "hit", cx: m.x, cy: m.y, r: 6 }));
  } else if (m.kind === "inscription") {
    g.append(el("text", { x: m.x, y: m.y, "text-anchor": "middle" }, m.text.toUpperCase()));
  }
  return g;
}

function moveMark(m, dx, dy) {
  if ("cx" in m) { m.cx += dx; m.cy += dy; }
  if ("x" in m) { m.x += dx; m.y += dy; }
  if (m.points) m.points = m.points.map(([x, y]) => [x + dx, y + dy]);
}

const insideEllipse = (m, x, y, s = 1) => ((x - m.cx) / (m.rx * s)) ** 2 + ((y - m.cy) / (m.ry * s)) ** 2 <= 1;

function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// the ground at a spot: the mark drawn last wins
function groundAt(marks, x, y) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.kind === "ridge" && insideEllipse(m, x, y)) return insideEllipse(m, x, y, 0.34) ? "snow" : "stone";
    if (m.kind === "pool" && insideEllipse(m, x, y)) return "moss";
    if (m.kind === "ring" && insideEllipse(m, x, y)) return "clay";
    if (m.kind === "draw" && insidePolygon(m.points, x, y)) return "loam";
    if (m.kind === "path" && m.points.some(([px, py]) => Math.hypot(px - x, py - y) < 8)) return "sand";
  }
  return "meadow";
}

// ---------------------------------------------------------------------------
// Keeping the garden
// ---------------------------------------------------------------------------

async function loadGarden() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && (Object.keys(saved.plants || {}).length || (saved.marks || []).length)) {
      return { garden: { plants: saved.plants || {}, marks: saved.marks || [] }, from: "this browser" };
    }
  } catch { /* storage off or broken: start from the published garden */ }
  try {
    const response = await fetch("data/garden.json");
    if (response.ok) {
      const published = await response.json();
      return { garden: { plants: published.plants || {}, marks: published.marks || [] }, from: "published" };
    }
  } catch { /* no published garden yet */ }
  return { garden: { plants: {}, marks: [] }, from: "new" };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export async function garden(params) {
  const { garden: state, from } = await loadGarden();
  // only plants for things that are still in mili
  for (const id of Object.keys(state.plants)) if (!data.byId.has(id)) delete state.plants[id];

  const history = [];
  let mode = "tend";            // tend: move plants and the view · ground: shape the ground
  let tool = null;
  let selectedMark = null;
  let focusId = params.get("focus");
  let cardId = null;
  let movingId = null;
  let showGround = true;
  let showPlants = true;
  const view = { x: 0, y: 0, k: 1.6 };   // screen = world × k + (x, y)
  let filter = "";

  // how one release's plant looks right now
  function lookOf(id) {
    const obj = data.byId.get(id);
    const p = state.plants[id] || {};
    const { cans, last } = readWater(id);
    const item = data.inLibrary.get(id);
    // where it starts: a seed in the queue; in the collection, older purchases
    // start bigger (30 %, plus up to 30 % more over five years)
    const months = item && item.added_on ? (Date.now() - new Date(item.added_on)) / (30 * DAY) : 0;
    const base = p.base ?? (item && item.status === "queue" ? 5 : Math.round(30 + Math.min(30, months / 2)));
    const species = p.species ?? defaultSpecies(obj);
    const ground = state.plants[id] ? groundAt(state.marks, p.x, p.y) : null;
    return {
      species,
      growth: clamp(base + cans * 10, 0, 100),
      bloom: Boolean(last && Date.now() - last < 30 * DAY),
      fading: Boolean(last && Date.now() - last > 180 * DAY),
      seed: p.seed ?? id,
      leaves: p.leaves || null,
      stem: p.stem || null,
      ground,
      happy: Boolean(ground && ground === speciesByNo.get(species)?.ground),
      cans,
    };
  }

  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage off */ }
  };
  const remember = () => {
    history.push(JSON.stringify(state));
    if (history.length > 80) history.shift();
    undoButton.disabled = false;
  };
  const undo = () => {
    if (!history.length) return;
    const before = JSON.parse(history.pop());
    state.plants = before.plants;
    state.marks = before.marks;
    selectedMark = null;
    undoButton.disabled = !history.length;
    save();
    render();
    if (cardId) state.plants[cardId] ? showCard(cardId) : closeCard();
  };

  // ---- the parts of the page --------------------------------------------
  const root = h("div", { class: "garden" });
  const svg = el("svg", { class: "ground" });
  const defs = el("defs");
  const world = el("g");
  const groundLayer = el("g", { class: "ground-layer" });
  const plantLayer = el("g", { class: "plant-layer" });
  const preview = el("g", { class: "preview" });
  world.append(groundLayer, plantLayer, preview);
  svg.append(defs, world);
  root.append(svg);

  const counts = h("span", { class: "g-counts" });
  const findBox = h("input", { type: "search", class: "g-find", placeholder: "find", value: "" });
  const undoButton = h("button", { class: "g-button", disabled: true, onclick: undo }, "undo");
  const groundToggle = h("button", { class: "g-button on", title: "show or hide the ground marks", onclick: () => { showGround = !showGround; groundToggle.classList.toggle("on", showGround); render(); } }, "ground");
  const plantToggle = h("button", { class: "g-button on", title: "show or hide the plants", onclick: () => { showPlants = !showPlants; plantToggle.classList.toggle("on", showPlants); render(); } }, "planted");
  const legend = h("div", { class: "g-legend", hidden: true },
    h("p", {}, h("b", {}, "how plants grow")),
    legendLine({ growth: 5 }, "seed: in your queue"),
    legendLine({ growth: 35 }, "young: in your collection; older purchases start bigger"),
    legendLine({ growth: 75 }, "grown, mature: each time you open it from mili, or water a can, it grows"),
    legendLine({ growth: 70, bloom: true }, "in bloom: opened in the last 30 days"),
    legendLine({ growth: 60, fading: true }, "fading: not opened for half a year"),
    h("p", { class: "g-note" },
      "A plant's family comes from the release's genre (ambient is a fern, techno a crystal, jazz a climber …); ",
      "change it on the plant's card. On the ground its species likes, it grows a little bigger: ",
      "ridges are stone (snow at the top), pools moss, drawn outlines loam, rings clay, paths sand, open ground meadow."),
    h("p", { class: "g-note" },
      "The garden is kept in this browser. “save” downloads it as garden.json; with that file in site/data/ the published site shows it.",
      from === "published" ? " You're looking at the published garden; your changes stay in this browser." : ""));
  const top = h("div", { class: "g-top" },
    h("b", { class: "g-tag" }, "GARDEN"), h("span", { class: "g-mode" }, "tend"),
    findBox, counts,
    h("span", { class: "g-spacer" }),
    h("button", { class: "g-button", title: "zoom out", onclick: () => zoomBy(1 / 1.3) }, "−"),
    h("button", { class: "g-button", title: "zoom in", onclick: () => zoomBy(1.3) }, "+"),
    h("button", { class: "g-button", onclick: fit }, "fit"),
    undoButton, groundToggle, plantToggle,
    h("button", { class: "g-button", onclick: () => { legend.hidden = !legend.hidden; } }, "legend"),
    h("button", { class: "g-button", title: "download this garden as garden.json", onclick: download }, "save"));

  const hint = h("span", { class: "g-hint" });
  const toolButtons = TOOLS.map((name) => h("button", {
    class: "g-tool", "data-tool": name, onclick: () => pickTool(name),
  }, toolIcon(name), h("span", {}, name)));
  const groundBar = h("div", { class: "g-groundbar" },
    h("b", {}, "ground marks"), toolButtons, hint, h("span", { class: "g-spacer" }),
    h("button", { class: "g-button", onclick: () => setMode("tend") }, "done"));
  const groundButton = h("button", { class: "g-button g-ground-open", onclick: () => setMode("ground") }, "ground marks");
  const status = h("span", { class: "g-faint" }, "drag up to plant");
  const trayCount = h("span", {});
  const trayCards = h("div", { class: "g-cards" });
  const tray = h("div", { class: "g-tray" },
    h("div", { class: "g-tray-head" }, h("span", {}, "unplanted · ", trayCount), groundButton,
      h("span", { class: "g-spacer" }), status),
    trayCards);
  const card = h("div", { class: "g-card", hidden: true });
  const chooser = h("div", { class: "g-chooser", hidden: true });
  const inscription = h("input", { class: "g-inscribe", hidden: true, placeholder: "write, then enter" });
  root.append(top, legend, groundBar, tray, card, chooser, inscription);

  // ---- drawing everything ---------------------------------------------------
  function applyView() {
    world.setAttribute("transform", `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`);
  }

  function plantNode(id) {
    const obj = data.byId.get(id);
    const spot = state.plants[id];
    const node = el("g", { class: "plant", "data-plant": id, transform: `translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)})` });
    if (id === focusId || id === cardId) node.classList.add("focus");
    if (filter && !normalize(`${obj.title} ${obj.artist || ""}`).includes(normalize(filter))) node.classList.add("dim");
    node.append(el("circle", { class: "hit", cx: 0, cy: -12, r: 16 }), drawPlant(lookOf(id)));
    const cover = smallCover(obj.cover);
    if (cover) {
      const img = el("image", { href: cover, x: 7, y: -26, width: 11, height: 11, preserveAspectRatio: "xMidYMid slice" });
      img.addEventListener("error", () => img.remove());
      node.append(el("rect", { class: "cover-frame", x: 7, y: -26, width: 11, height: 11 }), img);
    }
    node.append(
      el("text", { class: "p-title", x: 0, y: 9, "text-anchor": "middle" }, short(obj.title, 26).toUpperCase()),
      el("text", { class: "p-artist", x: 0, y: 15.5, "text-anchor": "middle" }, short(obj.artist || "", 30)));
    return node;
  }

  function render() {
    defs.replaceChildren();
    groundLayer.replaceChildren();
    plantLayer.replaceChildren();
    groundLayer.style.display = showGround ? "" : "none";
    plantLayer.style.display = showPlants ? "" : "none";
    for (const m of state.marks) {
      const node = drawMark(m, defs);
      if (m.id === selectedMark) node.classList.add("selected");
      groundLayer.append(node);
    }
    // plants further down are drawn later, so they stand in front
    const ids = Object.keys(state.plants).sort((a, b) => state.plants[a].y - state.plants[b].y);
    for (const id of ids) plantLayer.append(plantNode(id));
    renderTray();
    const planted = ids.length;
    const total = data.library.items.filter((i) => data.byId.has(i.id)).length;
    counts.textContent = `planted ${planted} · unplanted ${total - planted}`;
  }

  function renderTray() {
    const wanted = normalize(filter);
    const unplanted = data.library.items
      .filter((i) => data.byId.has(i.id) && !state.plants[i.id])
      .map((i) => data.byId.get(i.id))
      .filter((o) => !wanted || normalize(`${o.title} ${o.artist || ""}`).includes(wanted));
    trayCount.textContent = unplanted.length;
    trayCards.replaceChildren(...unplanted.slice(0, 200).map((o) => {
      const sprig = el("svg", { viewBox: "-18 -38 36 41", class: "g-sprig" }, drawPlant(lookOf(o.id)));
      return h("div", { class: `g-cardlet ${o.id === focusId ? "focus" : ""}`, "data-id": o.id, title: `${o.title} · ${o.artist || ""}` },
        sprig, h("span", {}, short(o.title, 18)));
    }));
    if (unplanted.length > 200) trayCards.append(h("div", { class: "g-cardlet more" }, `+${unplanted.length - 200}`, h("span", {}, "use find")));
  }

  // ---- the view: move and zoom ---------------------------------------------
  const rect = () => svg.getBoundingClientRect();
  function toWorld(event) {
    const r = rect();
    return [(event.clientX - r.left - view.x) / view.k, (event.clientY - r.top - view.y) / view.k];
  }
  function zoomBy(factor, cx, cy) {
    const r = rect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const k = clamp(view.k * factor, 0.25, 8);
    view.x = px - ((px - view.x) * k) / view.k;
    view.y = py - ((py - view.y) * k) / view.k;
    view.k = k;
    applyView();
  }
  function centreOn(x, y, k = view.k) {
    const r = rect();
    view.k = k;
    view.x = r.width / 2 - x * k;
    view.y = (r.height - 150) / 2 - y * k;
    applyView();
  }
  function fit() {
    const xs = [], ys = [];
    for (const { x, y } of Object.values(state.plants)) { xs.push(x - 40, x + 40); ys.push(y - 50, y + 22); }
    for (const m of state.marks) {
      if ("cx" in m) { xs.push(m.cx - m.rx, m.cx + m.rx); ys.push(m.cy - m.ry, m.cy + m.ry); }
      if ("x" in m) { xs.push(m.x - 20, m.x + 20); ys.push(m.y - 10, m.y + 10); }
      for (const [x, y] of m.points || []) { xs.push(x); ys.push(y); }
    }
    if (!xs.length) { centreOn(0, 0, 1.6); return; }
    const r = rect();
    const w = Math.max(...xs) - Math.min(...xs), hgt = Math.max(...ys) - Math.min(...ys);
    const k = clamp(Math.min((r.width - 80) / w, (r.height - 280) / hgt), 0.25, 4);
    centreOn((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, k);
  }
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const r = rect();
    zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX - r.left, event.clientY - r.top);
  }, { passive: false });

  // ---- pointer on the ground -------------------------------------------------
  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const at = toWorld(event);
    const markNode = event.target.closest("[data-mark]");
    const plantHit = event.target.closest("[data-plant]");
    svg.setPointerCapture(event.pointerId);

    if (movingId) {                     // "move": the next click is where it goes
      remember();
      state.plants[movingId] = { ...state.plants[movingId], x: Math.round(at[0]), y: Math.round(at[1]) };
      const id = movingId;
      movingId = null;
      root.classList.remove("moving");
      status.textContent = "drag up to plant";
      save(); render(); showCard(id);
      return;
    }
    if (mode === "ground" && markNode && (event.altKey || !tool)) {
      selectedMark = markNode.dataset.mark;
      remember();
      drag = { kind: "mark", id: selectedMark, last: at, moved: false };
      render();
      return;
    }
    if (mode === "ground" && tool) {
      selectedMark = null;
      if (tool === "mark") {
        remember();
        state.marks.push({ id: newId(), kind: "mark", x: at[0], y: at[1] });
        save(); render();
        return;
      }
      if (tool === "inscription") { askInscription(event, at); return; }
      drag = { kind: "draw", tool, start: at, points: [at] };
      return;
    }
    if (plantHit && showPlants) {
      const id = plantHit.dataset.plant;
      drag = { kind: "plant", id, node: plantHit, start: at, from: { ...state.plants[id] }, moved: false, screen: [event.clientX, event.clientY] };
      return;
    }
    drag = { kind: "pan", sx: event.clientX, sy: event.clientY, vx: view.x, vy: view.y, moved: false };
  });

  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const at = toWorld(event);
    if (drag.kind === "pan") {
      view.x = drag.vx + event.clientX - drag.sx;
      view.y = drag.vy + event.clientY - drag.sy;
      drag.moved = drag.moved || Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 4;
      applyView();
    } else if (drag.kind === "plant") {
      if (!drag.moved && Math.hypot(event.clientX - drag.screen[0], event.clientY - drag.screen[1]) < 4) return;
      if (!drag.moved) { remember(); drag.moved = true; }
      const spot = state.plants[drag.id];
      spot.x = drag.from.x + at[0] - drag.start[0];
      spot.y = drag.from.y + at[1] - drag.start[1];
      drag.node.setAttribute("transform", `translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)})`);
    } else if (drag.kind === "mark") {
      const m = state.marks.find((x) => x.id === drag.id);
      moveMark(m, at[0] - drag.last[0], at[1] - drag.last[1]);
      drag.last = at;
      drag.moved = true;
      render();
    } else if (drag.kind === "draw") {
      const last = drag.points[drag.points.length - 1];
      if (Math.hypot(at[0] - last[0], at[1] - last[1]) > 3 / view.k) drag.points.push(at);
      drag.end = at;
      drawPreview();
    }
  });

  svg.addEventListener("pointerup", () => {
    if (!drag) return;
    const done = drag;
    drag = null;
    preview.replaceChildren();
    if (done.kind === "plant") {
      if (done.moved) {
        state.plants[done.id].x = Math.round(state.plants[done.id].x);
        state.plants[done.id].y = Math.round(state.plants[done.id].y);
        save(); render();
        if (cardId === done.id) showCard(done.id);
      } else {
        showCard(done.id);
      }
    } else if (done.kind === "pan") {
      if (!done.moved) closeCard();
    } else if (done.kind === "mark") {
      if (!done.moved) history.pop();
      save(); render();
    } else if (done.kind === "draw") {
      const mark = markFrom(done);
      if (mark) { remember(); state.marks.push(mark); save(); render(); }
    }
  });

  function boxFrom(a, b) {
    return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2 };
  }
  function markFrom(d) {
    const end = d.end || d.start;
    if (["ridge", "pool", "ring"].includes(d.tool)) {
      const box = boxFrom(d.start, end);
      if (box.rx < 4 || box.ry < 3) return null;
      return { id: newId(), kind: d.tool, ...box };
    }
    if (d.points.length < 3) return null;
    return { id: newId(), kind: d.tool, points: d.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) };
  }
  function drawPreview() {
    preview.replaceChildren();
    const d = drag;
    if (["ridge", "pool", "ring"].includes(d.tool)) {
      const box = boxFrom(d.start, d.end || d.start);
      preview.append(el("ellipse", { cx: box.cx, cy: box.cy, rx: box.rx, ry: box.ry }));
    } else {
      preview.append(el("path", { d: smooth(d.points, d.tool === "draw") }));
    }
  }

  // inscriptions: a small box where you click, Enter to place the words
  function askInscription(event, at) {
    const r = root.getBoundingClientRect();
    inscription.hidden = false;
    inscription.value = "";
    inscription.style.left = `${event.clientX - r.left}px`;
    inscription.style.top = `${event.clientY - r.top}px`;
    inscription.dataset.x = at[0];
    inscription.dataset.y = at[1];
    setTimeout(() => inscription.focus(), 0);
  }
  inscription.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && inscription.value.trim()) {
      remember();
      state.marks.push({ id: newId(), kind: "inscription", x: Number(inscription.dataset.x), y: Number(inscription.dataset.y), text: inscription.value.trim().slice(0, 40) });
      inscription.hidden = true;
      save(); render();
    } else if (event.key === "Escape") {
      inscription.hidden = true;
    }
    event.stopPropagation();
  });
  inscription.addEventListener("blur", () => { inscription.hidden = true; });

  // ---- planting from the tray -------------------------------------------------
  trayCards.addEventListener("pointerdown", (event) => {
    const cardlet = event.target.closest(".g-cardlet[data-id]");
    if (!cardlet || event.button !== 0) return;
    event.preventDefault();
    const id = cardlet.dataset.id;
    const ghost = cardlet.cloneNode(true);
    ghost.classList.add("g-ghost");
    root.append(ghost);
    const r = root.getBoundingClientRect();
    const place = (e) => {
      ghost.style.left = `${e.clientX - r.left - 30}px`;
      ghost.style.top = `${e.clientY - r.top - 40}px`;
    };
    place(event);
    const move = (e) => place(e);
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ghost.remove();
      const s = rect();
      const overGround = e.clientX > s.left && e.clientX < s.right && e.clientY > s.top
        && e.clientY < tray.getBoundingClientRect().top;
      if (!overGround) return;
      remember();
      const [x, y] = toWorld(e);
      state.plants[id] = { x: Math.round(x), y: Math.round(y) };
      focusId = id;
      save();
      render();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // ---- the plant's card -----------------------------------------------------------
  function closeCard() {
    cardId = null;
    card.hidden = true;
    render();
  }

  function showCard(id) {
    cardId = id;
    const obj = data.byId.get(id);
    const p = state.plants[id];
    const look = lookOf(id);
    const species = speciesByNo.get(look.species);
    const v = variation(look.seed);
    const cover = smallCover(obj.cover);

    const growthLabel = h("div", { class: "gc-growth" }, `${growthWord(look.growth)} · ${look.growth}%`);
    let slid = false;
    const slider = h("input", {
      type: "range", min: 0, max: 100, value: look.growth, class: "gc-slider",
      oninput: (event) => {
        if (!slid) { remember(); slid = true; }
        const value = Number(event.target.value);
        p.base = value - look.cans * 10;
        growthLabel.textContent = `${growthWord(value)} · ${value}%`;
        save(); render();
      },
      onchange: () => { slid = false; showCard(id); },
    });
    const colour = (key, label) => {
      const input = h("input", {
        type: "color",
        value: p[key] || (document.documentElement.dataset.theme === "light" ? "#111111" : "#ededed"),
        oninput: (event) => { p[key] = event.target.value; save(); render(); },
        onchange: () => showCard(id),
        onfocus: () => remember(),
      });
      return h("label", { class: `gc-colour ${p[key] ? "chosen" : ""}` }, input, label);
    };
    const groundText = look.ground === species.ground
      ? `${look.ground} · its favourite: grows a little bigger`
      : `${look.ground} · prefers ${species.ground}`;

    card.replaceChildren(
      h("div", { class: "gc-head" },
        cover ? h("img", { src: cover, alt: "" }) : h("div", { class: "gc-nocover" }, (obj.title || "?").charAt(0)),
        h("div", { class: "gc-names" },
          h("a", { class: "gc-title", href: `#/release/${id}` }, obj.title),
          h("div", { class: "gc-artist" }, obj.artist || "")),
        h("button", { class: "gc-close", title: "close", onclick: closeCard }, "×")),
      h("div", { class: "gc-species" },
        el("svg", { viewBox: "-24 -50 48 56", class: "g-sprig" }, drawPlant({ ...look, growth: Math.max(look.growth, 60) })),
        h("div", { class: "gc-names" },
          h("div", { class: "gc-sname" }, species.name),
          h("div", { class: "gc-artist" }, `${familyLabel(species.family)} · no. ${String(species.no).padStart(4, "0")}`)),
        h("button", { class: "gc-change", onclick: () => openChooser(id) }, "CHANGE")),
      growthLabel,
      slider,
      h("dl", { class: "gc-facts" },
        h("dt", {}, "WATERED"), h("dd", {}, `${look.cans} ${look.cans === 1 ? "can" : "cans"}${look.bloom ? " · in bloom" : look.fading ? " · fading" : ""}`),
        h("dt", {}, "GROUND"), h("dd", {}, groundText),
        h("dt", {}, "THIS ONE"), h("dd", {}, `size ×${v.size.toFixed(2)} · lean ${v.lean}° · spread ${v.spread >= 0 ? "+" : ""}${v.spread}%`),
        h("dt", {}, "COLOURS"), h("dd", { class: "gc-colours" },
          colour("leaves", "leaves"), colour("stem", "stem"),
          (p.leaves || p.stem) ? h("button", {
            class: "gc-reset", onclick: () => { remember(); delete p.leaves; delete p.stem; save(); render(); showCard(id); },
          }, "reset") : null)),
      h("div", { class: "gc-actions" },
        h("button", { class: "gc-primary", onclick: () => { water(id); render(); showCard(id); } }, "water a can"),
        h("button", { onclick: () => { remember(); p.seed = newId(); save(); render(); showCard(id); } }, "new variation"),
        h("button", {
          onclick: () => {
            movingId = id;
            root.classList.add("moving");
            status.textContent = "click on the ground where it should go · esc to stop";
          },
        }, "move"),
        h("button", { onclick: () => { remember(); delete state.plants[id]; save(); closeCard(); } }, "uproot")),
    );
    card.hidden = false;
    render();
  }

  // ---- choosing a species -------------------------------------------------------------
  function openChooser(id) {
    const obj = data.byId.get(id);
    const current = lookOf(id).species;
    let family = "all";
    let words = "";
    const grid = h("div", { class: "gs-grid" });
    const chips = h("div", { class: "gs-chips" });
    const draw = () => {
      chips.replaceChildren(...["all", ...FAMILIES.map((f) => f.id)].map((f) =>
        h("button", { class: `gs-chip ${family === f ? "on" : ""}`, onclick: () => { family = f; draw(); } },
          f === "all" ? "all" : FAMILIES.find((x) => x.id === f).label)));
      const wanted = normalize(words);
      grid.replaceChildren(...SPECIES
        .filter((s) => family === "all" || s.family === family)
        .filter((s) => !wanted || normalize(`${s.name} ${s.family} ${s.ground}`).includes(wanted))
        .map((s) => h("button", {
          class: `gs-card ${s.no === current ? "on" : ""}`,
          onclick: () => {
            remember();
            state.plants[id].species = s.no;
            save();
            chooser.hidden = true;
            render();
            showCard(id);
          },
        },
        h("span", { class: "gs-no" }, String(s.no).padStart(3, "0")),
        el("svg", { viewBox: "-26 -52 52 58", class: "gs-drawing" }, drawPlant({ species: s.no, growth: 90, bloom: true, seed: `sample-${s.no}` })),
        h("span", { class: "gs-name" }, s.name),
        h("span", { class: "gs-sub" }, `${familyLabel(s.family)} · ${s.ground}`))));
    };
    const search = h("input", { type: "search", class: "gs-search", placeholder: "search species", oninput: (e) => { words = e.target.value; draw(); } });
    chooser.replaceChildren(
      h("div", { class: "gs-head" },
        h("span", {}, `CHANGE ${short(obj.title, 30).toUpperCase()} TO… `, h("b", {}, `${SPECIES.length} species`)),
        search,
        h("button", { class: "gc-close", onclick: () => { chooser.hidden = true; } }, "×")),
      chips, grid);
    draw();
    chooser.hidden = false;
    setTimeout(() => search.focus(), 0);
  }

  // ---- modes and tools ---------------------------------------------------------
  function setMode(name) {
    mode = name;
    root.classList.toggle("drawing", mode === "ground");
    root.querySelector(".g-mode").textContent = mode === "ground" ? "shape" : "tend";
    if (mode === "ground" && !tool) pickTool("ridge");
    if (mode === "tend") { tool = null; selectedMark = null; render(); }
  }
  function pickTool(name) {
    tool = tool === name ? null : name;
    for (const b of toolButtons) b.classList.toggle("on", b.dataset.tool === tool);
    hint.textContent = !tool ? "drag a mark to move it · ⌫ removes the chosen mark"
      : tool === "mark" ? "click the ground to place a mark"
        : tool === "inscription" ? "click the ground, write, then enter"
          : "drag on the ground to draw · alt-drag a mark to move it · ⌫ removes the chosen mark";
  }

  findBox.addEventListener("input", () => {
    filter = findBox.value;
    render();
    const wanted = normalize(filter);
    if (!wanted) return;
    const hit = Object.keys(state.plants).find((id) =>
      normalize(`${data.byId.get(id).title} ${data.byId.get(id).artist || ""}`).includes(wanted));
    if (hit) centreOn(state.plants[hit].x, state.plants[hit].y - 15);
  });

  function download() {
    const blob = new Blob([JSON.stringify({ saved_at: new Date().toISOString(), ...state }, null, 1)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "garden.json" });
    document.body.append(a);
    a.click();
    a.remove();
  }

  // keys: undo, remove a mark, put things down
  root.keyHandler = (event) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
    else if ((event.key === "Backspace" || event.key === "Delete") && selectedMark) {
      event.preventDefault();
      remember();
      state.marks = state.marks.filter((m) => m.id !== selectedMark);
      selectedMark = null;
      save(); render();
    } else if (event.key === "Escape") {
      if (!chooser.hidden) { chooser.hidden = true; return; }
      if (movingId) { movingId = null; root.classList.remove("moving"); status.textContent = "drag up to plant"; return; }
      legend.hidden = true;
      if (cardId) closeCard();
      if (mode === "ground") setMode("tend");
    }
  };

  // ---- first draw, once the page is on screen -----------------------------------
  pickTool(null);
  render();
  requestAnimationFrame(() => {
    if (focusId && state.plants[focusId]) {
      centreOn(state.plants[focusId].x, state.plants[focusId].y - 15, 2.4);
      showCard(focusId);
    } else {
      fit();
    }
    if (focusId && !state.plants[focusId]) {
      const obj = data.byId.get(focusId);
      if (obj) {
        findBox.value = obj.title;
        filter = obj.title;
        renderTray();
        status.textContent = "not planted yet: drag it up from the tray";
      }
    }
  });
  return root;
}

function legendLine(look, text) {
  const sprig = el("svg", { viewBox: "-20 -44 40 48", class: "g-sprig small" },
    drawPlant({ species: 22, seed: "legend", ...look }));
  return h("p", { class: "g-legend-line" }, sprig, text);
}

function toolIcon(name) {
  const s = el("svg", { viewBox: "-10 -8 20 16", class: "g-tool-icon" });
  if (name === "ridge") s.append(el("ellipse", { rx: 8, ry: 5.5 }), el("ellipse", { rx: 5, ry: 3.2 }), el("ellipse", { rx: 2, ry: 1.3 }));
  if (name === "pool") for (const y of [-3, 0, 3]) s.append(el("line", { x1: -7 + Math.abs(y), y1: y, x2: 7 - Math.abs(y), y2: y }));
  if (name === "path") s.append(el("path", { d: "M-8,3 C-4,-5 0,6 8,-3", "stroke-dasharray": "2 2" }));
  if (name === "ring") s.append(el("ellipse", { rx: 7, ry: 5 }));
  if (name === "mark") s.append(el("line", { x1: -5, y1: 0, x2: 5, y2: 0 }), el("line", { x1: -2.5, y1: -4.3, x2: 2.5, y2: 4.3 }), el("line", { x1: 2.5, y1: -4.3, x2: -2.5, y2: 4.3 }));
  if (name === "inscription") s.append(el("text", { "text-anchor": "middle", y: 3 }, "ab"));
  if (name === "draw") s.append(el("path", { d: "M-8,4 L-4,-4 L0,2 L4,-5 L8,3" }));
  return s;
}
