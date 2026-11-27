// Cover image, title and author for books on the shelf, read from the files themselves
// (EPUB cover image and metadata, PDF first page and metadata). Results are cached in
// IndexedDB so the shelf opens instantly next time.
import ePub from "epubjs";
import pdfjs from "./pdf.js";

const DB_NAME = "smart-reader";
const STORE = "covers";
const COVER_HEIGHT = 360;

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function cacheGet(key) {
  try {
    const store = (await db()).transaction(STORE).objectStore(STORE);
    return await new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function cacheSet(key, value) {
  try {
    (await db()).transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    /* cache unavailable: covers are simply regenerated next time */
  }
}

function toJpeg(source, width, height) {
  const scale = COVER_HEIGHT / height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = COVER_HEIGHT;
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function epubInfo(data) {
  const book = ePub(data);
  try {
    // Wait for the whole package to load: destroying a half-loaded book throws inside epub.js.
    await book.ready;
    const meta = await book.loaded.metadata;
    let cover = null;
    const url = await book.coverUrl().catch(() => null);
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      cover = toJpeg(img, img.naturalWidth, img.naturalHeight);
    }
    return { title: meta?.title || "", author: meta?.creator || "", cover };
  } finally {
    book.destroy();
  }
}

async function pdfInfo(data) {
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata().catch(() => null);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: COVER_HEIGHT / page.getViewport({ scale: 1 }).height });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return {
      title: meta?.info?.Title || "",
      author: meta?.info?.Author || "",
      cover: canvas.toDataURL("image/jpeg", 0.82),
      pages: doc.numPages,
    };
  } finally {
    task.destroy();
  }
}

// Reading files is heavy, so at most two books are processed at a time.
const queue = [];
let running = 0;
function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < 2 && queue.length) {
    const { task, resolve, reject } = queue.shift();
    running++;
    task().then(resolve, reject).finally(() => {
      running--;
      pump();
    });
  }
}

export async function bookInfo(book) {
  const key = `${book.id}:${book.size}:${book.modified}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  return schedule(async () => {
    const empty = { title: "", author: "", cover: null };
    const res = await fetch(`/api/shelf/${book.id}/file`).catch(() => null);
    if (!res?.ok) return empty; // try again next time
    let info = empty;
    try {
      const data = await res.arrayBuffer();
      const read = book.format === "pdf" ? pdfInfo(data) : epubInfo(data);
      // A file that never finishes loading must not block the books behind it.
      info = await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 20000))]);
    } catch (e) {
      console.warn(`No cover for ${book.file}:`, e); // a damaged file stays coverless
    }
    await cacheSet(key, info);
    return info;
  });
}
