// mili: starting the app, and choosing the page from the address.
//
// The part of the address after "#" says which page to show:
//   #/                     home: getting started, recently added, the labels
//   #/search?q=wind        everything that matches, in mili and outside it
//   #/release/<mili ID>    a release or mix
//   #/artist/<artist ID>   everything by one artist
//   #/label/<name>         everything on one label
//   #/library              the library (?show=queue, ?collage=late%20night)
//   #/atlas/<mili ID>      the atlas, centred on one object
//   #/garden               the garden
//   #/settings             dark or light, accent colour, and more
//   #/guide                how mili works
//   #/collage/<id>         one collage: a list of releases and mixes, with a note
//   #/sign-in              signing in (to write notes and make collages)
//   #/about                what is mili (written in site/about.md)
//   #/profile              your collages and notes (signed in)
// Press / (or ⌘K, or the + in the top bar) to open the search box (palette.js).
// Because it's all after "#", the site is just files: no server is needed.

import { data, loadAll } from "./data.js";
import { h } from "./ui.js";
import { applyTheme } from "./theme.js";
import * as pages from "./pages.js";
import { atlas, walkBack } from "./atlas.js";
import { garden } from "./garden.js";
import { openPalette, closePalette } from "./palette.js";
import { loadCollages, onChange, canSave, me, signOut } from "./account.js";

applyTheme();     // before anything is drawn, so there's no flash of the wrong theme

const view = document.getElementById("view");
const menu = document.getElementById("menu");
const menuButton = document.getElementById("menu-button");

function parseAddress() {
  const [path, query] = (location.hash.slice(1) || "/").split("?");
  return {
    parts: path.split("/").filter(Boolean).map(decodeURIComponent),
    params: new URLSearchParams(query || ""),
  };
}

async function show() {
  const { parts, params } = parseAddress();
  const [page, arg] = parts;
  const name = page || "home";
  document.body.dataset.page = name;

  // light up the icon for this page
  const current = name === "library" && params.get("show") === "queue" ? "queue" : name;
  for (const a of document.querySelectorAll(".iconbar a")) {
    a.classList.toggle("on", a.dataset.page === current);
  }

  let content;
  try {
    if (!page && params.get("q")) { location.replace(`#/search?q=${encodeURIComponent(params.get("q"))}`); return; }
    if (!page) content = pages.home();
    else if (page === "search") content = pages.search(params.get("q") || "");
    else if (page === "guide") content = pages.guide();
    else if (page === "release") content = await pages.release(arg);
    else if (page === "artist") content = pages.artist(arg);
    else if (page === "label") content = pages.label(arg);
    else if (page === "library") content = pages.library(params);
    else if (page === "atlas") content = atlas(arg);
    else if (page === "garden") content = await garden(params);
    else if (page === "settings") content = pages.settings();
    else if (page === "collage") content = await pages.collage(arg);
    else if (page === "sign-in") content = pages.signInPage(params);
    else if (page === "about") content = await pages.aboutPage();
    else if (page === "profile") {
      if (!me()) { location.replace(`#/sign-in?back=${encodeURIComponent("#/profile")}`); return; }
      content = await pages.profile();
    }
    else content = pages.notFound("This page doesn't exist.");
  } catch (error) {
    console.error(error);
    content = pages.notFound(`Something went wrong: ${error.message}`);
  }
  // the menu: "profile" and "logout" when signed in, "sign in" when not
  document.getElementById("menu-profile").hidden = !(canSave() && me());
  const account = document.getElementById("menu-account");
  account.hidden = !canSave();
  account.textContent = me() ? "logout" : "sign in";
  account.href = me() ? "#/" : name === "sign-in" ? location.hash : `#/sign-in?back=${encodeURIComponent(location.hash || "#/")}`;
  view.replaceChildren(content);
  window.scrollTo(0, 0);
}

// The menu on the right opens and closes; a click anywhere else closes it,
// and closes small menus like [buy].
// "logout": sign out, and go to the front page
document.getElementById("menu-account").addEventListener("click", async (event) => {
  if (!me()) return;                  // "sign in": just follow the link
  event.preventDefault();
  location.hash = "#/";
  await signOut();
});

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  menu.hidden = !menu.hidden;
  menuButton.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", () => {
  for (const m of document.querySelectorAll(".menu")) m.hidden = true;
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
});

// Keys in the garden (undo, remove a mark, put the tool down)
document.addEventListener("keydown", (event) => {
  if (document.body.dataset.page !== "garden") return;
  view.querySelector(".garden")?.keyHandler?.(event);
});

// Keys in the atlas (not while typing in a box).
document.addEventListener("keydown", (event) => {
  if (document.body.dataset.page !== "atlas") return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const map = view.querySelector(".atlas");
  if (!map) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
    event.preventDefault();
    map.moveSelection(event.key);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    walkBack();
  }
});

// "/" or ⌘K opens the search box (not while typing in another box)
document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if ((event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
    event.preventDefault();
    openPalette();
  }
});
document.getElementById("search-button").addEventListener("click", (event) => {
  event.stopPropagation();
  openPalette();
});

window.addEventListener("hashchange", () => { closePalette(); show(); });

async function start() {
  view.replaceChildren(h("p", { class: "loading" }, "loading the catalogue…"));
  try {
    await loadAll();
  } catch (error) {
    view.replaceChildren(h("p", { class: "empty" },
      `The data couldn't be loaded (${error.message}). `,
      "If you opened index.html straight from the folder, start a small local server instead: see site/README.md."));
    return;
  }
  // collages (public ones, and your own when signed in): wait a moment for
  // them, but don't hold the page up if Supabase is slow
  await Promise.race([loadCollages(), new Promise((resolve) => setTimeout(resolve, 2500))]);
  show();
}

// signing in or out changes what the page shows: draw it again
onChange((kind) => { if (kind === "session") show(); });

start();
