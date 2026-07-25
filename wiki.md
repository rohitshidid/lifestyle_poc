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

The data model is a three-level hierarchy:

```
Person (profile)
  ├── global constraints  (dietary, allergies, standing preferences, learned notes)
  ├── tools{} × 10        (per-service preferences + learned notes — see tools.js)
  └── tours[]
        └── threads{} keyed by tool
              ├── messages[]    (conversation for this tour + this service)
              ├── decisions[]   (locked in for this tour)
              └── considered[]  (options seen, chosen/rejected)
```

Each `(tour, tool)` pair is an independent conversation. Hotel preferences never
leak into transport, and one tour's decisions never leak into another's.

Request flow:
sidebar picks person + tour, tabs pick the service area → `POST /api/chat` with
`{profileId, tourId, toolId, message}` → `buildContext()` assembles global
constraints + that tool's preferences + the tour's locked-in decisions + already
considered options + the recent conversation → Gemini `generateContent` with the
`googleSearch` tool → `enforceAllergySafety()` → `appendThreadTurn()` persists the
turn, decisions, and considered options → `mergeLearnings()` splits durable facts
into global vs tool-scoped → JSON `{reply, options, decisions, supersededDecisions,
allergyWatch, thread, profile}`.

Because prior decisions and rejected options are in the prompt, a mid-conversation
route change ("we dropped Berlin, we're in Munich now") supersedes the affected
decisions and carries the rest forward rather than starting over.

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
| `server.js` | `/server.js` | Express server; profile/tour/thread routes + `POST /api/chat` (context build, Gemini call, allergy enforcement, thread persistence, learning merge). |
| `store.js` | `/store.js` | Persistence: JSON file at `data/profiles.json`, serialized writes, per-tool preferences, tours, threads, escalation-only allergy merge, additive learning. |
| `tools.js` | `/tools.js` | Catalog of the 10 service areas, each with an `allergyRelevant` flag, blurb, placeholder, and preference hint. |
| `public/index.html` | `/public/index.html` | Markup only: tool tabs, context strip, conversation thread, options, and the right sidebar. |
| `public/styles.css` | `/public/styles.css` | All styling — layout grid, chip editors, tool tabs, safety badges, memory items. |
| `public/app.js` | `/public/app.js` | Client logic: chip editors, person/tour/tool selection, thread rendering, chat, option status marking. |
| `data/profiles.json` | `/data/profiles.json` | Runtime profile storage (gitignored — created on first profile). |
| `.env.example` | `/.env.example` | Template for `GEMINI_API_KEY` / `PORT`. |
| `.gitignore` | `/.gitignore` | Ignores `node_modules/`, `.env`, logs. |
| `system_health.md` | `/system_health.md` | IHMS operations hub — active state and trajectory. |
| `selfcorrection.md` | `/selfcorrection.md` | IHMS preference ledger — user feedback memory. |
| `wiki.md` | `/wiki.md` | IHMS project encyclopedia — this file. |

## Line References
_Specific anchors / line-number references linking documentation to exact lines of code._

**`tools.js`**
- `TOOLS` — the 10 service areas. `allergyRelevant` decides whether the strict
  allergy verdict applies (true for hotel, dining, catering, grocery, medical).

**`server.js`**
- `SYSTEM_PROMPT` — memory rules, allergy safety rules, learning rules, and the
  required JSON output shape (Gemini `systemInstruction`).
- `buildContext()` — **the memory assembly.** Renders profile globals, that tool's
  preferences, the tour's locked-in decisions, already-considered options with
  status, and the last 12 conversation turns into the prompt preamble.
- `enforceAllergySafety()` — **the safety boundary.** Rewrites any missing,
  invalid, or unevidenced verdict to `unverified`; returns `not_applicable` when
  no allergies are recorded or the tool isn't allergy-relevant.
- Routes — `/api/tools`; profile CRUD; `PUT /api/profiles/:id/tools/:toolId`;
  tour create/delete; `GET .../threads/:toolId`; `POST .../threads/:toolId/status`.
- `POST /api/chat` — the main endpoint tying all of the above together.

**`store.js`**
- `normalizeProfile()` — backfills `tools`/`tours` so older files load cleanly.
- `mergeAllergies()` — escalation-only union; the downgrade guard lives here.
- `mergeStrings()` — case-insensitive union for list fields.
- `serialize()` — write queue preventing lost updates on concurrent requests.
- `appendThreadTurn()` — **tour memory.** Appends messages (window capped at 60),
  dedupes decisions, and upserts considered options with their status.
- `mergeLearnings(profileId, toolId, {global, tool})` — additive learning split
  between profile-wide and tool-scoped facts.
- `setToolPreferences`, `createTour`, `deleteTour`, `getThread`, `setOptionStatus`.

**`public/app.js`**
- `chipEditor()` — the reusable pill editor (Enter/comma adds, × removes,
  Backspace pops) that replaced the overflowing comma-separated inputs.
- `buildContext` counterparts: `renderToolTabs`, `renderContextStrip`,
  `renderThread`, `renderMemory`, `renderSidebar`.
- `send()` — posts `{profileId, tourId, toolId, message}`, renders the reply,
  options, allergy banner, and any `supersededDecisions` notice.
- `markOption()` — marks an option chosen/rejected, which feeds the next prompt.
- Active person/tour/tool persist in `localStorage` (`ihms.profile|tour|tool`).
