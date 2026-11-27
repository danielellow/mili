// mili: collages. A collage is a named list of releases and mixes, like a
// channel on Are.na: "chill", "late night", "for Ash". Saved in Supabase
// (collages and collage_items in supabase/user_data.sql), so they're the same
// on every device. Collages start public; a private one is seen only by you.
//
//   collageButton(id)   the collage icon on a release or mix page: add it to
//                       your collages, take it out, or start a new one
//   collageLine(id)     "in chill · late night" under the page
//   collagePage(id)     #/collage/<id>: the collage, its note, what's in it
//   profilePage()       #/profile: your collages and your notes

import { data } from "./data.js";
import { h, mi, cover, row } from "./ui.js";
import { notesBlock } from "./notes.js";
import {
  canSave, me, userData, isMine, myCollages, collageById, collagesWith, loadCollages,
  createCollage, updateCollage, deleteCollage, addToCollage, removeFromCollage, onChange, myNotes,
  notesStartingWith, uploadCover,
} from "./account.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The collage icon on a release or mix page
// ---------------------------------------------------------------------------

export function collageButton(objectId) {
  if (!canSave()) return null;
  const button = h("button", { class: "act", title: "add to a collage", "aria-expanded": "false" }, mi("collage"));
  const panel = h("div", { class: "menu collage-menu", hidden: true });
  panel.addEventListener("click", (event) => event.stopPropagation());   // clicks inside keep it open
  const wrap = h("span", { class: "collage-pick" }, button, panel);

  const lit = () => button.classList.toggle("on", myCollages().some((c) => c.items.includes(objectId)));

  function draw() {
    if (!me()) {
      panel.replaceChildren(h("p", { class: "menu-note" }, h("a", { href: `#/sign-in?back=${encodeURIComponent(location.hash)}` }, "sign in"), " to make collages"));
      return;
    }
    const mine = myCollages();
    const choices = mine.map((c) => {
      const inIt = c.items.includes(objectId);
      const choice = h("button", { class: `collage-choice ${inIt ? "in" : ""}`, title: inIt ? "take it out" : "add it" },
        h("span", { class: "tick" }, inIt ? "✓" : "+"), c.name, h("span", { class: "n" }, c.items.length));
      choice.addEventListener("click", async () => {
        choice.disabled = true;
        try {
          if (inIt) await removeFromCollage(c.id, objectId);
          else await addToCollage(c.id, objectId);
        } catch (error) {
          choice.title = `didn't work: ${error.message}`;
        }
        draw(); lit();
      });
      return choice;
    });
    const name = h("input", { class: "collage-new", type: "text", placeholder: "new collage…", maxlength: "80", spellcheck: "false" });
    const problem = h("p", { class: "menu-note" });
    name.addEventListener("keydown", async (event) => {
      if (event.key === "Escape") { panel.hidden = true; return; }
      if (event.key !== "Enter" || !name.value.trim()) return;
      name.disabled = true;
      try {
        await createCollage(name.value, objectId);
        draw(); lit();
        panel.querySelector(".collage-new")?.focus();
      } catch (error) {
        problem.textContent = `didn't work: ${error.message}`;
        name.disabled = false;
      }
    });
    panel.replaceChildren(
      h("p", { class: "menu-head" }, "add to a collage"),
      ...choices,
      name,
      problem);
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = panel.hidden;
    for (const m of document.querySelectorAll(".menu")) m.hidden = true;   // one menu at a time
    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    if (opening) { draw(); panel.querySelector(".collage-new")?.focus(); }
  });
  lit();
  return wrap;
}

// "in chill · late night": the collages this is in that you can see
export function collageLine(objectId) {
  if (!canSave()) return null;
  const line = h("p", { class: "meta collage-line" });
  const draw = () => {
    const collages = collagesWith(objectId);
    line.hidden = !collages.length;
    line.replaceChildren(mi("collage", "small"), " in ",
      ...collages.flatMap((c, i) => [...(i ? [" · "] : []), h("a", { href: `#/collage/${c.id}` }, c.name)]));
  };
  draw();
  const stop = onChange((kind) => {
    if (!line.isConnected) { stop(); return; }      // the page has moved on
    if (kind === "collages") draw();
  });
  return line;
}

// ---------------------------------------------------------------------------
// The collage page
// ---------------------------------------------------------------------------

// The cover: the one chosen for the collage (an item's art, or an uploaded
// picture), or else a 2 × 2 of the first covers, or the collage icon when empty
function fourCovers(collage, size) {
  const objects = collage.items.map((id) => data.byId.get(id)).filter(Boolean).slice(0, 4);
  if (!objects.length) return h("div", { class: `cover ${size} collage-cover empty` }, mi("collage"));
  return h("div", { class: `cover ${size} collage-cover` }, objects.map((o) => cover(o, "small")));
}
export function collageCover(collage, size = "large") {
  if (collage.cover?.startsWith("object:")) {
    const obj = data.byId.get(collage.cover.slice(7));
    if (obj) return cover(obj, size);
  } else if (collage.cover) {
    const img = h("img", { class: `cover ${size}`, src: collage.cover, alt: "" });
    img.addEventListener("error", () => img.replaceWith(fourCovers(collage, size)));
    return img;
  }
  return fourCovers(collage, size);
}

// One collage as a row in a list (on the profile page); "meta" replaces
// its public/private label
function collageRow(collage, meta = null) {
  return h("a", { class: "row", href: `#/collage/${collage.id}` },
    collageCover(collage, "small"),
    h("div", { class: "row-text" },
      h("div", { class: "row-title" }, collage.name, h("span", { class: "badge" }, "collage")),
      h("div", { class: "byline" }, plural(collage.items.length, "item", "items"))),
    h("div", { class: "row-meta" }, h("span", { class: "added" }, meta ?? (collage.is_public ? "public" : "private"))));
}

// A button inside a row (which is a link): don't follow the link when it's pressed
function rowButton(label, onPress) {
  const button = h("button", { class: "note-button small" }, label);
  button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onPress(button); });
  return button;
}

export async function collagePage(id) {
  if (!canSave()) return missing("Collages need the live database (supabase.json).");
  if (!userData.loaded || !collageById(id)) await loadCollages();
  const collage = collageById(id);
  if (!collage) return missing("This collage isn't here: it may be private, or deleted.");
  const mine = isMine(collage);

  // The page is drawn once, with the edit-only parts in it; [edit] and [done]
  // switch them on and off (a class on the page), so nothing typed is lost.
  const page = h("section", { class: "page collage-page" });
  const setEditing = (on) => page.classList.toggle("editing", on);

  // --- the cover, and "set cover"
  const coverBox = h("div", { class: "collage-cover-box" });
  const drawCover = () => coverBox.replaceChildren(...[collageCover(collage), mine ? coverPicker() : null].filter(Boolean));

  function coverPicker() {
    const panel = h("div", { class: "menu cover-menu", hidden: true });
    panel.addEventListener("click", (event) => event.stopPropagation());
    const bar = h("button", { class: "set-cover edit-only" }, "set cover");
    bar.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = panel.hidden;
      for (const m of document.querySelectorAll(".menu")) m.hidden = true;
      panel.hidden = !opening;
      if (opening) drawPanel();
    });
    const status = h("p", { class: "menu-note" });
    const choose = async (cover, waitingText) => {
      status.textContent = waitingText;
      try {
        await updateCollage(collage.id, { cover });
        drawCover();
      } catch (error) {
        status.textContent = `didn't work: ${error.message}`;
      }
    };
    const file = h("input", { type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", async () => {
      if (!file.files[0]) return;
      status.textContent = "uploading…";
      try {
        const address = await uploadCover(file.files[0]);
        await choose(address, "saving…");
      } catch (error) {
        status.textContent = `the upload didn't work: ${error.message}`;
      }
    });
    function drawPanel() {
      const art = collage.items.map((itemId) => data.byId.get(itemId)).filter((o) => o?.cover);
      panel.replaceChildren(...[    // (empty spots left out, or they'd show as "null")
        h("button", { class: "cover-upload", onclick: () => file.click() }, "upload an image…"),
        art.length ? h("p", { class: "menu-head" }, "or an item's art") : null,
        art.length ? h("div", { class: "cover-choices" }, art.map((o) => {
          const pick = h("button", { class: `cover-choice ${collage.cover === `object:${o.id}` ? "on" : ""}`, title: o.title }, cover(o, "small"));
          pick.addEventListener("click", () => choose(`object:${o.id}`, "saving…"));
          return pick;
        })) : null,
        collage.cover ? h("button", { class: "bracket cover-reset", onclick: () => choose(null, "saving…") }, "[back to the first four covers]") : null,
        status, file].filter(Boolean));
    }
    return h("div", { class: "cover-pick" }, bar, panel);
  }

  // --- the head: the name, and what it is
  const facts = h("p", { class: "byline view-only" });
  const count = h("span", {});
  const drawFacts = () => {
    facts.textContent = [plural(collage.items.length, "item", "items"), collage.is_public ? "public" : "private", mine ? "yours" : null]
      .filter(Boolean).join(" · ");
    count.textContent = plural(collage.items.length, "item", "items");
  };
  const title = h("h1", { class: "view-only" }, h("span", { class: "collage-title" }, collage.name),
    h("span", { class: "badge" }, "collage"),
    mine ? h("button", { class: "bracket", onclick: () => setEditing(true) }, "[edit]") : null);

  let editHead = null;
  const collageNotes = notesBlock(`collage:${collage.id}`);
  if (mine) {
    const name = h("input", { class: "collage-name", type: "text", maxlength: "80", spellcheck: "false", "aria-label": "name" });
    name.value = collage.name;
    const saveName = async () => {
      const value = name.value.trim();
      if (!value) { name.value = collage.name; return; }
      if (value === collage.name) return;
      try {
        await updateCollage(collage.id, { name: value });
        title.querySelector(".collage-title").textContent = collage.name;
      } catch (error) {
        name.value = collage.name;
      }
    };
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") name.blur(); });
    name.addEventListener("blur", saveName);
    const done = h("button", { class: "bracket" }, "[done]");
    done.addEventListener("click", async () => { await saveName(); setEditing(false); });
    const annotate = h("button", { class: "bracket" }, "[annotate collage]");
    annotate.addEventListener("click", () => {
      collageNotes.addNote();
      collageNotes.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    editHead = h("div", { class: "edit-only collage-edit-head" },
      h("div", { class: "collage-name-row" }, name, done),
      h("p", { class: "byline" }, count, " ", annotate));
  }
  drawFacts();

  // --- "in this set": the items, with their notes in this collage
  let itemNotes = new Map();
  try {
    for (const note of await notesStartingWith(`collage:${collage.id}:`)) {
      if (!itemNotes.has(note.about)) itemNotes.set(note.about, []);
      itemNotes.get(note.about).push(note);
    }
  } catch { itemNotes = new Map(); }

  const setCount = h("span", { class: "n" });
  const drawSetCount = () => { setCount.textContent = [mine ? "yours" : "shared", collage.items.length].join(" · "); };
  drawSetCount();
  let privacy = null;
  if (mine) {
    privacy = h("select", { class: "collage-privacy edit-only", "aria-label": "who can see this collage" },
      h("option", { value: "public" }, "public"), h("option", { value: "private" }, "private"));
    privacy.value = collage.is_public ? "public" : "private";
    privacy.addEventListener("change", async () => {
      try {
        await updateCollage(collage.id, { is_public: privacy.value === "public" });
        drawFacts();
      } catch {
        privacy.value = collage.is_public ? "public" : "private";
      }
    });
  }

  const items = h("div", { class: "collage-items" });
  function drawItems() {
    const objects = collage.items.map((itemId) => data.byId.get(itemId)).filter(Boolean);
    if (!objects.length) {
      items.replaceChildren(h("p", { class: "empty" },
        mine ? "Nothing here yet. Add releases and mixes from their pages, with the collage icon." : "Nothing here yet."));
      return;
    }
    items.replaceChildren(...objects.map((o) => {
      const about = `collage:${collage.id}:${o.id}`;
      const notes = notesBlock(about, { compact: true, preloaded: itemNotes.get(about) || [] });
      const actions = mine ? h("span", { class: "item-actions edit-only" },
        rowButton("annotate", () => notes.addNote()),
        rowButton("remove", async (button) => {
          button.disabled = true;
          try {
            await removeFromCollage(collage.id, o.id);
            itemNotes.delete(about);
            drawItems(); drawFacts(); drawSetCount(); drawCover();
          } catch {
            button.textContent = "didn't work";
          }
        })) : null;
      return h("div", { class: "collage-item" }, row(o, actions), notes);
    }));
  }
  drawItems();
  drawCover();

  // --- delete collage…
  let footer = null;
  if (mine) {
    const remove = h("button", { class: "note-button" }, "delete collage…");
    remove.addEventListener("click", async () => {
      if (!remove.dataset.sure) {
        remove.dataset.sure = "yes";
        remove.textContent = "really delete it? click again";
        return;
      }
      try {
        await deleteCollage(collage.id);
        location.hash = "#/profile";
      } catch (error) {
        remove.textContent = `didn't work: ${error.message}`;
      }
    });
    footer = h("div", { class: "collage-footer edit-only" }, remove);
  }

  page.append(
    h("article", { class: "release" }, coverBox, h("div", { class: "release-main" }, title, facts, editHead)),
    collageNotes,
    h("div", { class: "set-head" }, h("h3", {}, "in this set"), setCount, privacy),
    items,
    footer);
  return page;
}

// ---------------------------------------------------------------------------
// The profile page: who you're signed in as, your collages, your notes
// ---------------------------------------------------------------------------

export async function profilePage() {
  const user = me();
  if (!userData.loaded) await loadCollages();
  const mine = myCollages();
  const notes = h("div", { class: "profile-notes" }, h("p", { class: "count" }, "loading your notes…"));

  (async () => {
    let rows;
    try {
      rows = await myNotes();
    } catch (error) {
      notes.replaceChildren(h("p", { class: "empty" }, `Your notes couldn't be loaded: ${error.message}`));
      return;
    }
    // the notes on one thing together, the most recently written thing first
    const groups = new Map();
    for (const n of rows) {
      if (!groups.has(n.about)) groups.set(n.about, []);
      groups.get(n.about).push(n);
    }
    const shown = [...groups].map(([about, list]) => {
      let what = null;
      if (about.startsWith("collage:")) {
        const [, collageId, objectId] = about.split(":");
        const collage = collageById(collageId);
        if (collage && objectId && data.byId.has(objectId)) {
          what = row(data.byId.get(objectId), h("span", { class: "added" }, `in ${collage.name}`));
        } else if (collage && !objectId) {
          what = collageRow(collage, "");
        }
      } else if (data.byId.has(about)) {
        what = row(data.byId.get(about));
      }
      if (!what) return null;
      return h("div", { class: "profile-note" }, what, list.slice().reverse().map((n) =>
        h("div", { class: "profile-note-text" },
          h("p", { class: "note-body" }, n.body.length > 240 ? `${n.body.slice(0, 240).trim()}…` : n.body),
          h("p", { class: "note-meta" }, `${n.is_public ? "public" : "private"} · ${new Date(n.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`))));
    }).filter(Boolean);
    notes.replaceChildren(...(shown.length ? shown
      : [h("p", { class: "empty" }, "No notes yet. The pencil on a release, a mix or a collage starts one.")]));
  })();

  return h("section", { class: "page profile" },
    h("h1", {}, "profile"),
    h("p", { class: "byline" }, user?.guest ? "a guest, trying the beta" : user?.email || ""),
    user?.guest ? h("p", { class: "help" }, "Your notes and collages are saved to a guest account that belongs to this browser. Logging out ends it, so stay signed in to keep them.") : null,
    h("h2", {}, "Collages"),
    mine.length ? h("div", { class: "list" }, mine.map((c) => collageRow(c)))
      : h("p", { class: "empty" }, "No collages yet. The collage icon on a release or mix starts one."),
    h("div", { class: "chips" }, newCollageChip()),
    h("h2", {}, "Notes"),
    notes);
}

function missing(text) {
  return h("section", { class: "page" }, h("h1", {}, "Not found"), h("p", { class: "empty" }, text));
}

// ---------------------------------------------------------------------------
// For the library page and settings
// ---------------------------------------------------------------------------

// The collage chips on the library page: yours when signed in (so friends
// trying the beta don't fill it up), the public ones when not
export function collageChips() {
  if (!canSave()) return [];
  const all = me() ? myCollages() : userData.collages;
  return all.map((c) => h("a", { class: "chip collage", href: `#/collage/${c.id}`, title: c.is_public ? "public" : "private" },
    mi("collage", "small"), `${c.name} ${c.items.length}`, c.is_public ? null : mi("lock", "small")));
}

// "+ new collage" on the library page (signed in only)
export function newCollageChip() {
  if (!canSave() || !me()) return null;
  const chip = h("button", { class: "chip new-collage" }, "+ new collage");
  chip.addEventListener("click", () => {
    const name = h("input", { class: "chip collage-new-chip", type: "text", placeholder: "name it, then press enter", maxlength: "80" });
    name.addEventListener("keydown", async (event) => {
      if (event.key === "Escape") { name.replaceWith(chip); return; }
      if (event.key !== "Enter" || !name.value.trim()) return;
      name.disabled = true;
      try {
        const collage = await createCollage(name.value);
        location.hash = `#/collage/${collage.id}`;
      } catch (error) {
        name.disabled = false;
        name.value = "";
        name.placeholder = `didn't work: ${error.message}`;
      }
    });
    chip.replaceWith(name);
    name.focus();
  });
  return chip;
}

// Settings → library: bring the collages from the library file into your account.
// Collages with the same name are filled in, not made twice.
export async function bringInFileCollages() {
  let made = 0;
  let added = 0;
  for (const fileCollage of data.library.collages || []) {
    let collage = myCollages().find((c) => c.name.toLowerCase() === fileCollage.name.toLowerCase());
    if (!collage) { collage = await createCollage(fileCollage.name); made += 1; }
    for (const objectId of fileCollage.items) {
      const id = typeof objectId === "string" ? objectId : objectId.id;
      if (data.byId.has(id) && !collage.items.includes(id)) { await addToCollage(collage.id, id); added += 1; }
    }
  }
  return { made, added };
}
