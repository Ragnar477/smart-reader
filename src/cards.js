// Spaced repetition for saved words, using the FSRS algorithm (ts-fsrs).
// Each vocabulary entry carries its own card; cards round-trip through JSON
// (localStorage), so dates are stored as ISO strings and parsed on use.
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

const scheduler = fsrs({ enable_fuzz: true });

export const GRADES = [
  { rating: Rating.Again, label: "Again", key: "1" },
  { rating: Rating.Hard, label: "Hard", key: "2" },
  { rating: Rating.Good, label: "Good", key: "3" },
  { rating: Rating.Easy, label: "Easy", key: "4" },
];

export function newCard(now = new Date()) {
  return createEmptyCard(now);
}

// Words saved before flashcards existed get a card that is due now.
export function withCard(entry) {
  return entry.card ? entry : { ...entry, card: newCard(new Date(entry.savedAt || Date.now())) };
}

export function isDue(entry, now = new Date()) {
  return new Date(withCard(entry).card.due) <= now;
}

export function dueEntries(entries, now = new Date()) {
  return entries
    .filter((e) => isDue(e, now))
    .sort((a, b) => new Date(withCard(a).card.due) - new Date(withCard(b).card.due));
}

export function grade(entry, rating, now = new Date()) {
  const { card } = scheduler.next(withCard(entry).card, now, rating);
  return { ...entry, card };
}

// "10 min", "3 days": when the card would come back for each grade.
export function previewIntervals(entry, now = new Date()) {
  const options = scheduler.repeat(withCard(entry).card, now);
  return Object.fromEntries(GRADES.map(({ rating }) => [rating, formatInterval(new Date(options[rating].card.due) - now)]));
}

function formatInterval(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo`;
  return `${Math.round(days / 365)} y`;
}
