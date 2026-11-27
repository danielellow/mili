// mili: notes on a release, a mix, a collage, or an item in a collage.
//
// A thing can have as many notes as you like. A saved note shows as text,
// with [edit] and its lock: private (only you see it, the start) or public
// (anyone can read it; click the lock to change). "[+ note]" adds another.
// Public notes by others show too, to read. Not signed in, you see the
// public notes and a link to sign in.
//
//   notesBlock(about)                  with the pencil, which shows or hides the
//                                      notes and says how many there are: "(2)"
//   notesBlock(about, { compact })     just the notes, for under an item in a
//                                      collage; .addNote() opens a new one
//
// Saved in Supabase (the notes table in supabase/user_data.sql).

import { h, mi } from "./ui.js";
import { canSave, me, notesAbout, addNote, updateNote, deleteNote } from "./account.js";

const when = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const signInLink = () => `#/sign-in?back=${encodeURIComponent(location.hash)}`;

// The lock: private or public. onToggle(isPublic) saves the change.
function lockButton(isPublic, onToggle) {
  const button = h("button", { class: "note-privacy", title: "who can read this note: click to change" });
  const draw = (value) => button.replaceChildren(mi(value ? "unlock" : "lock"), value ? "public" : "private");
  draw(isPublic);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      isPublic = await onToggle(!isPublic);
      draw(isPublic);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

// about: what the notes are on. preloaded: the notes, when they're already
// fetched (the collage page fetches all its items' notes at once).
export function notesBlock(about, { compact = false, preloaded = null } = {}) {
  if (!canSave()) return null;          // no live database: nowhere to keep notes

  let notes = [];                       // the ones you can see, oldest first
  const list = h("div", { class: "note-list" });
  const adder = h("div", { class: "note-adder" });
  const area = h("div", { class: "note-area", hidden: !compact }, list, adder);
  const toggle = compact ? null : h("button", { class: "note-toggle", title: "show notes", "aria-pressed": "false", "aria-label": "notes" });
  const box = h("div", { class: compact ? "notes compact" : "notes" }, toggle, area);

  function setOpen(open) {
    if (compact) return;
    area.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    toggle.title = open ? "hide notes" : "show notes";
  }
  function drawToggle() {
    if (compact) return;
    toggle.replaceChildren(mi("note"), notes.length ? h("span", { class: "note-count" }, `(${notes.length})`) : null);
    toggle.classList.toggle("has", notes.length > 0);
  }
  toggle?.addEventListener("click", () => {
    setOpen(area.hidden);
    if (!area.hidden && !notes.length && me()) box.addNote();
  });

  // A note being written or changed: the text, save, cancel, the lock, and
  // for a saved note, delete. done(note | null) is called when it closes.
  function editor(note, done) {
    let isPublic = note?.is_public ?? false;
    const text = h("textarea", { class: "note-input", placeholder: "notes on this…", rows: "3" });
    text.value = note?.body || "";
    const save = h("button", { class: "note-button", disabled: true }, "save");
    const cancel = h("button", { class: "note-button" }, "cancel");
    const privacy = lockButton(isPublic, async (value) => { isPublic = value; update(); return value; });
    const remove = note ? h("button", { class: "bracket remove" }, "[delete]") : null;
    const status = h("span", { class: "note-meta" });
    const changed = () => text.value.trim() !== (note?.body || "").trim() || isPublic !== (note?.is_public ?? false);
    const update = () => { save.disabled = !text.value.trim() || !changed(); };
    const grow = () => { text.style.height = "auto"; text.style.height = `${Math.max(text.scrollHeight, 90)}px`; };

    text.addEventListener("input", () => { update(); grow(); });
    text.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !save.disabled) save.click();   // ⌘↵ saves
      if (event.key === "Escape") cancel.click();
    });
    cancel.addEventListener("click", () => done(note));
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.textContent = "saving…";
      try {
        const saved = note
          ? await updateNote(note.id, { body: text.value.trim(), is_public: isPublic })
          : await addNote(about, text.value.trim(), isPublic);
        done(saved);
      } catch (error) {
        status.textContent = `couldn't save: ${error.message}`;
        update();
      }
    });
    remove?.addEventListener("click", async () => {
      if (!remove.dataset.sure) { remove.dataset.sure = "yes"; remove.textContent = "[really? click again to delete it]"; return; }
      try {
        await deleteNote(note.id);
        done(null, true);
      } catch (error) {
        status.textContent = `couldn't delete: ${error.message}`;
      }
    });
    const wrap = h("div", { class: "note-editor" }, text, h("div", { class: "note-row" }, save, cancel, privacy, remove, status));
    requestAnimationFrame(() => { grow(); text.focus(); });
    return wrap;
  }

  // A saved note, as text
  function noteView(note) {
    const user = me();
    const view = h("div", { class: "note" });
    const draw = () => {
      if (user && note.owner === user.id) {
        const edit = h("button", { class: "note-button" }, "edit");
        edit.addEventListener("click", () => {
          view.replaceChildren(editor(note, (saved, deleted) => {
            if (deleted) {
              notes = notes.filter((n) => n.id !== note.id);
              view.remove();
              drawToggle();
              return;
            }
            if (saved) { Object.assign(note, saved); }
            draw();
          }));
        });
        const lock = lockButton(note.is_public, async (value) => {
          const saved = await updateNote(note.id, { is_public: value });
          Object.assign(note, saved);
          return note.is_public;
        });
        view.replaceChildren(h("p", { class: "note-body" }, note.body), h("div", { class: "note-row" }, edit, lock));
      } else {
        view.replaceChildren(h("p", { class: "note-body" }, note.body), h("p", { class: "note-meta" }, `a shared note · ${when(note.updated_at)}`));
      }
    };
    draw();
    return view;
  }

  function drawAdder() {
    if (compact) {
      adder.replaceChildren();          // under an item in a collage, "annotate" adds one
    } else if (me()) {
      const more = h("button", { class: "bracket note-more" }, "[+ note]");
      more.addEventListener("click", () => box.addNote());
      adder.replaceChildren(more);
    } else {
      adder.replaceChildren(h("p", { class: "note-meta" }, h("a", { href: signInLink() }, "sign in"), " to write a note on this"));
    }
  }

  function drawAll() {
    list.replaceChildren(...notes.map(noteView));
    drawToggle();
    drawAdder();
  }

  // open a new note at the end (the [+ note] link, "annotate", "annotate collage")
  box.addNote = () => {
    if (!me()) { location.hash = signInLink(); return; }
    setOpen(true);
    if (adder.querySelector(".note-editor")) { adder.querySelector("textarea")?.focus(); return; }
    adder.replaceChildren(editor(null, (saved) => {
      if (saved) notes.push(saved);
      drawAll();
    }));
  };

  (async () => {
    try {
      notes = preloaded ?? await notesAbout(about);
    } catch (error) {
      area.hidden = false;
      list.replaceChildren(h("p", { class: "note-meta" }, `notes couldn't be loaded: ${error.message}`));
      return;
    }
    drawAll();
    if (notes.length) setOpen(true);       // notes show without asking
  })();

  return box;
}
