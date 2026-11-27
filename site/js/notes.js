// mili: a note on a release, a mix or a collage.
//
// The pencil shows or hides the notes. Signed in, you get "notes on this…":
// one note of your own per thing, with save, cancel, and private or public
// (notes start private). Public notes by others show above it, to read.
// Not signed in, you see the public notes, and a link to sign in.
// Saved in Supabase (the notes table in supabase/user_data.sql).

import { h, mi } from "./ui.js";
import { canSave, me, notesAbout, saveNote } from "./account.js";

const when = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// about: a mili ID, or "collage:<collage id>"
export function notesBlock(about) {
  if (!canSave()) return null;          // no live database: nowhere to keep notes

  const toggle = h("button", { class: "note-toggle", title: "show notes", "aria-pressed": "false", "aria-label": "notes" }, mi("note"));
  const area = h("div", { class: "note-area", hidden: true });
  const box = h("div", { class: "notes" }, toggle, area);
  let mine = null;      // your note, if you have one
  let others = [];      // public notes by others

  function setOpen(open) {
    area.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    toggle.title = open ? "hide notes" : "show notes";
  }
  toggle.addEventListener("click", () => {
    setOpen(area.hidden);
    if (!area.hidden) area.querySelector("textarea")?.focus();
  });

  function marked() { toggle.classList.toggle("has", Boolean(mine || others.length)); }

  function draw() {
    const user = me();
    const shared = others.map((n) =>
      h("div", { class: "note shared" },
        h("p", { class: "note-body" }, n.body),
        h("p", { class: "note-meta" }, `a shared note · ${when(n.updated_at)}`)));

    if (!user) {
      area.replaceChildren(...shared,
        h("p", { class: "note-meta" }, h("a", { href: `#/sign-in?back=${encodeURIComponent(location.hash)}` }, "sign in"), " to write a note on this"));
      return;
    }

    let isPublic = mine?.is_public ?? false;
    const text = h("textarea", { class: "note-input", placeholder: "notes on this…", rows: "3", spellcheck: "true" });
    text.value = mine?.body || "";
    const save = h("button", { class: "note-button", disabled: true }, "save");
    const cancel = h("button", { class: "note-button" }, "cancel");
    const privacy = h("button", { class: "note-privacy", title: "who can read this note: click to change" });
    const status = h("span", { class: "note-meta" }, mine ? `saved ${when(mine.updated_at)}` : "");

    const changedSinceSaved = () => text.value !== (mine?.body || "") || isPublic !== (mine?.is_public ?? false);
    const drawPrivacy = () => privacy.replaceChildren(mi(isPublic ? "unlock" : "lock"), isPublic ? "public" : "private");
    const update = () => { save.disabled = !changedSinceSaved(); };
    const grow = () => { text.style.height = "auto"; text.style.height = `${Math.max(text.scrollHeight, 90)}px`; };
    drawPrivacy();

    text.addEventListener("input", () => { update(); grow(); });
    text.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !save.disabled) save.click();   // ⌘↵ saves
    });
    privacy.addEventListener("click", () => { isPublic = !isPublic; drawPrivacy(); update(); });
    cancel.addEventListener("click", () => {
      text.value = mine?.body || "";
      isPublic = mine?.is_public ?? false;
      drawPrivacy(); update(); grow();
      if (!mine) setOpen(false);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.textContent = "saving…";
      try {
        mine = await saveNote(about, text.value, isPublic);
        status.textContent = mine ? `saved ${when(mine.updated_at)}` : "note removed";
        if (!mine) { text.value = ""; isPublic = false; drawPrivacy(); }
        marked();
      } catch (error) {
        status.textContent = `couldn't save: ${error.message}`;
      }
      update();
    });

    area.replaceChildren(...shared, text, h("div", { class: "note-row" }, save, cancel, privacy, status));
    requestAnimationFrame(grow);
  }

  (async () => {
    try {
      const rows = await notesAbout(about);
      const user = me();
      mine = user ? rows.find((n) => n.owner === user.id) || null : null;
      others = rows.filter((n) => !user || n.owner !== user.id);
    } catch (error) {
      area.replaceChildren(h("p", { class: "note-meta" }, `notes couldn't be loaded: ${error.message}`));
      return;
    }
    marked();
    draw();
    if (mine || others.length) setOpen(true);       // a note shows without asking
  })();

  return box;
}
