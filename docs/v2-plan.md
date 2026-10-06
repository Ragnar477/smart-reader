# Smart Reader v2 plan

Goal: turn the single-browser v1 prototype into the launch product's foundation
(see the commercialization plan doc). v2 stays a web app; the mobile app (Expo)
starts after v2's backend exists.

## Scope, in build order

1. **Repo restructure into a monorepo**
   - `apps/web` (current React + Vite app), `apps/api` (server.js grown into a
     TypeScript service), `packages/core` (context extraction, explanation schema,
     flashcard scheduling) shared later with `apps/mobile`.
2. **Model provider layer**
   - One interface, two providers: Claude (Haiku 4.5 for lookups, Sonnet 5.5 for
     passages) and an OpenAI-compatible local endpoint (LM Studio / Gemma).
   - Chosen by env var; explanations always written in the user's native language.
3. **Native-language settings**
   - "I speak" and "I'm learning" settings; prompts use them for meaning, notes
     and examples, not only the translation field.
4. **Passage explain**
   - Select a sentence or paragraph: summary, simplified rewrite, grammar notes.
5. **Flashcards with spaced repetition (FSRS)**
   - Saved words become cards showing the original sentence; daily review screen.
6. **Accounts and sync**
   - Email magic-link login, PostgreSQL for vocabulary, cards, reading positions
     and settings; localStorage stays as the offline cache. Usage limits per plan
     (free: 20 explanations a day).
7. **Explanation cache**
   - Cache key: lemma + normalized sentence + target language; serves repeat
     lookups without a model call.

## Out of scope for v2

Mobile app, payments, chat with the book, OCR, teacher dashboard.

## Done when

- A user can sign in on two browsers and see the same vocabulary and cards.
- Lookups work with both Claude and the local model by changing one env var.
- Explanations come back in the chosen native language (checked in French,
  Spanish and Arabic).
