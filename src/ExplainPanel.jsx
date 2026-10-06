import { useState } from "react";
import { canSpeak, speak } from "./speech.js";

function Highlighted({ text, word }) {
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </>
  );
}

export default function ExplainPanel({ lookup, onSave, isSaved, onRetry }) {
  const [showExample, setShowExample] = useState(true);

  if (!lookup) {
    return (
      <div className="panel-empty">
        <p className="panel-hint">Select a word in the book to see what it means in that sentence.</p>
        <p className="panel-sub">Double-click a word, or drag across a short phrase. Select a whole sentence or paragraph to have the passage explained.</p>
      </div>
    );
  }

  const { selection, status, result, error } = lookup;
  return (
    <div className="explain">
      <div className="explain-head">
        <h2>{selection.word}</h2>
        {canSpeak && (
          <button className="icon-btn" onClick={() => speak(selection.word, result?.source_language)} title="Pronounce" aria-label="Pronounce">
            🔊
          </button>
        )}
      </div>

      {status === "loading" && <p className="muted">Reading the sentence…</p>}
      {status === "error" && (
        <div className="error">
          <p>{error}</p>
          <button onClick={onRetry}>Try again</button>
        </div>
      )}

      {status === "done" && result && (
        <>
          <p className="meta">
            {result.ipa && <span className="ipa">/{result.ipa}/</span>}
            {result.part_of_speech && <span className="pos">{result.part_of_speech}</span>}
            {result.lemma && result.lemma.toLowerCase() !== selection.word.toLowerCase() && (
              <span className="lemma">from “{result.lemma}”</span>
            )}
          </p>

          <section>
            <h3>In this sentence</h3>
            <p className="meaning">{result.meaning_in_context}</p>
          </section>

          {result.translation && (
            <section>
              <h3>Translation</h3>
              <p className="translation">{result.translation}</p>
            </section>
          )}

          {result.example && (
            <section>
              <button className="link-btn" onClick={() => setShowExample(!showExample)}>
                {showExample ? "Hide example" : "Show example"}
              </button>
              {showExample && (
                <p className="example">
                  {result.example}
                  {canSpeak && (
                    <button className="icon-btn small" onClick={() => speak(result.example, result.source_language)} aria-label="Read example aloud">
                      🔊
                    </button>
                  )}
                </p>
              )}
            </section>
          )}

          {result.other_meaning_note && <p className="note">{result.other_meaning_note}</p>}

          <button className="primary save" onClick={onSave} disabled={isSaved}>
            {isSaved ? "✓ In your vocabulary" : "Save to vocabulary"}
          </button>
        </>
      )}

      <section className="context">
        <h3>From the book</h3>
        <blockquote>
          <Highlighted text={selection.sentence || selection.context} word={selection.word} />
        </blockquote>
      </section>
    </div>
  );
}
