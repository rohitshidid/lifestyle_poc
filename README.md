# lifestyle_poc

Concierge platform for touring musicians (proof of concept).

## What this POC does

A single-page web app where an artist (or their tour manager) types a free-form
paragraph describing a trip — location, dietary constraints, allergies, and any
other preferences. Gemini (`gemini-2.5-flash`) extracts the constraints, searches
the web live via Google Search grounding, and returns a list of real hotel links
that match those needs, with a note on how each one fits the dietary/allergy
requirements.

## Architecture

- **Frontend** — `public/index.html` (vanilla HTML/CSS/JS): a request textbox plus
  result sections (parsed constraints, and matching hotels).
- **Backend** — `server.js` (Node + Express): a `POST /api/search` endpoint that
  calls Gemini with the Google Search tool and returns structured JSON.
- **LLM** — `gemini-2.5-flash` (Google `@google/genai` SDK) with `googleSearch`
  grounding for real links.

## Running it

```bash
npm install
cp .env.example .env      # then paste your GEMINI_API_KEY into .env
npm start                 # serves http://localhost:3000
```

Requires a `GEMINI_API_KEY` (Google AI Studio).

## IHMS state files

This repo is maintained under the Intelligent Health Monitoring System workflow.
See `system_health.md`, `selfcorrection.md`, and `wiki.md` for the current state,
preference ledger, and codebase map.
