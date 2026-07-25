# Project Wiki — The Encyclopedia

> Maintained by the IHMS (Intelligent Health Monitoring System).
> The definitive map of the codebase: architectural overviews, a file index, and
> line-number anchors linking documentation to the exact code it describes.

_Last updated: 2026-07-23_

## Architectural Overview
_High-level description of the project structure and how the pieces fit together._

`lifestyle_poc` is a proof-of-concept for a **concierge / lifestyle-management
platform for touring musicians**. Artists onboard once; the platform stores their
preferences and manages bookings/logistics (housing, hotels, restaurants, food
preferences, transport, etc.) on their behalf.

The first working slice is a **natural-language hotel finder**: the user types a
free-form paragraph (location + dietary constraints + allergies + preferences),
and Gemini (`gemini-2.5-flash`) extracts the constraints, searches the web live via
the `googleSearch` grounding tool, and returns real hotel links that match.

Layered on top of that are **Preference Profiles** (persistent per-artist
constraints that learn from each interaction) and a **safety-critical allergy
layer** that treats allergies as a stricter class than preferences.

Request flow:
`public/index.html` (textbox + right-side profile sidebar) → `POST /api/search`
in `server.js`, which injects the active profile's stored constraints into the
prompt → Gemini `generateContent` with the `googleSearch` tool → the response
passes through `enforceAllergySafety` → durable facts are merged back into the
profile via `store.js` → JSON `{ parsed, hotels, allergyWatch, profileUpdates,
profile }` → rendered as "What we understood" / "Matching hotels" / sidebar.

Two invariants worth knowing before editing this code:
- **Allergy severity only escalates.** A merge can raise `mild → severe` but never
  the reverse (`store.js` → `mergeAllergies`).
- **The model's allergy verdict is not trusted.** `enforceAllergySafety` in
  `server.js` is the real boundary: a missing, malformed, or evidence-free "safe"
  verdict is rewritten to `unverified` before it reaches the user.

Status: the Gemini-backed hotel finder is working end-to-end against a live
`GEMINI_API_KEY` (verified 2026-07-24). The AI/ML roadmap for hardening it into a
full concierge is tracked in `system_health.md` → Upcoming Goals.

Intended domain concepts (partially realised):
- **Artist** and their **Preference Profile** (persistent source of truth — not yet
  persisted; today constraints are parsed per request).
- **Tour / Itinerary** — the central timeline; bookings attach to a city + date.
- **Booking** — a lodging/dining/transport reservation driven by the profile.
- **Vendor / Partner** — hotels, restaurants, drivers, with reliability ratings.
- **Feedback** — post-experience signal that refines the Preference Profile.

## File Index
_A detailed registry of what each file does and its exact location._

| File | Location | Purpose |
| ---- | -------- | ------- |
| `README.md` | `/README.md` | Project overview and run instructions. |
| `package.json` | `/package.json` | Node project manifest (ESM); deps: `@google/genai`, `express`, `dotenv`; `npm start` → `server.js`. |
| `server.js` | `/server.js` | Express server; profile CRUD (`/api/profiles`) + `POST /api/search` (profile-aware Gemini call, allergy enforcement, learning merge). |
| `store.js` | `/store.js` | Preference Profile persistence: JSON file at `data/profiles.json`, serialized writes, escalation-only allergy merge, additive learning. |
| `public/index.html` | `/public/index.html` | Single-page frontend: request textbox, parsed-constraints, hotel results with allergy verdicts, and the right-side profile sidebar. |
| `data/profiles.json` | `/data/profiles.json` | Runtime profile storage (gitignored — created on first profile). |
| `.env.example` | `/.env.example` | Template for `GEMINI_API_KEY` / `PORT`. |
| `.gitignore` | `/.gitignore` | Ignores `node_modules/`, `.env`, logs. |
| `system_health.md` | `/system_health.md` | IHMS operations hub — active state and trajectory. |
| `selfcorrection.md` | `/selfcorrection.md` | IHMS preference ledger — user feedback memory. |
| `wiki.md` | `/wiki.md` | IHMS project encyclopedia — this file. |

## Line References
_Specific anchors / line-number references linking documentation to exact lines of code._

**`server.js`**
- `SYSTEM_PROMPT` — extraction + search instructions, the allergy safety rules, the
  learning rules, and the required JSON output shape (Gemini `systemInstruction`).
- `profileContext()` — renders a stored profile into the prompt preamble.
- `enforceAllergySafety()` — **the safety boundary.** Rewrites any missing,
  invalid, or unevidenced verdict to `unverified`; forces `not_applicable` when no
  allergies are on record.
- `severeAllergyNames()` — feeds the UI's severe-allergy warning banner.
- Profile routes — `GET/POST /api/profiles`, `GET/PATCH/DELETE /api/profiles/:id`.
- `POST /api/search` — loads the profile, calls Gemini, enforces allergy safety,
  builds `allergyWatch`, then merges learnings back into the profile.

**`store.js`**
- `SEVERITY_RANK` / `normalizeSeverity()` — maps free text ("anaphylactic") to a
  ranked severity.
- `mergeAllergies()` — escalation-only union; the downgrade guard lives here.
- `mergeStrings()` — case-insensitive union for dietary / preferences / notes.
- `serialize()` — write queue preventing lost updates on concurrent requests.
- `mergeLearnings()` — additive continuous-learning merge + trip history (capped at 25).
- CRUD: `listProfiles`, `getProfile`, `createProfile`, `updateProfile`, `deleteProfile`.

**`public/index.html`** (inline `<script>`)
- `loadProfiles()` / `renderProfileList()` / `renderEditor()` — the right-side sidebar.
- `selectProfile()` — active profile persisted in `localStorage` (`ihms.activeProfile`).
- `parseAllergyInput()` — parses the `name:severity` sidebar syntax.
- `search()` — posts `{ request, profileId }`, renders results, the allergy banner,
  per-hotel verdicts, and the "Learned & saved" panel.
