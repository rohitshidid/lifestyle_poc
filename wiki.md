# Project Wiki — The Encyclopedia

> Maintained by the IHMS (Intelligent Health Monitoring System).
> The definitive map of the codebase: architectural overviews, a file index, and
> line-number anchors linking documentation to the exact code it describes.

_Last updated: 2026-08-07_

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
  │                       ← writable from ANY chat; applies everywhere
  ├── party[]             (companions with their own dietary/allergies/preferences)
  ├── brands{}            (preferred hotel chains / airlines / rail / car + blacklist)
  ├── loyalty[]           (programmes: category, tier, member no., user-typed balance)
  ├── agency{}            (travel-agency terms — free to use, flat fee per booking)
  ├── enrichment{}        (public-source suggestions; pending until accepted)
  ├── tools{} × 12        (per-service preferences + learned notes — see tools.js)
  └── tours[]
        ├── threads{} keyed by tool
        │     ├── messages[]    (conversation for this tour + this service)
        │     ├── decisions[]   (locked in for this tour)
        │     └── considered[]  (options + stored summary, chosen/rejected)
        └── itinerary          (master plan composed from every thread)
```

Each `(tour, tool)` pair is an independent conversation. Hotel preferences never
leak into transport, and one tour's decisions never leak into another's — with two
deliberate exceptions:

1. **Personal facts are global.** Diet, allergies, and hard bodily constraints
   mentioned in any service area are written to the profile rather than the tool.
2. **The Tour Planner (`itinerary`, listed first) reads everything.** It is a
   master tool: `getTourSummary()` collects every specialist thread's decisions and
   chosen options, and the planner composes them into one day-by-day itinerary.

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

Invariants worth knowing before editing this code — all instances of the same rule,
that a claim without evidence behind it does not reach the user:
- **Allergy severity only escalates.** A merge can raise `mild → severe` but never
  the reverse (`store.js` → `mergeAllergies`).
- **The model's allergy verdict is not trusted.** `enforceAllergySafety` in
  `server.js` is the real boundary: a missing, malformed, or evidence-free "safe"
  verdict is rewritten to `unverified` before it reaches the user.
- **Allergies span the travelling party**, not just the artist — `partyAllergies()`
  unions every travelling member through the same escalate-only merge, and
  `allergyOwners()` names who each one belongs to.
- **Loyalty claims are scrubbed.** `enforceLoyalty()` allows only a programme the
  person holds, in a category that can earn on that service area, and strips any
  points figure — there is no live balance, so no accrual can be computed.
- **Fees come from the profile, never the model**, and are only charged against a
  booking a human confirmed, with the channel they picked (`confirmSegment`).
- **Public-domain research never writes.** `saveEnrichmentSuggestions()` stores
  pending suggestions; only `resolveEnrichmentSuggestion(..., accept=true)` merges
  one, and accepted values are tagged with their source.

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
| `server.js` | `/server.js` | Express server; profile/party/loyalty/agency/enrichment/tour/thread routes + `POST /api/chat` (context build, Gemini call, allergy + loyalty enforcement, booking channels, thread persistence, learning merge). |
| `store.js` | `/store.js` | Persistence: JSON file at `data/profiles.json`, serialized writes, party/brands/loyalty/agency/enrichment, per-tool preferences, tours, threads, escalation-only allergy merge, per-booking fee accounting, additive learning. |
| `tools.js` | `/tools.js` | Catalog of the 12 service areas — `allergyRelevant`, `loyaltyCategory`, `agencyBookable`, blurb, placeholder, preference hint — plus `BOOKING_CHANNELS`, `DEFAULT_AGENCY`, `PARTY_ROLES`, `LOYALTY_CATEGORIES`. |
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
- `TOOLS` — 12 service areas. `itinerary` is first and carries `master: true`;
  `allergyRelevant` decides whether the strict allergy verdict applies.
- `specialistTools()` — everything except the master planner, i.e. what it reads.
- `loyaltyCategory` — which rewards category can earn on an area (`hotel`, `air`,
  `car`, `dining`, `other`, or `null`); `enforceLoyalty` matches against it.
- `agencyBookable` — whether the travel agency can place that kind of booking.
- `DEFAULT_AGENCY` — free to engage, flat `feePerBooking` (50 USD), overridable
  per person because a different artist may be on different terms.

**`server.js`**
- `SYSTEM_PROMPT` — memory rules, allergy safety rules, and the "personal facts are
  always global" learning rule; the specialist JSON output shape.
- `PLANNER_SYSTEM_PROMPT` — the master planner's contract: chronological segments
  with time/type/provider/URL/carrying/status, a `logistics` block for items moving
  between cities, and a `gaps` list.
- `buildPlannerContext()` — assembles the cross-thread view (every specialist
  area's decisions, chosen options, shortlist) plus the currently saved itinerary,
  so the planner revises rather than restarts.
- `buildContext()` — **the memory assembly** for specialist areas. Renders profile
  globals, that tool's preferences, the tour's locked-in decisions,
  already-considered options with status, and the last 12 conversation turns.
- `buildPartyAndProgrammeBlock()` — renders the travelling party and their
  constraints, preferred/blacklisted suppliers, the programmes citable in this
  area, and the agency's terms into both context builders.
- `enforceLoyalty()` — **the rewards boundary.** Drops any programme not held in a
  matching category, coerces `earns` to yes/no/unknown, and strips invented points
  figures. `matchedHeld` is why the UI shows a programme at all.
- `attachBookingChannels()` — attaches the free direct link and the agency option
  with its fee from the profile; the model only supplies a recommendation flag.
- `ENRICH_PROMPT` + `POST /api/profiles/:id/enrich` — public-source research;
  suggestions without a resolvable `sourceUrl` are dropped server-side.
- `POST .../agency-brief` — composes the agency instruction from stored facts only
  (party, allergies with owners, loyalty numbers, selected segments, fee) with no
  model call, because it is the document a human acts on.
- `enforceAllergySafety()` — **the safety boundary.** Rewrites any missing,
  invalid, or unevidenced verdict to `unverified`; returns `not_applicable` when
  no allergies are recorded or the tool isn't allergy-relevant.
- `deriveSegmentStatus()` / `applyBookingStatus()` — **the booking-truth boundary.**
  The model may not declare anything booked; its `status` is discarded and replaced
  with `confirmed` (user pressed Mark as booked), `selected` (the segment's provider
  matches an option the user chose in a specialist chat), or `planned` (everything
  else). Keyed by `segmentKey()` so confirmations survive a re-plan. It also
  scrubs each segment's loyalty claim, attaches the agency option, and computes the
  `fees` block (charged so far + projection if open recommendations are taken).
- Routes — `/api/tools`; profile CRUD; `PUT /api/profiles/:id/tools/:toolId`;
  tour create/delete; `GET .../threads/:toolId`; `POST .../threads/:toolId/status`.
- `POST /api/chat` — the main endpoint tying all of the above together.

**`store.js`**
- `normalizeProfile()` — backfills `tools`/`tours`/`party`/`brands`/`loyalty`/
  `agency`/`enrichment` so older files load cleanly.
- `travellingParty()` / `partyAllergies()` / `allergyOwners()` — the party-wide
  constraint view; `travels: false` keeps someone as a contact only.
- `upsertPartyMember` / `upsertLoyalty` / `setAgency` — CRUD for the new sections.
- `loyaltyForCategory()` — programmes that can earn on a given service area.
- `confirmSegment(..., channel)` — snapshots the fee that applied at booking time;
  `summariseFees()` totals only what was actually booked.
- `saveEnrichmentSuggestions()` / `resolveEnrichmentSuggestion()` — research in,
  human decision out; dismissed suggestions are never re-offered.
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
- `renderParty` / `renderBrands` / `renderLoyalty` / `renderAgency` /
  `renderEnrichment` — the new sidebar cards.
- `modal()` — promise-returning dialog; replaced `window.prompt` for confirming a
  booking because the channel is a real choice with a cost attached.
- `renderFeeBar()` / `renderBriefBar()` / `composeAgencyBrief()` — agency spend and
  the bundled booking request.
- `renderLoyaltyLine()` / `renderBookingLine()` — rewards and the two booking
  channels on each option card; `matchedHeld` gates the programme display.
- Active person/tour/tool persist in `localStorage` (`ihms.profile|tour|tool`).
