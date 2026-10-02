import { canSpeak, speak } from "./speech.js";

function toCsv(items) {
  const cols = ["word", "meaning", "translation", "example", "sentence", "book", "savedAt"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...items.map((it) => cols.map((c) => esc(it[c])).join(","))].join("\n");
}

function download(items) {
  const blob = new Blob(["﻿" + toCsv(items)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "smart-reader-vocabulary.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function VocabList({ items, onRemove }) {
  if (items.length === 0) {
    return (
      <div className="panel-empty">
        <p className="panel-hint">Your vocabulary list is empty.</p>
        <p className="panel-sub">Words you save appear here. They stay on this device only.</p>
      </div>
    );
  }
  return (
    <div className="vocab">
      <div className="vocab-head">
        <span>{items.length} {items.length === 1 ? "word" : "words"}</span>
        <button onClick={() => download(items)}>Export CSV</button>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <div className="vocab-word">
              <strong>{it.word}</strong>
              {it.ipa && <span className="ipa">/{it.ipa}/</span>}
              {canSpeak && (
                <button className="icon-btn small" onClick={() => speak(it.word, it.lang)} aria-label={`Pronounce ${it.word}`}>
                  🔊
                </button>
              )}
              <button className="icon-btn small remove" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.word}`} title="Remove">
                ✕
              </button>
            </div>
            <p>{it.meaning}</p>
            {it.translation && <p className="translation">{it.translation}</p>}
            {it.sentence && <p className="vocab-sentence">“{it.sentence}”</p>}
            <p className="vocab-source">{it.book}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
