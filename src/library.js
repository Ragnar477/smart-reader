// Per-book reading state kept in the browser: recently opened books and how far you got.
import { load, save } from "./storage.js";

const RECENT_KEY = "smart-reader:recent";
const MAX_RECENT = 12;

// Same key as books opened with "Open book", so positions are shared.
export const bookKey = (file, size) => `${file}:${size}`;

export function recentBooks() {
  return load(RECENT_KEY, []);
}

export function markOpened(id) {
  save(RECENT_KEY, [{ id, openedAt: new Date().toISOString() }, ...recentBooks().filter((r) => r.id !== id)].slice(0, MAX_RECENT));
}

export function loadProgress(key) {
  return load(`smart-reader:progress:${key}`, null);
}

export function saveProgress(key, percent) {
  save(`smart-reader:progress:${key}`, Math.max(0, Math.min(100, Math.round(percent))));
}
