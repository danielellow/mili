// mili: dark or light, and the accent colour. Chosen on the settings page and
// kept in this browser (localStorage), so it's the same next time.

export const DEFAULT_ACCENT = "#2456e6";

export function readTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem("mili.theme") || "{}");
    return {
      dark: saved.dark !== false,                         // dark unless switched off
      accent: /^#[0-9a-f]{6}$/i.test(saved.accent || "") ? saved.accent : DEFAULT_ACCENT,
    };
  } catch {
    return { dark: true, accent: DEFAULT_ACCENT };
  }
}

export function applyTheme(theme = readTheme()) {
  document.documentElement.dataset.theme = theme.dark ? "dark" : "light";
  document.documentElement.style.setProperty("--accent", theme.accent);
}

export function saveTheme(theme) {
  try {
    localStorage.setItem("mili.theme", JSON.stringify(theme));
  } catch {
    // storage turned off: the choice still applies until the page is closed
  }
  applyTheme(theme);
}
