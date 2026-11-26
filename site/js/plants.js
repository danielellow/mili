// mili: the plants in the garden.
//
// There are 18 families (trees, shrubs, spires, wildflowers …), each drawn as
// a small line drawing by its own function, and 108 numbered species: six in
// each family, each with a name, the ground it likes, and its own shape
// settings. A release gets a family from its genre when it has one (ambient
// becomes a fern, techno a crystal, jazz a climber …) and a species within it
// from its mili ID; you can change it in the garden.
//
// A drawing depends on:
//   growth   0–100 %: seed, sprout, young, grown, mature
//   bloom    opened from mili in the last 30 days: flowers in the accent colour
//   fading   not opened for half a year: drawn faint
//   seed     "this one": size, lean and spread, different for each plant
//   colours  leaves and stem, if you've chosen them (otherwise black or white,
//            like the rest of the site)

const SVG_NS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// a random-looking but fixed sequence for any text
export function seeded(text) {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (n) => n.toFixed(1);

// ---------------------------------------------------------------------------
// Families and species
// ---------------------------------------------------------------------------

export const FAMILIES = [
  { id: "tree", label: "trees", nouns: ["Oak", "Birch", "Elm", "Ash", "Maple", "Linden"] },
  { id: "shrub", label: "shrubs", nouns: ["Hedge", "Thicket", "Bramble", "Mound", "Cloud", "Bush"] },
  { id: "spire", label: "spires", nouns: ["Lupine", "Stalk", "Rod", "Tower", "Spike", "Candle"] },
  { id: "wildflower", label: "wildflowers", nouns: ["Spray", "Drift", "Scatter", "Flick", "Bloom", "Wort"] },
  { id: "fan", label: "fans", nouns: ["Fan", "Daisy", "Burst", "Splay", "Fountain", "Flare"] },
  { id: "clump", label: "clumps", nouns: ["Tuft", "Clump", "Cushion", "Knot", "Hummock", "Tussock"] },
  { id: "grass", label: "grasses", nouns: ["Grass", "Sedge", "Rush", "Fescue", "Oat", "Blade"] },
  { id: "fern", label: "ferns", nouns: ["Fern", "Frond", "Bracken", "Maidenhair", "Spleenwort", "Fiddlehead"] },
  { id: "climber", label: "climbers", nouns: ["Vine", "Ivy", "Creeper", "Bindweed", "Hop", "Trailer"] },
  { id: "weeper", label: "weepers", nouns: ["Willow", "Weeper", "Cascade", "Veil", "Fall", "Curtain"] },
  { id: "conifer", label: "conifers", nouns: ["Pine", "Spruce", "Fir", "Larch", "Cedar", "Yew"] },
  { id: "umbel", label: "umbels", nouns: ["Umbel", "Lace", "Parasol", "Dill", "Angelica", "Canopy"] },
  { id: "palm", label: "palms", nouns: ["Palm", "Frondpalm", "Sago", "Fanpalm", "Coco", "Date"] },
  { id: "reed", label: "reeds", nouns: ["Reed", "Cattail", "Bulrush", "Papyrus", "Cane", "Flag"] },
  { id: "crystal", label: "crystals", nouns: ["Shard", "Prism", "Facet", "Spar", "Quartz", "Geode"] },
  { id: "rosette", label: "rosettes", nouns: ["Rosette", "Houseleek", "Whorl", "Star", "Wheel", "Pinwheel"] },
  { id: "seedhead", label: "seedheads", nouns: ["Clock", "Puff", "Globe", "Thistle", "Wisp", "Orb"] },
  { id: "cup", label: "cups", nouns: ["Tulip", "Cup", "Chalice", "Goblet", "Bell", "Crocus"] },
];

const WORDS = [
  "Ember", "Lantern", "Frost", "Coral", "Cobalt", "Saffron", "Plum", "Mint", "Tangerine", "Lilac",
  "Pearl", "Rust", "Glass", "Rose", "Gold", "Violet", "Smoke", "Salt", "Velvet", "Ink",
  "Echo", "Static", "Dusk", "Dawn", "Moon", "Copper", "Ash", "Hollow", "Silver", "Night",
  "Morning", "River", "Paper", "Chalk", "Amber", "Iron", "Linen", "Honey", "Storm", "Signal",
];
export const GROUNDS = ["loam", "meadow", "snow", "clay", "stone", "sand", "moss"];

// the 108 species, always in the same order and with the same names
export const SPECIES = (() => {
  const list = [];
  const used = new Set();
  FAMILIES.forEach((family, f) => {
    const rnd = seeded(`family-${family.id}`);
    for (let i = 0; i < 6; i++) {
      let name;
      do {
        name = `${WORDS[Math.floor(rnd() * WORDS.length)]} ${family.nouns[i]}`;
      } while (used.has(name));
      used.add(name);
      list.push({
        no: f * 6 + i + 1,
        name,
        family: family.id,
        ground: GROUNDS[Math.floor(rnd() * GROUNDS.length)],
        density: 0.6 + rnd() * 0.8,    // how many branches, leaves, blades …
        spread: 0.7 + rnd() * 0.6,     // how wide
        tall: 0.75 + rnd() * 0.5,      // how tall
      });
    }
  });
  return list;
})();

export const speciesByNo = new Map(SPECIES.map((s) => [s.no, s]));
export const familyLabel = (id) => (FAMILIES.find((f) => f.id === id)?.label || id).replace(/s$/, "");

// genre words -> family, checked in this order
const GENRE_FAMILIES = [
  ["ambient", "fern"], ["drone", "weeper"], ["post-rock", "weeper"], ["idm", "crystal"],
  ["techno", "crystal"], ["electro", "crystal"], ["house", "umbel"], ["disco", "fan"], ["funk", "fan"],
  ["dub", "reed"], ["bass", "reed"], ["jungle", "spire"], ["drum and bass", "spire"], ["footwork", "spire"],
  ["garage", "spire"], ["hip hop", "palm"], ["rap", "palm"], ["reggae", "palm"], ["soul", "rosette"],
  ["r&b", "rosette"], ["jazz", "climber"], ["folk", "wildflower"], ["country", "wildflower"],
  ["singer", "wildflower"], ["classical", "tree"], ["soundtrack", "tree"], ["minimal", "grass"],
  ["noise", "conifer"], ["metal", "conifer"], ["rock", "conifer"], ["punk", "clump"],
  ["experimental", "seedhead"], ["pop", "cup"], ["indie", "cup"], ["electronic", "crystal"], ["dance", "umbel"],
];

// the species a release gets until you choose another
export function defaultSpecies(obj) {
  const genres = (obj.genres || []).map((g) => g.toLowerCase());
  let family = null;
  for (const [word, fam] of GENRE_FAMILIES) {
    if (genres.some((g) => g.includes(word))) { family = fam; break; }
  }
  const rnd = seeded(obj.id);
  if (!family) family = FAMILIES[Math.floor(rnd() * FAMILIES.length)].id;
  else rnd();
  const inFamily = SPECIES.filter((s) => s.family === family);
  return inFamily[Math.floor(rnd() * inFamily.length)].no;
}

// "this one": size, lean and spread for one plant, from its variation seed
export function variation(seed) {
  const rnd = seeded(`variation-${seed}`);
  return {
    size: 0.85 + rnd() * 0.4,
    lean: Math.round((rnd() - 0.5) * 16),
    spread: Math.round((rnd() - 0.5) * 30),
  };
}

export function growthWord(g) {
  return g < 10 ? "seed" : g < 25 ? "sprout" : g < 50 ? "young" : g < 85 ? "grown" : "mature";
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// look = { species (no), growth (0–100), bloom, fading, seed, leaves, stem, happy }
export function drawPlant(look) {
  const species = speciesByNo.get(look.species) || SPECIES[0];
  const v = variation(look.seed);
  const g = Math.max(0, Math.min(100, look.growth)) / 100;
  const box = el("g", { class: `glyph ${species.family}${look.bloom ? " bloom" : ""}${look.fading ? " fading" : ""}` });
  const inner = el("g", { transform: `rotate(${v.lean})` });
  box.append(inner);
  // your colours, if you've chosen them: leaves (and leaf lines) and stem
  const paint = (kind) => {
    if (kind === "stem" && look.stem) return `stroke:${look.stem}`;
    if (kind === "leaf-line" && look.leaves) return `stroke:${look.leaves}`;
    if ((kind === "leaf" || kind === "leaf-shape") && look.leaves) return `stroke:${look.leaves};fill:${look.leaves}`;
    if (kind === "flower" && look.leaves && !look.bloom) return `fill:${look.leaves}`;
    return null;
  };
  const P = {
    path: (d, kind = "stem") => el("path", { d, class: kind, style: paint(kind) }),
    dot: (x, y, r, kind = "leaf") => el("circle", { cx: f1(x), cy: f1(y), r: f1(r), class: kind, style: paint(kind) }),
    oval: (x, y, rx, ry, angle, kind = "leaf") => el("ellipse", { cx: f1(x), cy: f1(y), rx: f1(rx), ry: f1(ry), transform: `rotate(${f1(angle)} ${f1(x)} ${f1(y)})`, class: kind, style: paint(kind) }),
    flower: (x, y, r) => el("circle", { cx: f1(x), cy: f1(y), r: f1(r), class: "flower", style: paint("flower") }),
  };

  if (g < 0.1) {
    inner.append(el("ellipse", { cx: 0, cy: -2, rx: 2.6, ry: 1.8, class: "seed" }), P.path("M0,-3.8 q0.6,-2.6 2.3,-3.8"));
    return box;
  }
  const rnd = seeded(`${look.seed}-${species.no}`);
  if (g < 0.25) {
    const h = 6 + g * 20;
    inner.append(P.path(`M0,0 Q${f1(rnd() * 2 - 1)},${f1(-h / 2)} 0,${f1(-h)}`),
      P.oval(-2.2, -h + 1, 2.2, 0.9, -30), P.oval(2.2, -h + 1.5, 2.2, 0.9, 30));
    return box;
  }
  const s = (0.35 + 0.65 * g) * v.size * (look.happy ? 1.1 : 1);
  const spread = species.spread * (1 + v.spread / 100);
  DRAW[species.family](inner, P, rnd, { s, g, spread, density: species.density, tall: species.tall, bloom: look.bloom });
  return box;
}

// how many of something, growing with the plant
const count = (base, o) => Math.max(1, Math.round(base * o.density * (0.4 + 0.6 * o.g)));

const DRAW = {
  tree(g, P, rnd, o) {
    const H = 34 * o.s * o.tall;
    g.append(P.path(`M0,0 L${f1(rnd() * 2 - 1)},${f1(-H * 0.45)}`));
    const grow = (x, y, angle, len, depth) => {
      const x2 = x + Math.sin(angle) * len, y2 = y - Math.cos(angle) * len;
      g.append(P.path(`M${f1(x)},${f1(y)} L${f1(x2)},${f1(y2)}`));
      if (depth === 0) {
        for (let i = 0; i < 3; i++) g.append(P.dot(x2 + (rnd() - 0.5) * 3, y2 + (rnd() - 0.5) * 3, 1 + rnd() * 0.8));
        if (o.bloom && rnd() < 0.5) g.append(P.flower(x2, y2 - 1, 1.3));
        return;
      }
      const n = rnd() < o.density - 0.4 ? 3 : 2;
      for (let i = 0; i < n; i++) grow(x2, y2, angle + (i - (n - 1) / 2) * 0.55 * o.spread + (rnd() - 0.5) * 0.2, len * 0.7, depth - 1);
    };
    grow(0, -H * 0.45, 0, H * 0.28, o.g > 0.6 ? 3 : 2);
  },
  shrub(g, P, rnd, o) {
    const H = 18 * o.s * o.tall;
    for (let i = 0; i < 3; i++) g.append(P.path(`M0,0 L${f1((i - 1) * 4 * o.spread)},${f1(-H * 0.6)}`));
    const n = count(9, o);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI;
      g.append(P.dot(-Math.cos(a) * 8 * o.spread * o.s + (rnd() - 0.5) * 3, -H * 0.55 - Math.sin(a) * H * 0.5 + (rnd() - 0.5) * 3, 2 + rnd() * 2.2 * o.s));
    }
    if (o.bloom) for (let i = 0; i < 4; i++) g.append(P.flower((rnd() - 0.5) * 14 * o.spread * o.s, -H * (0.7 + rnd() * 0.4), 1.2));
  },
  spire(g, P, rnd, o) {
    const H = 40 * o.s * o.tall;
    g.append(P.path(`M0,0 Q${f1(rnd() * 2 - 1)},${f1(-H / 2)} 0,${f1(-H)}`));
    g.append(P.oval(-2.5, -H * 0.15, 3, 1, -25), P.oval(2.5, -H * 0.25, 3, 1, 25));
    const n = count(9, o);
    for (let i = 0; i < n; i++) {
      const y = -H * (0.45 + (0.55 * i) / n);
      const side = i % 2 ? 1 : -1;
      g.append(o.bloom ? P.flower(side * 1.3, y, 1.5 - i * 0.05) : P.dot(side * 1.3, y, 1.4 - i * 0.06));
    }
  },
  wildflower(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    g.append(P.path(`M0,0 L0,${f1(-H * 0.5)}`));
    const n = count(3, o) + 1;
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.4 * o.spread + (rnd() - 0.5) * 0.2;
      const len = H * (0.35 + rnd() * 0.3);
      const x = Math.sin(a) * len, y = -H * 0.5 - Math.cos(a) * len;
      g.append(P.path(`M0,${f1(-H * 0.5)} Q${f1(x * 0.3)},${f1(y + len * 0.4)} ${f1(x)},${f1(y)}`));
      petals(g, P, x, y, 2 + rnd(), o.bloom);
    }
    g.append(P.oval(-2.5, -H * 0.2, 3, 1, -25));
  },
  fan(g, P, rnd, o) {
    const H = 32 * o.s * o.tall;
    const n = count(6, o) + 1;
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * (0.9 / n) * 2 * o.spread;
      const x = Math.sin(a) * H, y = -Math.cos(a) * H;
      g.append(P.path(`M0,0 Q${f1(x * 0.2)},${f1(y * 0.6)} ${f1(x)},${f1(y)}`));
      g.append(o.bloom ? P.flower(x, y, 1.6) : P.dot(x, y, 1.5));
    }
  },
  clump(g, P, rnd, o) {
    const H = 17 * o.s * o.tall;
    const n = count(10, o);
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.4 * o.spread;
      const len = H * (0.6 + rnd() * 0.5);
      const x = Math.sin(a) * len * 1.3, y = -Math.cos(a) * len;
      g.append(P.path(`M0,0 Q${f1(x * 0.2)},${f1(y)} ${f1(x)},${f1(y * 0.8)}`, "leaf-line"));
    }
    if (o.bloom) for (let i = 0; i < 3; i++) g.append(P.flower((rnd() - 0.5) * 10 * o.spread * o.s, -H * (0.9 + rnd() * 0.3), 1.3));
  },
  grass(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    const n = count(12, o);
    for (let i = 0; i < n; i++) {
      const x0 = (rnd() - 0.5) * 6 * o.spread;
      const len = H * (0.5 + rnd() * 0.5);
      const bend = (rnd() - 0.5) * 12 * o.spread;
      g.append(P.path(`M${f1(x0)},0 Q${f1(x0 + bend * 0.2)},${f1(-len * 0.6)} ${f1(x0 + bend)},${f1(-len)}`, "leaf-line"));
      if (o.bloom && rnd() < 0.25) g.append(P.flower(x0 + bend, -len, 1));
    }
  },
  fern(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    const fronds = count(3, o);
    for (let f = 0; f < fronds; f++) {
      const a = (f - (fronds - 1) / 2) * 0.45 * o.spread;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push([Math.sin(a) * H * t + Math.sin(a * 2) * t * t * 8, -Math.cos(a) * H * t + t * t * 4]);
      }
      g.append(P.path(`M${pts.map((p) => p.map(f1).join(",")).join(" L")}`));
      for (let i = 2; i < 10; i++) {
        const [x, y] = pts[i];
        const len = (1 - i / 11) * 6 * o.spread;
        g.append(P.path(`M${f1(x)},${f1(y)} l${f1(-len)},${f1(-len * 0.35)}`, "leaf-line"),
          P.path(`M${f1(x)},${f1(y)} l${f1(len)},${f1(-len * 0.35)}`, "leaf-line"));
      }
      if (o.bloom) g.append(P.flower(pts[10][0], pts[10][1], 1.2));
    }
  },
  climber(g, P, rnd, o) {
    const H = 38 * o.s * o.tall;
    g.append(P.path(`M0,0 L0,${f1(-H)}`, "support"));
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push([Math.sin(t * Math.PI * 4) * 3.5 * o.spread, -H * t]);
    }
    g.append(P.path(`M${pts.map((p) => p.map(f1).join(",")).join(" L")}`));
    const n = count(7, o);
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[Math.round(3 + (i * 20) / n)];
      const side = x >= 0 ? 1 : -1;
      g.append(P.oval(x + side * 2.5, y, 2.2, 1.1, side * 30));
      if (o.bloom && i % 2) g.append(P.flower(x + side * 4.5, y - 1, 1.1));
    }
  },
  weeper(g, P, rnd, o) {
    const H = 32 * o.s * o.tall;
    g.append(P.path(`M0,0 Q1,${f1(-H * 0.5)} 0,${f1(-H)}`));
    const n = count(8, o);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const reach = (6 + rnd() * 10) * o.spread * o.s;
      const top = -H * (0.75 + rnd() * 0.25);
      const drop = H * (0.35 + rnd() * 0.35);
      g.append(P.path(`M0,${f1(top)} Q${f1(side * reach)},${f1(top - 4)} ${f1(side * reach * 1.1)},${f1(top + drop)}`, "leaf-line"));
      if (o.bloom && rnd() < 0.4) g.append(P.flower(side * reach * 1.1, top + drop, 1.1));
    }
  },
  conifer(g, P, rnd, o) {
    const H = 40 * o.s * o.tall;
    g.append(P.path(`M0,0 L0,${f1(-H)}`));
    const tiers = count(5, o) + 1;
    for (let i = 0; i < tiers; i++) {
      const y = -H * (0.2 + (0.8 * i) / tiers);
      const w = (1 - i / tiers) * 10 * o.spread * o.s + 1;
      g.append(P.path(`M${f1(-w)},${f1(y + 3)} L0,${f1(y - 4)} L${f1(w)},${f1(y + 3)}`, "leaf-line"));
    }
    if (o.bloom) g.append(P.flower(0, -H - 1.5, 1.4));
  },
  umbel(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    g.append(P.path(`M0,0 L0,${f1(-H * 0.7)}`), P.oval(2.5, -H * 0.25, 3, 1, 25));
    const n = count(9, o) + 2;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.2 * o.spread;
      const x = Math.sin(a) * H * 0.35, y = -H * 0.7 - Math.cos(a) * H * 0.3;
      g.append(P.path(`M0,${f1(-H * 0.7)} L${f1(x)},${f1(y)}`), o.bloom ? P.flower(x, y, 1.2) : P.dot(x, y, 1));
    }
  },
  palm(g, P, rnd, o) {
    const H = 34 * o.s * o.tall;
    const lean = (rnd() - 0.5) * 8;
    g.append(P.path(`M0,0 Q${f1(lean * 2)},${f1(-H * 0.5)} ${f1(lean)},${f1(-H)}`));
    const n = count(6, o) + 1;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const reach = (8 + rnd() * 6) * o.spread * o.s;
      g.append(P.path(`M${f1(lean)},${f1(-H)} Q${f1(lean + side * reach * 0.6)},${f1(-H - 6 + rnd() * 3)} ${f1(lean + side * reach)},${f1(-H + 4 + rnd() * 5)}`, "leaf-line"));
    }
    if (o.bloom) g.append(P.flower(lean + 1.5, -H + 2, 1.4), P.flower(lean - 1.5, -H + 2.5, 1.4));
  },
  reed(g, P, rnd, o) {
    const H = 38 * o.s * o.tall;
    const n = count(4, o) + 1;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 3 * o.spread;
      const top = -H * (0.6 + rnd() * 0.4);
      g.append(P.path(`M${f1(x)},0 L${f1(x + (rnd() - 0.5) * 2)},${f1(top)}`));
      g.append(o.bloom ? P.oval(x, top + 3, 1.4, 3.5, 0, "flower") : P.oval(x, top + 3, 1.3, 3.2, 0));
    }
  },
  crystal(g, P, rnd, o) {
    const n = count(4, o) + 1;
    for (let i = 0; i < n; i++) {
      const H = (12 + rnd() * 22) * o.s * o.tall;
      const w = (2 + rnd() * 2.5) * o.s;
      const a = ((i - (n - 1) / 2) * 0.35 + (rnd() - 0.5) * 0.15) * o.spread;
      const pts = [[-w, 0], [-w, -H * 0.8], [0, -H], [w, -H * 0.8], [w, 0]];
      const turned = pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
      g.append(P.path(`M${turned.map((p) => p.map(f1).join(",")).join(" L")}`, o.bloom && i === 0 ? "flower-line" : "leaf-line"));
      g.append(P.path(`M${f1(turned[2][0])},${f1(turned[2][1])} L${f1((turned[0][0] + turned[4][0]) / 2)},0`, "facet"));
    }
  },
  rosette(g, P, rnd, o) {
    const n = count(10, o) + 3;
    const R = 9 * o.s * o.spread;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.append(P.oval(Math.cos(a) * R * 0.5, -4 + Math.sin(a) * R * 0.22, R * 0.45, R * 0.16, (a * 180) / Math.PI));
    }
    g.append(o.bloom ? P.flower(0, -5, 2) : P.dot(0, -4, 1.2));
    if (o.g > 0.7) g.append(P.path(`M0,-4 L0,${f1(-14 * o.s * o.tall)}`), o.bloom ? P.flower(0, -14 * o.s * o.tall, 1.6) : P.dot(0, -14 * o.s * o.tall, 1.2));
  },
  seedhead(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    g.append(P.path(`M0,0 Q${f1(rnd() * 3 - 1.5)},${f1(-H / 2)} 0,${f1(-H)}`), P.oval(-2.8, -H * 0.2, 3, 1, -25));
    const n = count(16, o) + 4;
    const R = 6 * o.s * o.spread;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * R, y = -H + Math.sin(a) * R;
      g.append(P.path(`M0,${f1(-H)} L${f1(x)},${f1(y)}`, "leaf-line"), o.bloom ? P.flower(x, y, 0.7) : P.dot(x, y, 0.6));
    }
  },
  cup(g, P, rnd, o) {
    const H = 30 * o.s * o.tall;
    g.append(P.path(`M0,0 Q${f1(rnd() * 2 - 1)},${f1(-H / 2)} 0,${f1(-H)}`));
    g.append(P.path(`M0,-2 Q${f1(-7 * o.spread)},${f1(-H * 0.3)} ${f1(-5 * o.spread)},${f1(-H * 0.55)}`, "leaf-line"),
      P.path(`M0,-3 Q${f1(6 * o.spread)},${f1(-H * 0.25)} ${f1(4.5 * o.spread)},${f1(-H * 0.5)}`, "leaf-line"));
    const w = 4 * o.s * o.spread;
    g.append(P.path(`M${f1(-w)},${f1(-H - 5)} Q${f1(-w)},${f1(-H + 1)} 0,${f1(-H + 0.5)} Q${f1(w)},${f1(-H + 1)} ${f1(w)},${f1(-H - 5)} L${f1(w * 0.4)},${f1(-H - 2.5)} L0,${f1(-H - 6)} L${f1(-w * 0.4)},${f1(-H - 2.5)} Z`, o.bloom ? "flower-shape" : "leaf-shape"));
  },
};

// a small flower: a ring of petals around the middle
function petals(g, P, x, y, r, bloom) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.append(bloom ? P.flower(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.45) : P.dot(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.4));
  }
}
