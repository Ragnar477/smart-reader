import { useEffect, useRef, useState } from "react";
import pdfjs from "./pdf.js";
import "pdfjs-dist/web/pdf_viewer.css";
import { extractSelection } from "./context.js";
import { load, save } from "./storage.js";
import { saveProgress } from "./library.js";

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

export default function PdfReader({ data, bookKey, onSelect, onTitle, onNoText }) {
  const [doc, setDoc] = useState(null);
  const [pageSize, setPageSize] = useState(null);
  const [zoom, setZoom] = useState(1.25);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    // pdf.js takes ownership of the buffer, so hand it a copy.
    const task = pdfjs.getDocument({ data: data.slice(0) });
    task.promise
      .then(async (pdf) => {
        if (cancelled) return;
        const first = await pdf.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setPageSize({ width: vp.width, height: vp.height });
        setDoc(pdf);
        const meta = await pdf.getMetadata().catch(() => null);
        if (meta?.info?.Title) onTitle?.(meta.info.Title);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [data]);

  // Remember how far down the book you scrolled, and come back there next time.
  const positionKey = `smart-reader:pdf-pos:${bookKey}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !bookKey) return;
    const saved = load(positionKey, null);
    if (saved > 0) el.scrollTop = saved * (el.scrollHeight - el.clientHeight);
    let timer;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) return;
        const ratio = el.scrollTop / max;
        save(positionKey, ratio);
        saveProgress(bookKey, ratio * 100);
      }, 300);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [doc, pageSize, bookKey]);

  function handleSelection() {
    // Wait a tick so the browser has finished updating the selection.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const node = sel.getRangeAt(0).startContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const layer = el?.closest(".textLayer");
      if (!layer) return;
      const result = extractSelection(layer, sel);
      if (result) onSelect(result);
    }, 0);
  }

  if (error) return <div className="reader-message">Could not open this PDF: {error}</div>;
  if (!doc || !pageSize) return <div className="reader-message">Opening PDF…</div>;

  return (
    <div className="pdf-reader">
      <div className="reader-toolbar">
        <span>{doc.numPages} {doc.numPages === 1 ? "page" : "pages"}</span>
        <div className="zoom">
          <button onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} aria-label="Zoom out">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} aria-label="Zoom in">+</button>
        </div>
      </div>
      <div className="pdf-pages" ref={scrollRef} onMouseUp={handleSelection} onKeyUp={handleSelection} onTouchEnd={handleSelection}>
        {Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={`${i}-${zoom}`} doc={doc} number={i + 1} zoom={zoom} size={pageSize} root={scrollRef} onNoText={onNoText} />
        ))}
      </div>
    </div>
  );
}

// Each page renders its canvas and selectable text layer only when scrolled near.
function PdfPage({ doc, number, zoom, size, root, onNoText }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [dims, setDims] = useState({ width: size.width * zoom, height: size.height * zoom });

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { root: root.current, rootMargin: "800px 0px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask;
    let textLayer;
    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      setDims({ width: viewport.width, height: viewport.height });

      const container = ref.current;
      container.style.setProperty("--total-scale-factor", String(zoom));
      const canvas = container.querySelector("canvas");
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      renderTask = page.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });

      const textContent = await page.getTextContent();
      if (cancelled) return;
      if (textContent.items.length === 0) onNoText?.(number);
      const layerDiv = container.querySelector(".textLayer");
      layerDiv.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: layerDiv, viewport });
      await textLayer.render();
      await renderTask.promise.catch(() => {});
    })().catch((e) => console.warn(`Page ${number}:`, e));
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [visible]);

  return (
    <div className="pdf-page" ref={ref} style={{ width: dims.width, height: dims.height }} data-page={number}>
      <canvas style={{ width: dims.width, height: dims.height }} />
      <div className="textLayer" />
    </div>
  );
}
