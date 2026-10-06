# Smart Reader

Read PDF and EPUB books in the browser. Select a word and Claude explains what it
means **in that sentence**, with pronunciation, an example and an optional
translation. Save words to a personal vocabulary list.

## What it does

- **Open PDF and EPUB** files from your computer (button or drag and drop). PDFs use
  PDF.js, EPUBs use epub.js. EPUBs remember where you stopped reading.
- **Select a word or short phrase** (up to 6 words) to get, for that sentence:
  the meaning in context, part of speech and dictionary form, IPA pronunciation with
  a 🔊 button, a new example sentence in the book's language, a translation, and a
  note when the word's usual meaning is different.
- **Select a longer passage** (a sentence or a paragraph, up to 2,000 characters) to
  get a short summary, a simpler rewrite in the book's language, a translation,
  grammar notes and the key words.
- **"I speak"**: pick your own language and every explanation is written in it, so a
  French speaker reading an English novel gets the meaning in French.
- **Vocabulary list**: save a word with its meaning and the sentence you found it in.
  Export it as CSV (Excel, Google Sheets, Anki import).
- **Review**: every saved word becomes a flashcard showing the sentence from the book.
  Reviews are scheduled with the FSRS spaced-repetition algorithm
  ([ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)); the tab shows how
  many cards are due. Keyboard: Space shows the answer, 1 to 4 grade it.

## Privacy

- The book file never leaves your device; it is opened directly in the browser.
- Only the selected word and about three sentences around it are sent to the server,
  which forwards them to the model. The server keeps recent answers in memory to
avoid repeat calls, and does not log or store them on disk.
- The vocabulary list, flashcards, reading positions and settings are stored in the browser
  (`localStorage`) on this device only. Clearing site data deletes them.
- Your Anthropic API key stays on the server and is never sent to the browser.

## Run it locally

You need [Node.js](https://nodejs.org/) 20 or newer and either an Anthropic API key
(create one at https://console.anthropic.com/) or a local model server such as
LM Studio.

```bash
cd smart-reader
npm install
cp .env.example .env        # then paste your key into .env
npm run dev                 # opens on http://localhost:5173
```

Open http://localhost:5173, click **Open book**, and select a word.

To run the production build instead:

```bash
npm run build
npm start                   # serves dist/ and the API on http://localhost:5173
```

Settings in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `claude` | `claude` for the Anthropic API, `local` for an OpenAI-compatible local server |
| `ANTHROPIC_API_KEY` | (required for `claude`) | Your Anthropic API key |
| `CLAUDE_MODEL` | `claude-haiku-4-5` | Model for word lookups |
| `CLAUDE_PASSAGE_MODEL` | `claude-sonnet-5-5` | Model for passage explanations |
| `LOCAL_LLM_URL` | `http://localhost:1234/v1` | Local server URL (LM Studio's default) |
| `LOCAL_LLM_MODEL` | (server default) | Model name to request from the local server |
| `LOCAL_LLM_TIMEOUT` | `120` | Seconds to wait for the local model before showing an error |
| `PORT` | `5173` | Port for the app and API |

### Using a local model (LM Studio)

Start LM Studio's local server with a model loaded, then set `LLM_PROVIDER=local` in
`.env` (and `LOCAL_LLM_MODEL` if several models are loaded). The app asks the model
for JSON that matches a schema; small models handle English well but are weaker at
explanations in other languages, which is where Claude is the better choice.

## How it's built

```
server.js            Express server: POST /api/explain (word) and /api/explain-passage,
                     in-memory answer cache, rate limit. In dev it also serves Vite.
llm.js               Model providers: Claude (structured output) or a local
                     OpenAI-compatible server (JSON schema response format)
src/App.jsx          Layout, file opening, lookups, vocabulary state
src/PdfReader.jsx    PDF.js pages with a selectable text layer, rendered lazily
src/EpubReader.jsx   epub.js paginated reader, font size, saved position
src/context.js       Turns a selection into { word, sentence, context }
src/ExplainPanel.jsx The word explanation card
src/PassagePanel.jsx The passage explanation card
src/cards.js         FSRS flashcard scheduling for saved words
src/Review.jsx       Flashcard review
src/VocabList.jsx    Saved words and CSV export
src/speech.js        Browser text-to-speech
```

Each word lookup is one small request to Claude Haiku 4.5 (well under 1,000 tokens in
total), so it costs a fraction of a cent per word. Passages go to Claude Sonnet 5.5 at
low effort. Repeated lookups of the same word in the same passage are cached in the
page and on the server. The server also limits each
visitor to 30 lookups a minute so a public deployment can't drain your key.

## Known limits

- **Scanned PDFs** (pages that are images) have no selectable text. The app shows a
  notice; reading them needs OCR, planned for later.
- Some PDFs with unusual layouts (multiple columns, footnotes) can give a messier
  surrounding sentence, which can make the explanation less precise.
- DRM-protected EPUBs (e.g. bought from Kindle or Apple Books) can't be opened.
- Pronunciation quality depends on the voices installed in the browser / OS.
- The vocabulary list and flashcards are per browser; they do not sync between devices yet.

## What's next

See [docs/v2-plan.md](docs/v2-plan.md): accounts and sync across devices come next,
then the mobile app.
