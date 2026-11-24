// mili: small building blocks shared by every page.

import { data } from "./data.js";

// Make an HTML element: h("a", { href: "#/" }, "mili")
// Text is always added as text, never as HTML, so titles with < or & are safe.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// One of Daniel's dot icons from site/icons/ (queue, collect, rotation,
// network, collage, plus, menu, logomark). The file is used as a stencil
// (a CSS "mask"), so the icon takes the colour of the text around it.
export function mi(name, cls = "") {
  return h("span", { class: `mi ${cls}`, style: `--src:url(icons/${name}.svg)`, "aria-hidden": "true" });
}

// A colour from the mili ID, for covers we don't have.
export function idHue(id) {
  return parseInt(id.slice(0, 6), 16) % 360;
}

// The cover, or a quiet placeholder with the title's first letter.
// size "small" uses the Cover Art Archive's 250px image instead of 500px.
export function cover(obj, size = "large") {
  const placeholder = h(
    "div",
    { class: `cover placeholder ${size}`, style: `--hue:${idHue(obj.id)}` },
    (obj.title || "?").trim().charAt(0).toUpperCase(),
  );
  if (!obj.cover) return placeholder;
  const src = size === "small" ? obj.cover.replace(/front-500$/, "front-250") : obj.cover;
  const img = h("img", { class: `cover ${size}`, src, alt: "", loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(placeholder));
  return img;
}

export const availabilityText = {
  bandcamp_and_streaming: "on Bandcamp and streaming",
  streaming_only: "streaming only",
  bandcamp_only: "Bandcamp only",
  elsewhere: "only YouTube or SoundCloud",
  nowhere: "no listen links found",
};

export function availabilityDot(obj) {
  return h("span", {
    class: `dot ${obj.availability}`,
    title: availabilityText[obj.availability] || "",
  });
}

// "Gigi Masin · 1986 · Numero Group", with links to the artist and labels.
export function byline(obj, { links = true } = {}) {
  const parts = [];
  if (obj.artist) {
    const target = obj.artist_ids && obj.artist_ids.length
      ? `#/artist/${obj.artist_ids[0]}`
      : `#/?q=${encodeURIComponent(obj.artist)}`;
    parts.push(links ? h("a", { class: "artist", href: target }, obj.artist) : h("span", { class: "artist" }, obj.artist));
  }
  if (obj.year) parts.push(h("span", { class: "year" }, obj.year));
  for (const label of obj.labels || []) {
    parts.push(links
      ? h("a", { class: "label", href: `#/label/${encodeURIComponent(label)}` }, label)
      : h("span", { class: "label" }, label));
  }
  const line = h("div", { class: "byline" });
  parts.forEach((part, i) => {
    if (i) line.append(h("span", { class: "sep" }, " · "));
    line.append(part);
  });
  return line;
}

// One row in a list: small cover, title, byline, where it can be heard.
export function row(obj, extra = null) {
  const item = data.inLibrary.get(obj.id);
  return h(
    "a",
    { class: "row", href: `#/release/${obj.id}` },
    cover(obj, "small"),
    h(
      "div",
      { class: "row-text" },
      h(
        "div",
        { class: "row-title" },
        obj.title,
        obj.type ? h("span", { class: "badge" }, obj.type) : null,
        obj.kind === "mix" ? h("span", { class: "badge" }, "mix") : null,
      ),
      byline(obj, { links: false }),
    ),
    h(
      "div",
      { class: "row-meta" },
      extra,
      item ? h("span", { class: `status ${item.status}` }, item.status) : null,
      availabilityDot(obj),
    ),
  );
}

export function list(objects, empty = "Nothing here.") {
  if (!objects.length) return h("p", { class: "empty" }, empty);
  return h("div", { class: "list" }, objects.map((obj) => row(obj)));
}

// The key for the coloured dots.
export function dotKey() {
  return h(
    "div",
    { class: "dot-key" },
    Object.entries(availabilityText).map(([key, text]) =>
      h("span", {}, h("span", { class: `dot ${key}` }), text)),
  );
}
