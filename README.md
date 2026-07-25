# lifestyle_poc

Concierge platform for touring musicians (proof of concept).

## What this POC does

A single-page web app where an artist (or their tour manager) types a free-form
paragraph describing a trip — location, dietary constraints, allergies, and any
other preferences. Gemini (`gemini-2.5-flash`) extracts the constraints, searches
the web live via Google Search grounding, and returns a list of real hotel links
that match those needs, with a note on how each one fits the dietary/allergy
requirements.

## Preference Profiles (continuous learning)

The right-hand sidebar manages per-artist profiles. Create a profile, and every
search runs against its stored dietary needs, allergies, and preferences — so the
artist never re-types them. After each search the system extracts any **durable**
new facts ("always wants a quiet room") and writes them back to the profile, while
ignoring trip-specific details. Each profile also keeps a short trip history.

Learning is **additive only**: it can add or escalate a constraint, never delete one.

## Allergy safety

Allergies are treated as a stricter class than preferences:

- They are stored with a **severity** (`severe` / `moderate` / `mild`), and a merge
  can only ever *escalate* it — a downgrade is refused.
- Stored allergies stay in force even if a request forgets to mention them.
- Every hotel gets an explicit verdict — `verified` (evidence found), `unverified`
  (no allergen info), or `risk` (active conflict). **The model's verdict is not
  trusted**: a missing, malformed, or evidence-free "safe" claim is rewritten to
  `unverified` server-side before it reaches the user.
- Results carry a warning banner naming the active allergies and how many results
  are unverified.

## Architecture

- **Frontend** — `public/index.html` (vanilla HTML/CSS/JS): request textbox, result
  sections, and the right-side profile sidebar.
- **Backend** — `server.js` (Node + Express): profile CRUD under `/api/profiles`
  plus `POST /api/search`, which injects the active profile, calls Gemini, enforces
  allergy safety, and merges learnings back.
- **Store** — `store.js`: JSON-file persistence at `data/profiles.json` (gitignored),
  with serialized writes and the escalation-only allergy merge.
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
