# Self-Correction — Preference Ledger

> Maintained by the IHMS (Intelligent Health Monitoring System).
> The system's memory for user feedback. Read this BEFORE touching any code so past
> mistakes are not repeated. New corrections and preferences are logged here the moment
> they are issued.

_Last updated: 2026-07-23_

## Coding Preferences
_Specific coding preferences and stylistic choices issued by the user._

- During brainstorming/discovery, do NOT write code — respond with suggestions and
  clarifying questions only, until told otherwise.

## Stylistic Choices
_Formatting, naming, and structural conventions the user prefers._

- **List-valued fields use chip/pill editors**, never comma-separated single-line
  inputs — those overflow and read badly once there are more than two values.
- Keep the layout roomy: sticky sidebar, collapsible (`<details>`) sections for
  secondary information, and horizontal tabs for the service areas.
- Frontend assets stay split: `public/index.html` (markup), `public/styles.css`,
  `public/app.js`.

## Provider Preferences
_Which third-party services to use._

- LLM provider: **Google Gemini** (`@google/genai`, `gemini-2.5-flash`), not Anthropic.
  Switched on 2026-07-24 per user request.

## Git & Attribution Preferences
_How commits must be made._

- Commit to the `main` branch.
- Author & committer: Rohit Shidid <rohitshidid@gmail.com> ("committed by me").
- No resemblance of Claude / AI in any commit message, author, committer, or trailer.

## Past Corrections
_A cumulative log of corrections issued during development, with dates._

| Date | Correction / Preference | Context |
| ---- | ----------------------- | ------- |
| 2026-07-23 | Commit to `main`, authored as Rohit Shidid <rohitshidid@gmail.com>, no AI attribution anywhere. | Initial commit of IHMS state files. |
| 2026-07-23 | In brainstorming phase: no code — suggestions/questions only. | Musician concierge platform discovery. |
| 2026-07-24 | Build phase active — implement the requested website. | Natural-language hotel finder. |
| 2026-07-24 | Use the Gemini API instead of Anthropic Claude. | LLM provider switch. |
| 2026-07-24 | Gemini-backed app confirmed working with a live key. | End-to-end verification. |
| 2026-07-24 | For roadmap/ideation requests: no code — deliver the list and reasoning only. | AI/ML robustness roadmap. |
| 2026-07-25 | Build roadmap #1 (Preference Profiles + continuous learning) with a right-side create/navigate panel, and roadmap #4 (allergy safety). | Tier 1 hardening. |
| 2026-07-25 | Profile details are per-profile and persistent; profile management belongs in a right-hand sidebar. | UI placement preference. |
| 2026-07-25 | **UI quality matters — do not ship cramped layouts.** Long comma-separated values in single-line inputs overflow and look bad. Use chip/pill editors for list fields, give the layout room, and split CSS/JS out of the HTML. | UI rebuild. |
| 2026-07-25 | Each person needs per-tool detail (10 service areas), not one flat preference set. | Data model. |
| 2026-07-25 | Each tour must remember its own decisions per tool, so mid-conversation route changes carry prior context forward instead of restarting. | Tour memory. |
| 2026-07-25 | Considered options must be clickable to re-read the summary generated for that place. | Sidebar UX. |
| 2026-07-25 | **Personal/dietary facts stated in ANY chat must propagate to the person globally**, so they apply across every other chat. | Cross-cutting preferences. |
| 2026-07-25 | Add a master "Tour Planner" as the FIRST tool — combines all other chats into one full itinerary with day-by-day flow, times, what is carried between places, and direct booking links. | Master itinerary. |
