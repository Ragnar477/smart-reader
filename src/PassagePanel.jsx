import { canSpeak, speak } from "./speech.js";

export default function PassagePanel({ lookup, onRetry }) {
  const { selection, status, result, error } = lookup;
  return (
    <div className="explain passage">
      <div className="explain-head">
        <h2>Passage</h2>
        {canSpeak && (
          <button className="icon-btn" onClick={() => speak(selection.text, result?.source_language)} title="Read aloud" aria-label="Read passage aloud">
            🔊
          </button>
        )}
      </div>

      {status === "loading" && <p className="muted">Reading the passage…</p>}
      {status === "error" && (
        <div className="error">
          <p>{error}</p>
          <button onClick={onRetry}>Try again</button>
        </div>
      )}

      {status === "done" && result && (
        <>
          <section>
            <h3>What it says</h3>
            <p className="meaning">{result.summary}</p>
          </section>

          {result.simpler_version && (
            <section>
              <h3>In simpler words</h3>
              <p className="simpler">{result.simpler_version}</p>
            </section>
          )}

          {result.translation && (
            <section>
              <h3>Translation</h3>
              <p className="translation">{result.translation}</p>
            </section>
          )}

          {result.grammar_notes?.length > 0 && (
            <section>
              <h3>Grammar</h3>
              <ul className="notes">
                {result.grammar_notes.map((n, i) => (
                  <li key={i}>
                    <strong>{n.phrase}</strong> {n.note}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.key_words?.length > 0 && (
            <section>
              <h3>Key words</h3>
              <ul className="notes">
                {result.key_words.map((k, i) => (
                  <li key={i}>
                    <strong>{k.word}</strong> {k.meaning}
                  </li>
                ))}
              </ul>
              <p className="panel-sub">Select a single word in the book to save it as a flashcard.</p>
            </section>
          )}
        </>
      )}

      <section className="context">
        <h3>From the book</h3>
        <blockquote>{selection.text}</blockquote>
      </section>
    </div>
  );
}
