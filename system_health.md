# System Health — Operations Hub

> Maintained by the IHMS (Intelligent Health Monitoring System).
> Tracks the active state and trajectory of the project. Updated after every interaction.

_Last updated: 2026-07-24_

## Product Vision
A concierge / lifestyle-management platform for touring musicians. Artists (and/or
their tour managers) onboard once; the system captures their preferences and takes
over bookings and logistics — housing/hotels, restaurants, food preferences,
transport, and everything around a tour — so the artist never has to manage their
own preferences again.

**Core concepts driving the design:**
- **Preference Profile** — a rich, persistent, per-artist profile (dietary/allergies,
  cuisine likes/dislikes, room preferences, brand loyalties, accessibility, budget
  tiers, always/never rules). The product's moat; improves over time via feedback.
- **Tour / Itinerary** — the central timeline object. Bookings attach to a city on a
  date on a tour.
- **Preference-driven booking engine** — proposes options pre-filtered by profile.
- **Post-experience feedback loop** — feeds learned preferences back in.
- **Vendor / partner network** — first-class entity (hotels, restaurants, drivers)
  with reliability ratings.

## Non-Negotiables
_Core architectural rules, tech stack constraints, and absolute boundaries._

- Tech stack (POC): Node.js + Express backend, vanilla HTML/CSS/JS frontend.
- LLM provider: Google Gemini, model `gemini-2.5-flash`, via the official
  `@google/genai` SDK. Hotel links come from the `googleSearch` grounding tool —
  never fabricate links.
- Secrets (`GEMINI_API_KEY`) live only in `.env` (gitignored), never committed.

## Active Rules
_Current development guidelines in effect._

- Git: commits go to `main`, authored/committed as Rohit Shidid <rohitshidid@gmail.com>,
  with no AI attribution in messages, authors, or trailers. (See `selfcorrection.md`.)

## Current Tasks
_The macro-level task currently being worked on._

- Build and iterate on the natural-language hotel finder (paragraph in → parsed
  constraints + matching hotel links out).

## Micro-tasks
_A granular checklist of the immediate next steps needed to complete the current task._

- [x] Choose stack (Node/Express + vanilla frontend + Gemini Google Search)
- [x] Backend `POST /api/search` endpoint calling Gemini with the googleSearch tool
- [x] Frontend: request textbox + parsed-constraints section + hotel-results section
- [x] README run instructions, `.env.example`, `.gitignore`
- [x] Switch LLM provider from Anthropic Claude to Google Gemini (per user request)
- [ ] End-to-end test with a real `GEMINI_API_KEY`
- [ ] Handle edge cases (no location given, no results, search rate limits)
- [ ] Optional: persist a Preference Profile so constraints don't need re-typing

## Upcoming Goals
_The roadmap of future features or refactoring._

- Persist Preference Profiles per artist (the product's moat).
- Extend beyond hotels to restaurants, transport, and full tour itineraries.
- Add a post-experience feedback loop that refines the profile.
- Vendor/partner network with reliability ratings.
