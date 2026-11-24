// mili: starting the app, and choosing the page from the address.
//
// The part of the address after "#" says which page to show:
//   #/                     home (and search: #/?q=wind)
//   #/release/<mili ID>    a release or mix
//   #/artist/<artist ID>   everything by one artist
//   #/label/<name>         everything on one label
//   #/library              the library (?show=queue, ?collage=late%20night)
//   #/atlas/<mili ID>      the atlas, centred on one object
//   #/garden               the garden
// Because it's all after "#", the site is just files: no server is needed.

import { data, loadAll } from "./data.js";
import { h } from "./ui.js";
import * as pages from "./pages.js";

const view = document.getElementById("view");
const find = document.getElementById("find");

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
  document.body.dataset.page = page || "home";
  for (const a of document.querySelectorAll("nav a")) {
    a.classList.toggle("on", a.dataset.page === (page || "home"));
  }

  let content;
  try {
    if (!page) content = pages.home(params.get("q") || "");
    else if (page === "release") content = await pages.release(arg);
    else if (page === "artist") content = pages.artist(arg);
    else if (page === "label") content = pages.label(arg);
    else if (page === "library") content = pages.library(params);
    else if (page === "atlas") content = pages.comingSoon("Atlas");
    else if (page === "garden") content = pages.comingSoon("Garden");
    else content = pages.notFound("This page doesn't exist.");
  } catch (error) {
    console.error(error);
    content = pages.notFound(`Something went wrong: ${error.message}`);
  }
  view.replaceChildren(content);
  if (page !== undefined || !params.get("q")) window.scrollTo(0, 0);
  if (page) find.value = "";
}

// Typing in the search box shows results on the home page as you type.
let typing;
find.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    const q = find.value.trim();
    const target = q ? `#/?q=${encodeURIComponent(q)}` : "#/";
    if (parseAddress().parts.length === 0) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
    show();
  }, 120);
});

// A click anywhere closes open menus (like [buy]) and, on a phone, the page menu.
document.addEventListener("click", () => {
  for (const menu of document.querySelectorAll(".menu")) menu.hidden = true;
  document.body.classList.remove("nav-open");
});

// On a phone, the menu icon opens and closes the list of pages.
document.getElementById("menu-button").addEventListener("click", (event) => {
  event.stopPropagation();
  document.body.classList.toggle("nav-open");
});

window.addEventListener("hashchange", show);

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
  const { params } = parseAddress();
  if (params.get("q")) find.value = params.get("q");
  document.getElementById("foot").replaceChildren(
    h("span", {}, `${data.index.length.toLocaleString("en")} objects · data from ${data.meta.exported_at?.slice(0, 10) || "?"}`),
    ...(data.meta.sources || []).map((s) => h("span", {}, s)),
  );
  show();
}

start();
