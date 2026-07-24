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

Request flow:
`public/index.html` (textbox) → `POST /api/search` in `server.js` → Gemini
`generateContent` with the `googleSearch` tool → JSON `{ parsed, hotels }` →
rendered as the "What we understood" and "Matching hotels" sections.

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
| `server.js` | `/server.js` | Express server + `POST /api/search` endpoint; calls Gemini with the googleSearch tool and returns `{ parsed, hotels }`. |
| `public/index.html` | `/public/index.html` | Single-page frontend: request textbox + parsed-constraints + hotel-results sections. |
| `.env.example` | `/.env.example` | Template for `GEMINI_API_KEY` / `PORT`. |
| `.gitignore` | `/.gitignore` | Ignores `node_modules/`, `.env`, logs. |
| `system_health.md` | `/system_health.md` | IHMS operations hub — active state and trajectory. |
| `selfcorrection.md` | `/selfcorrection.md` | IHMS preference ledger — user feedback memory. |
| `wiki.md` | `/wiki.md` | IHMS project encyclopedia — this file. |

## Line References
_Specific anchors / line-number references linking documentation to exact lines of code._

- `server.js` — `SYSTEM_PROMPT` (constraint-extraction + search instructions and the
  required JSON output shape), passed as Gemini's `systemInstruction`.
- `server.js` — `POST /api/search` handler; single `generateContent` call with the
  `googleSearch` grounding tool.
- `server.js` — `extractJson()` parses the model's fenced ```json block.
- `public/index.html` — inline `<script>` `search()` calls `/api/search` and renders
  the parsed constraints and hotel cards.
