import { useEffect, useRef, useState } from "react";
import { bookInfo } from "./covers.js";
import { bookKey, loadProgress } from "./library.js";

// Covers we have to draw ourselves: the title on a colour picked from it.
function drawnCover(title, author) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)) % 360;
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 600;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 400, 600);
  grad.addColorStop(0, `hsl(${h} 50% 36%)`);
  grad.addColorStop(1, `hsl(${(h + 30) % 360} 55% 20%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 400, 600);
  g.fillStyle = "rgba(255,236,200,0.6)";
  g.fillRect(36, 48, 328, 3);
  g.fillStyle = "#fbf6ea";
  g.font = "600 40px Georgia, serif";
  let y = 120;
  let line = "";
  for (const word of title.split(/\s+/)) {
    if (g.measureText(`${line} ${word}`).width > 320 && line) {
      g.fillText(line, 36, y);
      y += 50;
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  g.fillText(line, 36, y);
  if (author) {
    g.font = "24px system-ui, sans-serif";
    g.globalAlpha = 0.85;
    g.fillText(author, 36, y + 50);
  }
  return c.toDataURL("image/jpeg", 0.9);
}

// The 3D carousel above the shelves. Three.js is only downloaded when this shows.
export default function CoverCarousel({ title, books, infos, onOpen, onFail }) {
  const mount = useRef(null);
  const carousel = useRef(null);
  const [center, setCenter] = useState(0);
  const [ready, setReady] = useState(false);
  const ids = books.map((b) => b.id).join("|");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [THREE, { createBookCarousel }, details] = await Promise.all([
          import("three"),
          import("./carousel3d.js"),
          Promise.all(books.map((b) => (infos[b.id] ? infos[b.id] : bookInfo(b)))),
        ]);
        if (cancelled) return;
        const covers = books.map((b, i) => ({
          cover: details[i]?.cover || drawnCover(details[i]?.title || b.title, details[i]?.author),
        }));
        carousel.current = createBookCarousel(THREE, mount.current, covers, {
          start: 0,
          onCenter: (i) => setCenter(i),
          onOpen: (i) => onOpenRef.current(i),
        });
        setReady(true);
      } catch (e) {
        console.warn("3D carousel unavailable:", e);
        if (!cancelled) onFail();
      }
    })();
    return () => {
      cancelled = true;
      carousel.current?.destroy();
      carousel.current = null;
    };
    // Rebuild only when the set of books changes.
  }, [ids]);

  const openAt = (i) => {
    const book = books[i];
    const rect = carousel.current?.centerRect() ?? mount.current.getBoundingClientRect();
    onOpen(book, infos[book.id], rect);
  };
  const onOpenRef = useRef(openAt);
  onOpenRef.current = openAt;

  const book = books[center];
  const info = book && infos[book.id];
  const progress = book ? loadProgress(bookKey(book.file, book.size)) : null;

  return (
    <section
      className="carousel"
      aria-label={title}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") carousel.current?.step(1);
        else if (e.key === "ArrowLeft") carousel.current?.step(-1);
        else if (e.key === "Enter") openAt(center);
        else return;
        e.preventDefault();
      }}
    >
      <header className="shelf-head">
        <h2>{title}</h2>
        <span className="shelf-count">{books.length}</span>
      </header>
      <div className="carousel-stage" ref={mount}>
        {!ready && <span className="carousel-loading">Setting up the books…</span>}
      </div>
      {book && (
        <div className="carousel-meta" aria-live="polite">
          <button className="carousel-arrow" onClick={() => carousel.current?.step(-1)} aria-label="Previous book">‹</button>
          <div className="carousel-caption">
            <strong>{info?.title || book.title}</strong>
            <span>
              {info?.author || book.format.toUpperCase()}
              {progress > 0 && ` · ${progress}% read`}
            </span>
            {progress > 0 && (
              <span className="caption-progress" aria-hidden>
                <span style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
          <button className="carousel-arrow" onClick={() => carousel.current?.step(1)} aria-label="Next book">›</button>
          <button className="primary carousel-open" onClick={() => openAt(center)}>
            {progress > 0 ? "Continue" : "Open"}
          </button>
        </div>
      )}
    </section>
  );
}
