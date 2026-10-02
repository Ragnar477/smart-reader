# Smart Reader (version 1)

Read PDF and EPUB books in the browser. Select a word and Claude explains what it
means **in that sentence**, with pronunciation, an example and an optional
translation. Save words to a personal vocabulary list.

## What's in this version

- **Open PDF and EPUB** files from your computer (button or drag and drop). PDFs use
  PDF.js, EPUBs use epub.js. EPUBs remember where you stopped reading.
- **Select a word or short phrase** (up to 6 words). The app takes the sentence it is
  in plus one sentence on each side and asks Claude Haiku 4.5 for:
  - the meaning in this context, part of speech, and dictionary form
  - IPA pronunciation, plus a 🔊 button that reads it aloud with the browser's built-in speech
  - a short new example sentence
  - a translation into the language you pick in "Translate to" (optional)
  - a note when the word's usual meaning is different from this one
- **Vocabulary list**: save a word with its meaning and the sentence you found it in.
  Remove words or export the list as CSV (opens in Excel / Google Sheets / Anki import).

## Privacy

- The book file never leaves your device; it is opened directly in the browser.
- Only the selected word and about three sentences around it are sent to the server,
  which forwards them to Claude. The server does not log or store them.
- The vocabulary list, reading positions and settings are stored in the browser
  (`localStorage`) on this device only. Clearing site data deletes them.
- Your Anthropic API key stays on the server and is never sent to the browser.

## Run it locally

You need [Node.js](https://nodejs.org/) 20 or newer and an Anthropic API key
(create one at https://console.anthropic.com/).

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
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |
| `CLAUDE_MODEL` | `claude-haiku-4-5` | Model used for explanations |
| `PORT` | `5173` | Port for the app and API |

## How it's built

```
server.js            Express server: POST /api/explain -> Claude (structured JSON output)
                     In dev it also serves the React app through Vite.
src/App.jsx          Layout, file opening, lookups, vocabulary state
src/PdfReader.jsx    PDF.js pages with a selectable text layer, rendered lazily
src/EpubReader.jsx   epub.js paginated reader, font size, saved position
src/context.js       Turns a selection into { word, sentence, context }
src/ExplainPanel.jsx The explanation card
src/VocabList.jsx    Saved words and CSV export
src/speech.js        Browser text-to-speech
```

Each lookup is one small request to Claude Haiku 4.5 (well under 1,000 tokens in
total), so it costs a fraction of a cent per word. Repeated lookups of the same
word in the same passage are cached in the page. The server also limits each
visitor to 30 lookups a minute so a public deployment can't drain your key.

## Known limits

- **Scanned PDFs** (pages that are images) have no selectable text. The app shows a
  notice; reading them needs OCR, planned for later.
- Some PDFs with unusual layouts (multiple columns, footnotes) can give a messier
  surrounding sentence, which can make the explanation less precise.
- DRM-protected EPUBs (e.g. bought from Kindle or Apple Books) can't be opened.
- Pronunciation quality depends on the voices installed in the browser / OS.
- The vocabulary list is per browser; it does not sync between devices yet.

## Ideas for the next version

Flashcard review of saved words, OCR for scanned PDFs, sync of the vocabulary list
with an account, a mobile app wrapper, and more formats (MOBI, DOCX, TXT).
