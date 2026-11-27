import { useEffect, useMemo, useRef, useState } from "react";
import { bookInfo } from "./covers.js";
import { bookKey, loadProgress, recentBooks } from "./library.js";
import { load, save } from "./storage.js";
import "./bookshelf.css";

const SORTS = {
  title: { label: "Title", compare: (a, b) => a.displayTitle.localeCompare(b.displayTitle) },
  added: { label: "Recently added", compare: (a, b) => b.modified.localeCompare(a.modified) },
};
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A stable colour per book for covers we have to draw ourselves.
function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// Thicker files look like thicker books, within reason.
function thickness(book, info) {
  if (info?.pages) return Math.min(34, 10 + info.pages / 20);
  return Math.min(30, Math.max(12, 6 + Math.log2(book.size / 1024) * 2));
}

function Cover({ book, info }) {
  if (info?.cover) return <img src={info.cover} alt="" draggable="false" />;
  const h = hue(book.title);
  return (
    <div className="drawn-cover" style={{ "--hue": h }}>
      <span className="drawn-title">{info?.title || book.title}</span>
      {info?.author && <span className="drawn-author">{info.author}</span>}
      <span className="drawn-format">{book.format.toUpperCase()}</span>
    </div>
  );
}

function Book({ book, info, onInfo, onOpen, opening }) {
  const ref = useRef(null);

  // Read the cover only when the book scrolls into view.
  useEffect(() => {
    if (info !== undefined) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      bookInfo(book).then((i) => onInfo(book.id, i));
    }, { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [book, info, onInfo]);

  const title = info?.title || book.title;
  const progress = loadProgress(bookKey(book.file, book.size));
  const depth = thickness(book, info);
  const coverBg = info?.cover ? `url(${info.cover})` : `hsl(${hue(book.title)} 45% 32%)`;

  return (
    <div className="book-slot" ref={ref}>
      <button
        className={`book ${opening ? "is-opening" : ""}`}
        style={{ "--d": `${depth}px`, "--cover": coverBg }}
        onClick={(e) => onOpen(book, info, e.currentTarget.querySelector(".book-3d").getBoundingClientRect())}
        aria-label={`Open ${title}${info?.author ? ` by ${info.author}` : ""}${progress ? `, ${progress}% read` : ""}`}
        title={title}
      >
        <div className="book-3d">
          <div className="book-face book-front"><Cover book={book} info={info} /></div>
          <div className="book-face book-spine" />
          <div className="book-face book-pages" />
          <div className="book-face book-top" />
          <div className="book-face book-back" />
        </div>
        {info === undefined && <span className="book-loading" aria-hidden />}
      </button>
      <div className="book-caption">
        <span className="caption-title">{title}</span>
        <span className="caption-meta">
          {info?.author || book.format.toUpperCase()}
          {progress > 0 && ` · ${progress}%`}
        </span>
        {progress > 0 && (
          <span className="caption-progress" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

function Shelf({ name, books, infos, onInfo, onOpen, openingId }) {
  const scroller = useRef(null);
  const scroll = (dir) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="shelf" aria-label={name}>
      <header className="shelf-head">
        <h2>{name}</h2>
        <span className="shelf-count">{books.length}</span>
        <div className="shelf-nav">
          <button onClick={() => scroll(-1)} aria-label={`Scroll ${name} left`}>‹</button>
          <button onClick={() => scroll(1)} aria-label={`Scroll ${name} right`}>›</button>
        </div>
      </header>
      <div className="shelf-track" ref={scroller}>
        {books.map((b) => (
          <Book key={b.id} book={b} info={infos[b.id]} onInfo={onInfo} onOpen={onOpen} opening={openingId === b.id} />
        ))}
      </div>
    </section>
  );
}

// The book flies to the middle of the screen and its cover swings open while the file loads.
function OpeningBook({ opening }) {
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setFlying(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { rect, book, info } = opening;
  const targetH = Math.min(window.innerHeight * 0.7, 560);
  const scale = targetH / rect.height;
  const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
  const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
  return (
    <div className={`opening-layer ${flying ? "flying" : ""}`} aria-hidden>
      <div
        className="opening-book"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform: flying ? `translate(${dx}px, ${dy}px) scale(${scale})` : "none",
        }}
      >
        <div className="opening-page">
          <span>{info?.title || book.title}</span>
        </div>
        <div className="opening-cover"><Cover book={book} info={info} /></div>
      </div>
    </div>
  );
}

export default function Bookshelf({ onOpen, onChooseFile }) {
  const [state, setState] = useState({ status: "loading" });
  const [infos, setInfos] = useState({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(() => load("smart-reader:shelf-sort", "title"));
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState(null);

  async function refresh() {
    setState((s) => ({ ...s, status: s.books ? "refreshing" : "loading" }));
    try {
      const res = await fetch("/api/shelf");
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const body = await res.json();
      setState({ status: "done", ...body });
    } catch (e) {
      setState({ status: "error", error: e instanceof TypeError ? "Could not reach the Smart Reader server. Is it running?" : e.message });
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => save("smart-reader:shelf-sort", sort), [sort]);

  const onInfo = useMemo(() => (id, info) => setInfos((m) => ({ ...m, [id]: info })), []);

  async function open(book, info, rect) {
    if (opening) return;
    setOpenError(null);
    setOpening({ book, info, rect });
    const animation = new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 1100));
    try {
      const res = await fetch(`/api/shelf/${book.id}/file`);
      if (!res.ok) throw new Error(res.status === 404 ? "This file is no longer in the shelf folder." : `The server answered ${res.status}.`);
      const data = await res.arrayBuffer();
      await animation;
      onOpen(book, data, info);
    } catch (e) {
      setOpenError(`Could not open “${info?.title || book.title}”. ${e.message}`);
      setOpening(null);
      refresh();
    }
  }

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state.books || [])
      .map((b) => ({ ...b, displayTitle: infos[b.id]?.title || b.title, author: infos[b.id]?.author || "" }))
      .filter((b) => !q || `${b.displayTitle} ${b.author} ${b.file} ${b.shelf}`.toLowerCase().includes(q))
      .sort(SORTS[sort].compare);
  }, [state.books, infos, query, sort]);

  const shelves = useMemo(() => {
    const groups = new Map();
    if (!query) {
      const byId = new Map(books.map((b) => [b.id, b]));
      const recent = recentBooks().map((r) => byId.get(r.id)).filter(Boolean);
      if (recent.length) groups.set("Continue reading", recent);
    }
    // Books at the top of the folder first, then one shelf per subfolder in name order.
    const folders = [...new Set(books.map((b) => b.shelf))].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    for (const folder of folders) groups.set(folder || "My shelf", books.filter((b) => b.shelf === folder));
    return [...groups];
  }, [books, query]);

  return (
    <div className="library">
      <div className="library-bar">
        <input
          type="search"
          className="library-search"
          placeholder="Search your books"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search your books"
        />
        <label className="lang">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </select>
        </label>
        <button onClick={refresh} disabled={state.status === "loading" || state.status === "refreshing"} title="Look for new books in the folder">
          {state.status === "refreshing" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {openError && <div className="banner error">{openError}</div>}

      <div className="library-wall">
        {state.status === "loading" && <p className="reader-message">Looking at your shelf…</p>}
        {state.status === "error" && <p className="reader-message error">{state.error}</p>}
        {state.status !== "loading" && state.status !== "error" && !state.dir && (
          <div className="welcome" onClick={onChooseFile}>
            <div className="welcome-icon">📚</div>
            <h1>Set up your bookshelf</h1>
            <p>Create a folder named <code>shelf</code> in your home folder and put your PDF and EPUB books in it, then press Refresh.</p>
            <p className="muted">Or set <code>SHELF_DIR</code> in <code>.env</code> to any folder. Subfolders become separate shelves. You can still click here to open a single file.</p>
          </div>
        )}
        {state.dir && state.books?.length === 0 && (
          <div className="welcome" onClick={onChooseFile}>
            <div className="welcome-icon">📚</div>
            <h1>Your shelf is empty</h1>
            <p>Put PDF or EPUB books in <code>{state.dir}</code>, then press Refresh.</p>
          </div>
        )}
        {state.dir && state.books?.length > 0 && books.length === 0 && <p className="reader-message">No book matches “{query}”.</p>}
        {shelves.map(([name, list]) => (
          <Shelf key={name} name={name} books={list} infos={infos} onInfo={onInfo} onOpen={open} openingId={opening?.book.id} />
        ))}
        {state.truncated && <p className="muted library-note">Showing the first 2,000 books.</p>}
      </div>

      {opening && !reduceMotion() && <OpeningBook opening={opening} />}
    </div>
  );
}
