import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import { extractSelection } from "./context.js";
import { load, save } from "./storage.js";

export default function EpubReader({ data, bookKey, onSelect, onTitle }) {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [fontSize, setFontSize] = useState(() => load("smart-reader:epub-font", 110));
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const book = ePub(data.slice(0));
    const rendition = book.renderTo(viewerRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    rendition.themes.default({
      body: { "line-height": "1.6 !important", padding: "0 8px !important" },
      "::selection": { background: "rgba(255, 196, 0, 0.45)" },
    });
    rendition.themes.fontSize(`${fontSize}%`);

    const positionKey = `smart-reader:pos:${bookKey}`;
    rendition.display(load(positionKey, undefined)).catch((e) => setError(e.message));
    book.loaded.metadata.then((m) => m?.title && onTitle?.(m.title)).catch(() => {});
    book.ready.then(() => book.locations.generate(1200)).catch(() => {});

    rendition.on("relocated", (location) => {
      save(positionKey, location.start.cfi);
      const pct = location.start.percentage;
      if (typeof pct === "number" && pct > 0) setProgress(Math.round(pct * 100));
    });

    rendition.on("selected", (_cfiRange, contents) => {
      const result = extractSelection(contents.document.body, contents.window.getSelection());
      if (result) onSelectRef.current(result);
    });

    const onKey = (e) => {
      if (e.key === "ArrowRight") rendition.next();
      if (e.key === "ArrowLeft") rendition.prev();
    };
    rendition.on("keyup", onKey);
    window.addEventListener("keyup", onKey);

    return () => {
      window.removeEventListener("keyup", onKey);
      book.destroy();
    };
  }, [data, bookKey]);

  function changeFont(delta) {
    const next = Math.min(200, Math.max(70, fontSize + delta));
    setFontSize(next);
    save("smart-reader:epub-font", next);
    renditionRef.current?.themes.fontSize(`${next}%`);
  }

  return (
    <div className="epub-reader">
      <div className="reader-toolbar">
        <span>{progress != null ? `${progress}% read` : "EPUB"}</span>
        <div className="zoom">
          <button onClick={() => changeFont(-10)} aria-label="Smaller text">A−</button>
          <button onClick={() => changeFont(10)} aria-label="Larger text">A+</button>
        </div>
      </div>
      {error && <div className="reader-message">Could not open this EPUB: {error}</div>}
      <div className="epub-stage">
        <button className="page-turn" onClick={() => renditionRef.current?.prev()} aria-label="Previous page">‹</button>
        <div className="epub-viewer" ref={viewerRef} />
        <button className="page-turn" onClick={() => renditionRef.current?.next()} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
