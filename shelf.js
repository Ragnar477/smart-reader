// Lists the PDF and EPUB files in the reader's shelf folder and serves them to the app.
// Subfolders become separate shelves. Files are only ever read, never changed.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const FORMATS = { ".pdf": "pdf", ".epub": "epub" };
const MAX_DEPTH = 3;
const MAX_BOOKS = 2000;

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// SHELF_DIR wins; otherwise the first "shelf" folder found in the usual places.
export function findShelfDir() {
  if (process.env.SHELF_DIR) return path.resolve(expandHome(process.env.SHELF_DIR));
  const home = os.homedir();
  const candidates = [
    path.join(home, "shelf"),
    path.join(home, "Shelf"),
    path.join(home, "Desktop", "shelf"),
    path.join(home, "Documents", "shelf"),
    path.join(home, "Desktop", "Shelf"),
    path.join(home, "Documents", "Shelf"),
    path.resolve("shelf"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

const toId = (relative) => Buffer.from(relative.split(path.sep).join("/")).toString("base64url");
const fromId = (id) => Buffer.from(id, "base64url").toString("utf8");

// "the_old_man-and_the.sea (2nd ed).epub" -> "the old man and the sea (2nd ed)"
function titleFromName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+-\s+|\.(?=\S)/g, " ").replace(/\s+/g, " ").trim();
}

async function scan(root, dir, depth, books) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (books.length >= MAX_BOOKS || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) await scan(root, full, depth + 1, books);
      continue;
    }
    const format = FORMATS[path.extname(entry.name).toLowerCase()];
    if (!format || !entry.isFile()) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    const relative = path.relative(root, full);
    const folder = path.dirname(relative);
    books.push({
      id: toId(relative),
      file: entry.name,
      title: titleFromName(entry.name),
      format,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      shelf: folder === "." ? "" : folder.split(path.sep).join(" / "),
    });
  }
}

export function registerShelfRoutes(app) {
  const dir = findShelfDir();
  if (dir) console.log(`Bookshelf folder: ${dir}`);
  else console.log("No shelf folder found. Create a folder named 'shelf' in your home folder, or set SHELF_DIR in .env.");

  app.get("/api/shelf", async (_req, res) => {
    if (!dir || !existsSync(dir)) return res.json({ dir: null, books: [] });
    const books = [];
    await scan(dir, dir, 0, books);
    books.sort((a, b) => a.shelf.localeCompare(b.shelf) || a.title.localeCompare(b.title));
    res.json({ dir, books, truncated: books.length >= MAX_BOOKS });
  });

  app.get("/api/shelf/:id/file", async (req, res) => {
    if (!dir) return res.status(404).end();
    const relative = fromId(req.params.id);
    const full = path.resolve(dir, relative);
    // Only files inside the shelf folder, and only books.
    if (!full.startsWith(dir + path.sep) || !FORMATS[path.extname(full).toLowerCase()]) return res.status(404).end();
    res.sendFile(full, { dotfiles: "deny" }, (err) => err && !res.headersSent && res.status(404).end());
  });
}
