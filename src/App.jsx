import { useCallback, useEffect, useRef, useState } from "react";
import PdfReader from "./PdfReader.jsx";
import EpubReader from "./EpubReader.jsx";
import ExplainPanel from "./ExplainPanel.jsx";
import VocabList from "./VocabList.jsx";
import { load, save } from "./storage.js";

const LANGUAGES = [
  "", "English", "French", "Arabic", "Spanish", "German", "Italian", "Portuguese",
  "Dutch", "Turkish", "Russian", "Chinese (Simplified)", "Japanese", "Korean", "Hindi",
];
const VOCAB_KEY = "smart-reader:vocabulary";

function detectFormat(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".epub") || file.type === "application/epub+zip") return "epub";
  return null;
}

export default function App() {
  const [book, setBook] = useState(null); // { format, data, name, key, title }
  const [openError, setOpenError] = useState(null);
  const [noTextPages, setNoTextPages] = useState(0);
  const [lookup, setLookup] = useState(null); // { selection, status, result, error }
  const [tab, setTab] = useState("explain");
  const [vocab, setVocab] = useState(() => load(VOCAB_KEY, []));
  const [targetLanguage, setTargetLanguage] = useState(() => load("smart-reader:target-language", ""));
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const abortRef = useRef(null);
  const cache = useRef(new Map());

  useEffect(() => save(VOCAB_KEY, vocab), [vocab]);
  useEffect(() => save("smart-reader:target-language", targetLanguage), [targetLanguage]);

  async function openFile(file) {
    if (!file) return;
    const format = detectFormat(file);
    if (!format) {
      setOpenError("Smart Reader opens PDF and EPUB files.");
      return;
    }
    setOpenError(null);
    setNoTextPages(0);
    setLookup(null);
    const data = await file.arrayBuffer();
    setBook({ format, data, name: file.name, key: `${file.name}:${file.size}`, title: file.name.replace(/\.(pdf|epub)$/i, "") });
  }

  const explain = useCallback(
    async (selection) => {
      setTab("explain");
      const cacheKey = `${selection.word}|${selection.context}|${targetLanguage}`;
      if (cache.current.has(cacheKey)) {
        setLookup({ selection, status: "done", result: cache.current.get(cacheKey) });
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLookup({ selection, status: "loading" });
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: selection.word, context: selection.context, targetLanguage }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
        cache.current.set(cacheKey, body);
        setLookup({ selection, status: "done", result: body });
      } catch (e) {
        if (e.name === "AbortError") return;
        const msg = e instanceof TypeError ? "Could not reach the Smart Reader server. Is it running?" : e.message;
        setLookup({ selection, status: "error", error: msg });
      }
    },
    [targetLanguage],
  );

  const isSaved =
    lookup?.status === "done" &&
    vocab.some((v) => v.word.toLowerCase() === lookup.selection.word.toLowerCase() && v.sentence === lookup.selection.sentence);

  function saveWord() {
    const { selection, result } = lookup;
    const entry = {
      id: crypto.randomUUID?.() ?? String(Date.now()),
      word: selection.word,
      lemma: result.lemma,
      ipa: result.ipa,
      lang: result.source_language,
      meaning: result.meaning_in_context,
      translation: result.translation,
      example: result.example,
      sentence: selection.sentence,
      book: book?.title ?? "",
      savedAt: new Date().toISOString(),
    };
    setVocab((v) => [entry, ...v]);
  }

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    openFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="app" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <span aria-hidden>📖</span> Smart Reader
          {book && <span className="book-title" title={book.title}>· {book.title}</span>}
        </div>
        <div className="topbar-actions">
          <label className="lang">
            Translate to
            <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l || "No translation"}</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => fileInput.current.click()}>Open book</button>
          <input ref={fileInput} type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden
            onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </header>

      <main className="layout">
        <section className={`reader ${dragging ? "dragging" : ""}`}>
          {!book && (
            <div className="welcome" onClick={() => fileInput.current.click()}>
              <div className="welcome-icon">📚</div>
              <h1>Open a book to start reading</h1>
              <p>Drop a PDF or EPUB here, or click to choose one.</p>
              <p className="muted">Your book stays on this device. Only the sentences around a word you select are sent for an explanation.</p>
              {openError && <p className="error">{openError}</p>}
            </div>
          )}
          {book && openError && <div className="banner error">{openError}</div>}
          {book?.format === "pdf" && noTextPages > 0 && (
            <div className="banner">Some pages have no selectable text. This PDF may be scanned images, which this version can’t read yet.</div>
          )}
          {book?.format === "pdf" && (
            <PdfReader key={book.key} data={book.data} onSelect={explain}
              onTitle={(t) => setBook((b) => ({ ...b, title: t }))} onNoText={() => setNoTextPages((n) => n + 1)} />
          )}
          {book?.format === "epub" && (
            <EpubReader key={book.key} data={book.data} bookKey={book.key} onSelect={explain}
              onTitle={(t) => setBook((b) => ({ ...b, title: t }))} />
          )}
        </section>

        <aside className="panel">
          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "explain"} className={tab === "explain" ? "active" : ""} onClick={() => setTab("explain")}>
              Explanation
            </button>
            <button role="tab" aria-selected={tab === "vocab"} className={tab === "vocab" ? "active" : ""} onClick={() => setTab("vocab")}>
              Vocabulary{vocab.length > 0 && <span className="count">{vocab.length}</span>}
            </button>
          </nav>
          <div className="panel-body">
            {tab === "explain" ? (
              <ExplainPanel lookup={lookup} onSave={saveWord} isSaved={isSaved} onRetry={() => lookup && explain(lookup.selection)} />
            ) : (
              <VocabList items={vocab} onRemove={(id) => setVocab((v) => v.filter((x) => x.id !== id))} />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
