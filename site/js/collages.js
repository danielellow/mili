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

// A 2 × 2 of the first covers, or the collage icon when it's empty
function collageCover(collage, size = "large") {
  const objects = collage.items.map((id) => data.byId.get(id)).filter(Boolean).slice(0, 4);
  if (!objects.length) return h("div", { class: `cover ${size} collage-cover empty` }, mi("collage"));
  return h("div", { class: `cover ${size} collage-cover` }, objects.map((o) => cover(o, "small")));
}

// One collage as a row in a list (on the profile page); "meta" replaces
// its public/private label (for a note on it, the note's own)
function collageRow(collage, meta = null) {
  return h("a", { class: "row", href: `#/collage/${collage.id}` },
    collageCover(collage, "small"),
    h("div", { class: "row-text" },
      h("div", { class: "row-title" }, collage.name, h("span", { class: "badge" }, "collage")),
      h("div", { class: "byline" }, plural(collage.items.length, "item", "items"))),
    h("div", { class: "row-meta" }, h("span", { class: "added" }, meta ?? (collage.is_public ? "public" : "private"))));
}

export async function collagePage(id) {
  if (!canSave()) return missing("Collages need the live database (supabase.json).");
  if (!userData.loaded || !collageById(id)) await loadCollages();
  const collage = collageById(id);
  if (!collage) return missing("This collage isn't here: it may be private, or deleted.");
  const mine = isMine(collage);

  const page = h("section", { class: "page collage-page" });
  const head = h("div", { class: "release-main" });

  function drawHead(editing = false) {
    const facts = [plural(collage.items.length, "item", "items"), collage.is_public ? "public" : "private", mine ? "yours" : null]
      .filter(Boolean).join(" · ");
    if (!editing) {
      head.replaceChildren(
        h("h1", {}, collage.name, h("span", { class: "badge" }, "collage"),
          mine ? h("button", { class: "bracket", onclick: () => drawHead(true) }, "[edit]") : null),
        h("p", { class: "byline" }, facts));
      return;
    }
    // [edit]: the name, public or private, and deleting
    let isPublic = collage.is_public;
    const name = h("input", { class: "collage-name", type: "text", maxlength: "80", spellcheck: "false" });
    name.value = collage.name;
    const privacy = h("button", { class: "note-privacy" });
    const drawPrivacy = () => privacy.replaceChildren(mi(isPublic ? "unlock" : "lock"), isPublic ? "public" : "private");
    drawPrivacy();
    privacy.addEventListener("click", () => { isPublic = !isPublic; drawPrivacy(); });
    const status = h("span", { class: "note-meta" });
    const save = h("button", { class: "note-button" }, "save");
    const cancel = h("button", { class: "note-button", onclick: () => drawHead(false) }, "cancel");
    const remove = h("button", { class: "bracket danger" }, "[delete collage]");
    save.addEventListener("click", async () => {
      if (!name.value.trim()) { status.textContent = "a collage needs a name"; return; }
      save.disabled = true;
      try {
        await updateCollage(collage.id, { name: name.value.trim(), is_public: isPublic });
        drawHead(false);
      } catch (error) {
        status.textContent = `couldn't save: ${error.message}`;
        save.disabled = false;
      }
    });
    remove.addEventListener("click", async () => {
      if (!remove.dataset.sure) {
        remove.dataset.sure = "yes";
        remove.textContent = "[really? click again to delete it]";
        return;
      }
      try {
        await deleteCollage(collage.id);
        location.hash = "#/library";
      } catch (error) {
        status.textContent = `couldn't delete: ${error.message}`;
      }
    });
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") save.click();
      if (event.key === "Escape") drawHead(false);
    });
    head.replaceChildren(
      name,
      h("div", { class: "note-row" }, save, cancel, privacy, status),
      h("p", { class: "meta" }, remove));
    name.focus();
  }

  const items = h("div", { class: "list" });
  function drawItems() {
    const objects = collage.items.map((itemId) => data.byId.get(itemId)).filter(Boolean);
    if (!objects.length) {
      items.replaceChildren(h("p", { class: "empty" },
        mine ? "Nothing here yet. Add releases and mixes from their pages, with the collage icon."
          : "Nothing here yet."));
      return;
    }
    items.replaceChildren(...objects.map((o) => {
      const remove = mine ? h("button", { class: "bracket remove", title: "take it out of this collage" }, "[remove]") : null;
      remove?.addEventListener("click", async (event) => {
        event.preventDefault();          // the row is a link: don't follow it
        event.stopPropagation();
        remove.disabled = true;
        try {
          await removeFromCollage(collage.id, o.id);
          drawItems(); drawHead(false); coverBox.replaceChildren(collageCover(collage));
        } catch (error) {
          remove.textContent = "[didn't work]";
        }
      });
      return row(o, remove);
    }));
  }

  const coverBox = h("div", {}, collageCover(collage));
  drawHead(false);
  drawItems();
  page.append(
    h("article", { class: "release" }, coverBox, head),
    notesBlock(`collage:${collage.id}`),
    h("h3", { class: "set-head" }, "in this set",
      h("span", { class: "n" }, [mine ? "yours" : "shared", collage.items.length].join(" · "))),
    items);
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
    const shown = rows.map((n) => {
      // what the note is on: a release or mix, or a collage
      let what = null;
      if (n.about.startsWith("collage:")) {
        const collage = collageById(n.about.slice(8));
        if (collage) what = collageRow(collage, n.is_public ? "public" : "private");
      } else if (data.byId.has(n.about)) {
        what = row(data.byId.get(n.about), h("span", { class: "added" }, n.is_public ? "public" : "private"));
      }
      if (!what) return null;
      const text = n.body.length > 240 ? `${n.body.slice(0, 240).trim()}…` : n.body;
      return h("div", { class: "profile-note" }, what, h("p", { class: "note-body" }, text));
    }).filter(Boolean);
    notes.replaceChildren(...(shown.length ? shown
      : [h("p", { class: "empty" }, "No notes yet. The pencil on a release, a mix or a collage starts one.")]));
  })();

  return h("section", { class: "page profile" },
    h("h1", {}, "profile"),
    h("p", { class: "byline" }, user?.email || ""),
    h("h2", {}, "Collages"),
    mine.length ? h("div", { class: "list" }, mine.map(collageRow))
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

// The collage chips on the library page: yours first, then others' public ones
export function collageChips() {
  if (!canSave()) return [];
  const all = [...myCollages(), ...userData.collages.filter((c) => !isMine(c))];
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
