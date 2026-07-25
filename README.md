# lifestyle_poc

Concierge platform for touring musicians (proof of concept).

## What this POC does

A single-page web app where an artist (or their tour manager) types a free-form
paragraph describing a trip — location, dietary constraints, allergies, and any
other preferences. Gemini (`gemini-2.5-flash`) extracts the constraints, searches
the web live via Google Search grounding, and returns a list of real hotel links
that match those needs, with a note on how each one fits the dietary/allergy
requirements.

## How it's organised

```
Person (profile)
  ├── global constraints  (dietary, allergies, standing preferences, learned notes)
  ├── tools × 10          (per-service preferences — hotel prefs ≠ transport prefs)
  └── tours
        └── one conversation thread per service area, each remembering
            its own messages, locked-in decisions, and considered options
```

Pick a **person** and a **tour** in the sidebar, pick a **service area** from the
tabs, and talk. The 10 service areas are hotels, dining, backstage catering,
groceries, ground transport, flights, venue logistics, wellness, medical, and
downtime.

## Tour memory

Each `(tour, service area)` pair is its own continuous conversation. Every message
is sent with the tour's locked-in decisions, the options already considered (and
which were rejected and why), and the recent conversation.

So mid-tour changes work the way you'd expect: say *"route changed, we dropped
Berlin — we're in Munich now"* and the concierge knows which decisions that
supersedes, doesn't re-propose the hotel you already rejected, and carries
everything still valid forward instead of starting over. Superseded decisions are
called out in the UI.

Mark any option **Choose** or **Reject** and that status feeds the next message.

## Continuous learning

After each exchange the system extracts **durable** facts and files them in the
right place — profile-wide ("travels with a 4-person crew") vs service-specific
("prefers boutique over chain hotels", stored on hotels only). Trip-specific
details stay out of the profile and live as tour decisions instead.

Learning is **additive only**: it can add or escalate a constraint, never delete one.

## Allergy safety

Allergies are treated as a stricter class than preferences:

- They are stored with a **severity** (`severe` / `moderate` / `mild`), and a merge
  can only ever *escalate* it — a downgrade is refused.
- Stored allergies stay in force even if a message forgets to mention them.
- On allergy-relevant service areas (hotels, dining, catering, groceries, medical)
  every option gets an explicit verdict — `verified` (evidence found), `unverified`
  (no allergen info), or `risk` (active conflict). **The model's verdict is not
  trusted**: a missing, malformed, or evidence-free "safe" claim is rewritten to
  `unverified` server-side before it reaches the user.
- Non-food areas like transport return `not_applicable`, so the warning means
  something when it does appear.
- Results carry a banner naming the active allergies and how many are unverified.

## Architecture

- **Frontend** — `public/index.html` + `styles.css` + `app.js` (vanilla): tool tabs,
  conversation thread, options, and the sidebar for person / tour / preferences /
  tour memory. List fields use chip editors rather than comma-separated inputs.
- **Backend** — `server.js` (Node + Express): profile, tool-preference, tour, and
  thread routes plus `POST /api/chat`, which assembles the memory context, calls
  Gemini, enforces allergy safety, persists the turn, and merges learnings.
- **Store** — `store.js`: JSON-file persistence at `data/profiles.json` (gitignored),
  with serialized writes and the escalation-only allergy merge.
- **Catalog** — `tools.js`: the 10 service areas and their allergy relevance.
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
