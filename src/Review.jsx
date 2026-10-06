import { useEffect, useState } from "react";
import { canSpeak, speak } from "./speech.js";
import { GRADES, previewIntervals } from "./cards.js";

function Highlighted({ sentence, word }) {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (i === -1) return sentence;
  return (
    <>
      {sentence.slice(0, i)}
      <mark>{sentence.slice(i, i + word.length)}</mark>
      {sentence.slice(i + word.length)}
    </>
  );
}

export default function Review({ due, total, onGrade }) {
  const [revealed, setRevealed] = useState(false);
  const entry = due[0];

  useEffect(() => setRevealed(false), [entry?.id]);

  useEffect(() => {
    function onKey(e) {
      if (!entry || e.target.closest?.("input, select, textarea")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const g = GRADES.find((g) => g.key === e.key);
        if (g) onGrade(entry.id, g.rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, revealed, onGrade]);

  if (total === 0) {
    return (
      <div className="panel-empty">
        <p className="panel-hint">No flashcards yet.</p>
        <p className="panel-sub">Every word you save becomes a card. Reviews are spaced out so you remember words for good.</p>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="panel-empty">
        <p className="panel-hint">All done for now 🎉</p>
        <p className="panel-sub">Cards come back when it is time to review them again.</p>
      </div>
    );
  }

  const intervals = revealed ? previewIntervals(entry) : null;
  return (
    <div className="review">
      <p className="muted">{due.length} to review</p>
      <div className="flashcard">
        <div className="explain-head">
          <h2>{entry.word}</h2>
          {canSpeak && (
            <button className="icon-btn" onClick={() => speak(entry.word, entry.lang)} aria-label="Pronounce">
              🔊
            </button>
          )}
        </div>
        {entry.sentence && (
          <blockquote>
            <Highlighted sentence={entry.sentence} word={entry.word} />
          </blockquote>
        )}
        {entry.book && <p className="vocab-source">{entry.book}</p>}

        {revealed ? (
          <div className="answer">
            {entry.ipa && <p className="meta"><span className="ipa">/{entry.ipa}/</span></p>}
            <p className="meaning">{entry.meaning}</p>
            {entry.translation && <p className="translation">{entry.translation}</p>}
            {entry.example && <p className="example">{entry.example}</p>}
          </div>
        ) : (
          <button className="primary reveal" onClick={() => setRevealed(true)}>Show meaning</button>
        )}
      </div>

      {revealed && (
        <div className="grades">
          {GRADES.map((g) => (
            <button key={g.rating} className={`grade grade-${g.label.toLowerCase()}`} onClick={() => onGrade(entry.id, g.rating)}>
              <span>{g.label}</span>
              <small>{intervals[g.rating]}</small>
            </button>
          ))}
        </div>
      )}
      <p className="panel-sub">Do you remember what it means here? Space shows the answer, keys 1 to 4 grade it.</p>
    </div>
  );
}
