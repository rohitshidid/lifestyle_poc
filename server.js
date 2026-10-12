import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import {
  TOOLS,
  TOOL_IDS,
  MASTER_TOOL_ID,
  SEGMENT_STATUS,
  BOOKING_CHANNELS,
  PARTY_ROLES,
  LOYALTY_CATEGORIES,
  getTool,
} from "./tools.js";
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  setToolPreferences,
  createTour,
  deleteTour,
  getThread,
  appendThreadTurn,
  setOptionStatus,
  mergeLearnings,
  getTourSummary,
  saveItinerary,
  confirmSegment,
  segmentKey,
  normalizeSeverity,
  upsertPartyMember,
  deletePartyMember,
  upsertLoyalty,
  deleteLoyalty,
  setAgency,
  saveEnrichmentSuggestions,
  resolveEnrichmentSuggestion,
  travellingParty,
  partyAllergies,
  allergyOwners,
  loyaltyForCategory,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.send("ok"));

// Shared-password gate for the public test deployment (off when unset).
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || "").split(" ");
    if (scheme === "Basic" && encoded) {
      const pass = Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":");
      if (pass === process.env.APP_PASSWORD) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Lifestyle POC"');
    res.status(401).send("Password required");
  });
}

// Per-IP cap on writes/model calls so a shared link can't burn the Gemini quota.
const hits = new Map();
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return res.status(429).json({ error: "Too many requests, slow down." });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Intelligent Health Monitoring System's concierge for touring musicians.

You are working on ONE service area for ONE artist on ONE tour. You are given:
- the artist's global profile (dietary, allergies, standing preferences)
- THE TRAVELLING PARTY — everyone on the road with them and their own constraints
- the artist's preferred and blacklisted suppliers (hotel chains, airlines, car hire)
- the rewards / VIP programmes they hold that can earn on this service area
- the travel agency's terms for placing a booking on their behalf
- their preferences for THIS service area specifically
- the conversation so far on this tour for this service area
- the decisions already locked in for this tour
- the options already considered, and their status

## Memory rules (critical)
- The conversation is CONTINUOUS. Treat earlier turns as binding context.
- Never re-propose an option already marked "rejected" unless the user's new message explicitly reverses that.
- Respect locked-in decisions. If the user's new message contradicts one (a changed route, new dates, a dropped city), acknowledge the change, say which prior decision it supersedes, and return that superseded decision in "supersededDecisions".
- When the route or plan changes, carry forward everything still valid. Do not restart from scratch.

## The party books together
- Every constraint listed under THE TRAVELLING PARTY applies to this booking, not just the artist's. They share tables, vans, and green rooms.
- **The strictest constraint in the party wins.** If the tour manager is coeliac and the artist is not, the restaurant still has to handle coeliac.
- When a constraint comes from a companion rather than the artist, say whose it is in the notes ("gluten-free kitchen — for Dana, tour manager").
- Respect headcount: if the party has 6 travelling people, do not propose a 4-seat car or a table for 4.

## Suppliers and rewards
- Prefer the artist's listed hotel chains / airlines / car hire when a listed brand genuinely fits the requirement. State the brand match in "matches".
- **Never propose anything on the avoid list.** If nothing on the preferred list works, say so plainly and propose the best alternative — do not silently pretend the preference does not exist.
- For each option, fill "loyalty":
  - "program" — ONLY a programme from the list you were given. Never invent one, and never cite a programme in a category that cannot earn here.
  - "earns" — whether the booking can earn or use that programme: "yes" | "no" | "unknown". Use "unknown" unless you found it; do not guess.
  - "tierBenefit" — a perk their stated tier actually gets at this property/carrier, if you found evidence of one. Empty otherwise.
  - "note" — what you found, and where.
- **Never state a points figure as fact.** You do not have their live balance and cannot compute an accrual. Describe earning qualitatively ("earns Honors points; base rate not published") and leave numbers out unless the property publishes them.
- If the artist holds no programme relevant to this area, return "program": "" and "earns": "no".

## Booking channel
- Everything you propose is booked by a human, one of two ways: DIRECT via the link you supply, or THROUGH THE TRAVEL AGENCY, which is free to engage and charges a flat fee per booking it places.
- Always supply a real direct link where one exists — it is the free path.
- Recommend the agency route in "agencyRecommended" (true/false) with a one-line "agencyReason" when it genuinely earns its fee: complex multi-leg or group bookings, freight with customs paperwork, anything needing a human to hold a reservation, or where a mistake is expensive.
- Do not recommend the agency for a booking anyone can do in two clicks — say so if asked.

## Allergy safety rules (highest priority — these override everything else)
- Allergies are safety-critical, NOT preferences. Never trade an allergy away for a preference, and never call a place suitable because it is a close-enough match.
- Allergies belong to the WHOLE travelling party. A companion's severe allergy is exactly as binding as the artist's.
- For each option give an explicit "allergySafety" verdict:
  - "verified"   — you found a published allergen policy or equivalent concrete evidence. Say what you found in the note.
  - "unverified" — no allergen information found. This is the correct answer when you lack evidence. Do not guess.
  - "risk"       — something actively conflicts with the allergy.
  - "not_applicable" — the artist has no recorded allergies, or this service area cannot involve allergens.
- Never state or imply an option is safe without evidence. "unverified" always beats an optimistic guess.

## Learning — personal facts are GLOBAL no matter which area you are in
Report durable, reusable facts in "profileUpdates":
- "global" — true of the PERSON, everywhere, on every future tour.
- "tool"   — true for this service area only ("prefers boutique hotels", "hates sprinter vans").

**Anything about the person's body, diet, or safety is ALWAYS global, whatever area you are working in.** If they mention a dietary requirement, an allergy, a medical need, or a hard personal constraint while you are booking a van or a courier, it still goes in "global" — never in "tool", and never dropped because it seemed off-topic. Examples that are always global:
- "I've gone dairy-free" (mentioned in the transport chat) → global.dietary
- "I'm allergic to latex" (mentioned in the venue chat) → global.allergies
- "I can't do stairs right now" (mentioned anywhere) → global.otherPreferences

Do NOT report trip-specific details (this city, these dates, this venue) — those belong in decisions, not the profile.

Two more durable kinds:
- Standing supplier loyalty ("we always stay Hilton", "never Ryanair") → "global.brands" under hotelChains / airlines / railOperators / carHire / avoid.
- A durable constraint about a NAMED companion already in the party ("Dana can't do dairy") → "party", matched by their exact name. Never invent a party member; if the person is not already listed, put it in global notes instead and say who it is about.

## Output
Reply conversationally first, then end with EXACTLY ONE fenced JSON code block (\`\`\`json ... \`\`\`) and nothing after it:

{
  "reply": "your conversational answer to the user, 1-4 sentences",
  "parsed": { "location": "string or null", "constraints": ["..."] },
  "options": [
    {
      "name": "Name",
      "url": "https://... (a real link you found, or empty if not applicable)",
      "location": "neighbourhood / city",
      "priceTier": "budget | mid | luxury | unknown",
      "matches": ["short phrase per constraint it satisfies"],
      "allergySafety": { "status": "verified | unverified | risk | not_applicable", "note": "evidence found or not found" },
      "loyalty": { "program": "exact name from the list, or empty", "earns": "yes | no | unknown", "tierBenefit": "", "note": "" },
      "agencyRecommended": false,
      "agencyReason": "one line, only if agencyRecommended is true",
      "serves": ["names of party members this option specifically accommodates, if relevant"],
      "notes": "one or two sentences on why this fits"
    }
  ],
  "decisions": ["a decision locked in during THIS turn, if any"],
  "supersededDecisions": ["a previously locked decision this turn invalidates, if any"],
  "profileUpdates": {
    "global": {
      "dietary": [], "allergies": [{"name":"...","severity":"..."}], "otherPreferences": [], "notes": [],
      "brands": { "hotelChains": [], "airlines": [], "railOperators": [], "carHire": [], "avoid": [] }
    },
    "tool":   { "preferences": [], "notes": [] },
    "party":  [{ "name": "exact name of an EXISTING party member", "dietary": [], "allergies": [], "preferences": [], "notes": [] }]
  }
}

Rules:
- Only include options you actually found via search, with real URLs. Do not invent links.
- Return 3-6 options when you are searching. If the user is just talking (confirming, changing plans, asking a question), return an empty "options" array and answer in "reply".
- Keep every string concise. Output valid JSON only inside the block.`;

const PLANNER_SYSTEM_PROMPT = `You are the Intelligent Health Monitoring System's MASTER TOUR PLANNER for a touring musician.

Unlike the specialist areas, you do not book one thing — you compose THE WHOLE TRIP into a single day-by-day plan. You are given the artist's profile, everything already decided in every specialist area (hotels, dining, courier, transport, flights, venue, etc.), and the conversation so far.

## What you produce
A chronological plan covering the dates the user gives you. For each day, list the segments in time order. A segment is anything that happens at a time: a flight, a pickup, a check-in, load-in, soundcheck, a meal, a courier collection, a show, a departure.

For every segment give:
- "time"     — clock time (or a window like "14:00–15:30"). If genuinely unknown, use "TBC" — never invent a precise time.
- "type"     — one of: flights, transport, hotel, dining, catering, courier, venue, wellness, medical, grocery, downtime, other
- "title"    — what happens
- "location" — where
- "provider" — the company/venue/hotel, if known
- "url"      — a REAL booking or info link so the user can book directly. Empty string if you have none. NEVER invent a URL.
- "carrying" — what physically moves with this segment (gear cases, merch, instruments), if anything
- "party"    — how many people this segment is for, and any named companion it is specifically arranged around
- "loyalty"  — the rewards programme this segment could earn on, ONLY if the artist holds one in that category. Name it exactly as given. Never quote a points figure — you do not have their balance.
- "agencyRecommended" — true only where the travel agency's flat per-booking fee genuinely buys something: multi-leg or group bookings, freight and customs, held reservations, anything expensive to get wrong. Add a short "agencyReason".
- "notes"    — anything the user needs to know (buffer, contact, what to reconfirm)

## The whole party travels
You are given every travelling companion and their constraints. Headcounts, vehicle sizes, room counts, and table sizes must fit the party. Every food segment must clear the STRICTEST dietary and allergy constraint in the party, whoever it belongs to — name whose it is in the notes.

## The travel agency
The agency is free to engage and charges a flat fee per booking it places. Bookings placed direct cost nothing extra. Because the fee is per BOOKING, bundling several segments into one agency instruction is cheaper than sending each separately — say so in "reply" when it applies. Do not mark everything for the agency by default; the direct link is the free path and is usually right.

**Do NOT output a "status" field, and never describe anything as booked, confirmed, reserved, or arranged.** You cannot make reservations and neither can this system. Every segment you produce is a *proposal* until the user books it themselves. The application tracks booking state separately and will overwrite anything you claim.

## Carrying things between places
Track every item that moves between cities in "logistics": what it is, from where, to where, by what method/carrier, when it is collected, when it must arrive, and a booking link. If gear is being shipped rather than travelling with the party, make that explicit and make sure it arrives BEFORE the load-in that needs it. Flag it in "gaps" if the timing does not work.

## Use what is already decided
Where a specialist area has already CHOSEN an option, reuse that exact venue/hotel/carrier name and link — do not re-propose alternatives for it. Note that "chosen" means the user picked it as their preferred option, NOT that it is booked. List anything still missing in "gaps".

## Allergy safety
Any segment involving food (dining, catering, grocery, hotel breakfast) must respect the artist's allergies. Where you cannot verify allergen handling, say so in that segment's "notes" — never imply it is safe without evidence.

## Learning
Same rule as everywhere: personal facts (diet, allergies, body, hard constraints) go to "profileUpdates.global" no matter what you are planning. Planning habits ("always land a day early") go to "profileUpdates.tool".

## Output
Reply conversationally first, then end with EXACTLY ONE fenced JSON code block (\`\`\`json ... \`\`\`) and nothing after it:

{
  "reply": "1-4 sentences summarising the plan or what changed",
  "itinerary": {
    "title": "Berlin + Munich, 14-19 May",
    "days": [
      {
        "day": "Day 1 — Thu 14 May",
        "city": "Berlin",
        "segments": [
          {
            "time": "14:30", "type": "transport", "title": "Airport pickup",
            "location": "BER Terminal 1", "provider": "…", "url": "https://…",
            "carrying": "4 flight cases + 2 guitars", "party": "5 people",
            "loyalty": { "program": "", "earns": "unknown", "note": "" },
            "agencyRecommended": false, "agencyReason": "", "notes": "…"
          }
        ]
      }
    ],
    "logistics": [
      {
        "item": "4 flight cases", "from": "Columbiahalle, Berlin", "to": "Backstage, Munich",
        "method": "road freight", "provider": "…", "url": "https://…",
        "collect": "16 May 10:00", "arrive": "17 May by 18:00", "notes": "…"
      }
    ],
    "gaps": ["what still needs deciding or booking"]
  },
  "options": [],
  "decisions": ["anything locked in during THIS turn"],
  "supersededDecisions": ["any prior decision this turn invalidates"],
  "profileUpdates": {
    "global": {
      "dietary": [], "allergies": [{"name":"...","severity":"..."}], "otherPreferences": [], "notes": [],
      "brands": { "hotelChains": [], "airlines": [], "railOperators": [], "carHire": [], "avoid": [] }
    },
    "tool":   { "preferences": [], "notes": [] },
    "party":  [{ "name": "exact name of an EXISTING party member", "dietary": [], "allergies": [], "preferences": [], "notes": [] }]
  }
}

Rules:
- Always return the FULL itinerary, not a diff — the UI replaces the stored plan with what you return.
- Only real URLs found via search. An empty string is always better than a fabricated link.
- If the user has not given dates or cities yet, return an empty "days" array and ask for what you need in "reply".
- Output valid JSON only inside the block.`;

/**
 * The inputs the concierge was previously blind to: who else is on the road,
 * which suppliers the artist actually uses, which programmes a booking can earn
 * on, and how the agency is engaged.
 *
 * `loyaltyCategory` is null on the master planner, which is why it gets the
 * whole programme list — it plans across every category at once.
 */
function buildPartyAndProgrammeBlock(profile, { loyaltyCategory, allProgrammes = false }) {
  const lines = [];
  const party = travellingParty(profile);
  const companions = party.filter((m) => !m.isArtist);

  lines.push("", `TRAVELLING PARTY — ${party.length} people, all constraints below apply:`);
  for (const m of party) {
    const bits = [];
    if ((m.dietary || []).length) bits.push(`dietary: ${m.dietary.join(", ")}`);
    if ((m.allergies || []).length) {
      bits.push(`ALLERGIES: ${m.allergies.map((a) => `${a.name} (${a.severity})`).join(", ")}`);
    }
    if ((m.preferences || []).length) bits.push(`prefers: ${m.preferences.join(", ")}`);
    if ((m.notes || []).length) bits.push(`notes: ${m.notes.join("; ")}`);
    lines.push(
      `  · ${m.name} (${m.role})${m.booksOnBehalf ? " — books on the artist's behalf" : ""}${
        bits.length ? ` — ${bits.join(" | ")}` : " — no constraints recorded"
      }`,
    );
  }
  const offRoad = (profile.party || []).filter((m) => !m.travels);
  if (offRoad.length) {
    lines.push(
      `  (not travelling, contacts only: ${offRoad
        .map((m) => `${m.name} — ${m.role}`)
        .join("; ")})`,
    );
  }
  if (!companions.length) {
    lines.push("  (no companions recorded — assume the artist travels alone unless told otherwise)");
  }

  const b = profile.brands || {};
  const brandLine = (label, list) => (list?.length ? `  ${label}: ${list.join(", ")}` : null);
  const brandLines = [
    brandLine("Hotel chains", b.hotelChains),
    brandLine("Airlines", b.airlines),
    brandLine("Rail", b.railOperators),
    brandLine("Car hire", b.carHire),
    b.avoid?.length ? `  NEVER PROPOSE (blacklist): ${b.avoid.join(", ")}` : null,
  ].filter(Boolean);
  lines.push("", "PREFERRED SUPPLIERS:");
  lines.push(brandLines.length ? brandLines.join("\n") : "  none recorded");

  const programmes = allProgrammes
    ? profile.loyalty || []
    : loyaltyForCategory(profile, loyaltyCategory);
  lines.push("", "REWARDS / VIP PROGRAMMES YOU MAY CITE (no others exist — do not invent any):");
  if (!programmes.length) {
    lines.push(
      loyaltyCategory || allProgrammes
        ? "  none held that can earn here — return an empty program and \"earns\": \"no\""
        : "  none — this service area does not earn on any programme",
    );
  } else {
    for (const l of programmes) {
      lines.push(
        `  · ${l.program} [${l.category}]${l.tier ? ` — tier: ${l.tier}` : ""}${
          l.points !== null ? ` — balance on file: ${l.points.toLocaleString()} pts` : ""
        }${l.perks?.length ? ` — known perks: ${l.perks.join(", ")}` : ""}`,
      );
    }
    lines.push(
      "  The balance above is what the user typed in, not a live figure. Never do arithmetic on it and never predict an award total.",
    );
  }

  const ag = profile.agency || {};
  lines.push("", "TRAVEL AGENCY:");
  lines.push(
    ag.enabled
      ? `  ${ag.name} — free to engage, ${ag.currency} ${ag.feePerBooking} flat fee per booking it places. Direct booking costs nothing extra.`
      : "  not engaged on this account — every booking is direct.",
  );

  return lines;
}

function buildPlannerContext({ profile, tour, thread, summary }) {
  const allergies = (profile.allergies || [])
    .map((a) => `${a.name} (${a.severity})`)
    .join(", ");

  const lines = [
    "ROLE: Master tour planner — compose the whole trip.",
    "",
    `ARTIST: ${profile.name}`,
    `Dietary: ${(profile.dietary || []).join(", ") || "none recorded"}`,
    `Allergies: ${allergies || "none recorded"}`,
    `Standing preferences: ${(profile.otherPreferences || []).join(", ") || "none recorded"}`,
    `Learned notes: ${(profile.notes || []).join("; ") || "none recorded"}`,
    `Planning preferences: ${
      (profile.tools[MASTER_TOOL_ID]?.preferences || []).join(", ") || "none recorded"
    }`,
    ...buildPartyAndProgrammeBlock(profile, { loyaltyCategory: null, allProgrammes: true }),
    "",
    `TOUR: ${tour.name}`,
  ];

  if (summary?.fees) {
    const f = summary.fees;
    lines.push(
      `AGENCY SPEND SO FAR ON THIS TOUR: ${f.agencyBookings} booking(s) placed through the agency = ${f.currency} ${f.charged}. ${f.directBookings} booked direct at no fee.`,
    );
  }

  // The cross-thread pull: this is what makes the planner a combination of the
  // other chats rather than a separate conversation.
  if (summary?.areas?.length) {
    lines.push("ALREADY DECIDED IN THE SPECIALIST AREAS:");
    for (const a of summary.areas) {
      lines.push(`  ${a.label}:`);
      for (const d of a.decisions) lines.push(`    · decision: ${d}`);
      for (const c of a.chosen) {
        lines.push(
          `    · CHOSEN: ${c.name}${c.location ? ` (${c.location})` : ""}${c.url ? ` — ${c.url}` : ""}`,
        );
      }
      for (const s of a.shortlist) {
        lines.push(`    · shortlisted: ${s.name}${s.url ? ` — ${s.url}` : ""}`);
      }
    }
  } else {
    lines.push(
      "ALREADY DECIDED IN THE SPECIALIST AREAS: nothing yet — you are planning from scratch.",
    );
  }

  if (tour.itinerary?.days?.length) {
    lines.push("", "CURRENT SAVED ITINERARY (revise this rather than starting over):");
    for (const d of tour.itinerary.days) {
      lines.push(`  ${d.day}${d.city ? ` — ${d.city}` : ""}`);
      for (const s of d.segments || []) {
        lines.push(`    ${s.time || "TBC"} [${s.type}] ${s.title}${s.provider ? ` — ${s.provider}` : ""}`);
      }
    }
    for (const l of tour.itinerary.logistics || []) {
      lines.push(`  CARRYING: ${l.item} ${l.from} → ${l.to} (${l.method || "TBC"})`);
    }
  }

  const decisions = thread.decisions || [];
  if (decisions.length) {
    lines.push(
      "",
      `PLANNER DECISIONS SO FAR:\n${decisions.map((d, i) => `  ${i + 1}. ${d.text}`).join("\n")}`,
    );
  }

  const recent = (thread.messages || []).slice(-12);
  lines.push(
    "",
    recent.length
      ? `CONVERSATION SO FAR:\n${recent
          .map((m) => `  ${m.role === "user" ? "USER" : "PLANNER"}: ${m.text}`)
          .join("\n")}`
      : "CONVERSATION SO FAR: this is the first message.",
  );

  lines.push("", "---", "NEW MESSAGE FROM USER:");
  return lines.join("\n");
}

function buildContext({ profile, tool, tour, thread }) {
  const allergies = (profile.allergies || [])
    .map((a) => `${a.name} (${a.severity})`)
    .join(", ");

  const lines = [
    `SERVICE AREA: ${tool.label} — ${tool.blurb}`,
    `ALLERGY-RELEVANT AREA: ${tool.allergyRelevant ? "yes" : "no"}`,
    `AGENCY CAN PLACE THIS BOOKING: ${tool.agencyBookable ? "yes" : "no"}`,
    "",
    `ARTIST: ${profile.name}`,
    `Dietary: ${(profile.dietary || []).join(", ") || "none recorded"}`,
    `Allergies: ${allergies || "none recorded"}`,
    `Standing preferences: ${(profile.otherPreferences || []).join(", ") || "none recorded"}`,
    `Learned notes: ${(profile.notes || []).join("; ") || "none recorded"}`,
    "",
    `${tool.label} preferences: ${
      (profile.tools[tool.id]?.preferences || []).join(", ") || "none recorded"
    }`,
    `${tool.label} learned notes: ${
      (profile.tools[tool.id]?.notes || []).join("; ") || "none recorded"
    }`,
    ...buildPartyAndProgrammeBlock(profile, { loyaltyCategory: tool.loyaltyCategory }),
    "",
    `TOUR: ${tour.name}`,
  ];

  const decisions = thread.decisions || [];
  lines.push(
    decisions.length
      ? `DECISIONS ALREADY LOCKED IN FOR THIS TOUR:\n${decisions
          .map((d, i) => `  ${i + 1}. ${d.text}`)
          .join("\n")}`
      : "DECISIONS ALREADY LOCKED IN FOR THIS TOUR: none yet",
  );

  const considered = thread.considered || [];
  lines.push(
    considered.length
      ? `OPTIONS ALREADY CONSIDERED (do not re-propose rejected ones):\n${considered
          .map((c) => `  - ${c.name} [${c.status}]${c.reason ? ` — ${c.reason}` : ""}`)
          .join("\n")}`
      : "OPTIONS ALREADY CONSIDERED: none yet",
  );

  const recent = (thread.messages || []).slice(-12);
  lines.push(
    recent.length
      ? `CONVERSATION SO FAR:\n${recent
          .map((m) => `  ${m.role === "user" ? "USER" : "CONCIERGE"}: ${m.text}`)
          .join("\n")}`
      : "CONVERSATION SO FAR: this is the first message.",
  );

  lines.push("", "---", "NEW MESSAGE FROM USER:");
  return lines.join("\n");
}

function extractJson(text) {
  // Prefer a ```json fence, but accept a bare ``` fence too — the tag is not
  // always emitted. Fall back to scanning for a balanced object, because the
  // naive first-"{" to last-"}" slice swallows any brace that happens to appear
  // in the prose around the block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const scanned = firstBalancedObject(text);
  if (scanned) candidates.push(scanned);

  let lastErr;
  for (const raw of candidates) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new SyntaxError("No JSON object found in the response.");
}

/** Scan for the first brace-balanced object, ignoring braces inside strings. */
function firstBalancedObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Why a response came back with no usable text. Gemini returns an empty
 * candidate rather than an error when it blocks or truncates, so an empty
 * string here is a blocked/truncated call, not malformed JSON — and saying
 * "could not parse" for it sends you looking in entirely the wrong place.
 */
function emptyResponseReason(finishReason) {
  switch (finishReason) {
    case "RECITATION":
      return "The model blocked its own answer for reciting source material too closely. This is intermittent — try again.";
    case "MAX_TOKENS":
      return "The model ran out of output budget before finishing. Try again, or narrow the request.";
    case "SAFETY":
      return "The model's safety filter blocked the answer.";
    case "PROHIBITED_CONTENT":
      return "The model refused to answer this request.";
    default:
      return finishReason
        ? `The model returned no text (finish reason: ${finishReason}).`
        : "The model returned no text.";
  }
}

// ---------------------------------------------------------------------------
// Allergy safety enforcement
//
// The prompt asks for a verdict, but a prompt is not a guarantee. This pass is
// the actual safety boundary: if allergies are in play on an allergy-relevant
// service area, no option may reach the user without an explicit verdict, and
// anything the model left blank, unknown, or optimistic-without-evidence is
// forced to "unverified".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Itinerary booking status
//
// The model is not permitted to declare anything booked, for the same reason it
// is not permitted to declare a hotel allergy-safe: it has no way to know, and
// the failure mode is someone turning up somewhere with no reservation. Status
// is derived here from state a human actually created:
//
//   confirmed — the user pressed "Mark as booked" (optionally with a reference)
//   selected  — the user chose this option in a specialist chat
//   planned   — everything else: a proposal and nothing more
//
// Whatever the model put in `status` is discarded.
// ---------------------------------------------------------------------------

function deriveSegmentStatus(day, segment, { confirmations, chosenNames }) {
  const key = segmentKey(day, segment);
  const confirmation = confirmations?.[key];
  if (confirmation) {
    return {
      key,
      status: SEGMENT_STATUS.CONFIRMED,
      confirmedAt: confirmation.at,
      reference: confirmation.reference || "",
      bookedVia: confirmation.channel || BOOKING_CHANNELS.DIRECT,
      feeCharged: Number(confirmation.fee) || 0,
    };
  }

  const haystack = `${segment.provider || ""} ${segment.title || ""}`.toLowerCase();
  const matched = (chosenNames || []).some((n) => n && haystack.includes(n.toLowerCase()));
  return { key, status: matched ? SEGMENT_STATUS.SELECTED : SEGMENT_STATUS.PLANNED };
}

/**
 * Attach derived truth to every segment: booking status, how it was booked and
 * what that cost, and a loyalty claim scrubbed against the programmes actually
 * held. The model's own `status`, fee, and programme claims are discarded.
 */
function applyBookingStatus(itinerary, ctx) {
  if (!itinerary) return itinerary;
  const profile = ctx.profile;
  const agency = profile?.agency || {};
  const agencyOn = !!agency.enabled;

  const days = (itinerary.days || []).map((d) => ({
    ...d,
    segments: (d.segments || []).map((s) => {
      const derived = deriveSegmentStatus(d.day, s, ctx);
      const tool = getTool(s.type) || {};
      // A segment's `type` doubles as a service area, so the same
      // category rules that govern the specialist chats apply here.
      const [scrubbed] = profile
        ? enforceLoyalty([s], profile, tool.loyaltyCategory ?? null)
        : [s];

      const bookableViaAgency = agencyOn && tool.agencyBookable !== false;
      return {
        ...s,
        loyalty: scrubbed.loyalty,
        status: derived.status,
        segmentKey: derived.key,
        confirmedAt: derived.confirmedAt,
        reference: derived.reference,
        bookedVia: derived.bookedVia,
        feeCharged: derived.feeCharged || 0,
        agency: {
          available: bookableViaAgency,
          fee: bookableViaAgency ? agency.feePerBooking : 0,
          currency: agency.currency,
          recommended: bookableViaAgency && s.agencyRecommended === true,
          reason: bookableViaAgency && s.agencyRecommended === true ? String(s.agencyReason || "") : "",
        },
      };
    }),
  }));

  // Fee projection: what has been charged, plus what the segments still
  // unbooked would cost if they all went through the agency. Both numbers are
  // derived from real segments, never from anything the model asserted.
  const all = days.flatMap((d) => d.segments);
  const charged = all.reduce((sum, s) => sum + (s.feeCharged || 0), 0);
  const openAgencyRecs = all.filter(
    (s) => s.status !== SEGMENT_STATUS.CONFIRMED && s.agency.recommended,
  );

  return {
    ...itinerary,
    days,
    fees: {
      currency: agency.currency,
      feePerBooking: agency.feePerBooking,
      agencyName: agency.name,
      agencyEnabled: agencyOn,
      charged,
      agencyBookings: all.filter((s) => s.bookedVia === BOOKING_CHANNELS.AGENCY).length,
      directBookings: all.filter((s) => s.bookedVia === BOOKING_CHANNELS.DIRECT).length,
      recommendedOpen: openAgencyRecs.length,
      projectedIfAgencyRecsTaken: charged + openAgencyRecs.length * (agency.feePerBooking || 0),
    },
  };
}

const VALID_STATUS = new Set(["verified", "unverified", "risk", "not_applicable"]);

function enforceAllergySafety(options, activeAllergies, tool) {
  const inScope = activeAllergies.length > 0 && tool.allergyRelevant;

  return (options || []).map((o) => {
    if (!inScope) {
      return {
        ...o,
        allergySafety: {
          status: "not_applicable",
          note: activeAllergies.length
            ? `${tool.label} does not involve allergens.`
            : "No allergies on record.",
        },
      };
    }

    const given = o.allergySafety || {};
    let status = String(given.status || "").toLowerCase();
    let note = given.note;

    if (!VALID_STATUS.has(status) || status === "not_applicable") {
      status = "unverified";
      note = note || "No allergen information found for this option.";
    }
    if (status === "verified" && !note) {
      // A "safe" verdict with no evidence behind it is exactly what we refuse
      // to pass along.
      status = "unverified";
      note = "Marked safe without supporting evidence — treat as unverified.";
    }
    return { ...o, allergySafety: { status, note: note || "" } };
  });
}

// ---------------------------------------------------------------------------
// Loyalty claim enforcement
//
// Same principle as the allergy verdict: a prompt is not a guarantee. The model
// has no access to anyone's live balance and cannot compute an accrual, so:
//   - it may only name a programme the person actually holds, in a category
//     that can earn on this service area
//   - any points figure it invents is stripped, because a wrong number here
//     looks authoritative and isn't
// Everything else degrades to "unknown", which is the honest answer.
// ---------------------------------------------------------------------------

const EARNS_VALUES = new Set(["yes", "no", "unknown"]);
const POINTS_CLAIM = /\b\d[\d,.]*\s*(?:k\b|points?|pts?|miles?|avios)\b/i;

function enforceLoyalty(options, profile, category) {
  const held = loyaltyForCategory(profile, category);
  const byName = new Map(held.map((l) => [l.program.toLowerCase(), l]));

  return (options || []).map((o) => {
    const given = o.loyalty || {};
    const claimed = String(given.program || "").trim();
    const match = byName.get(claimed.toLowerCase());

    if (!claimed || !match) {
      return {
        ...o,
        loyalty: {
          program: "",
          earns: "no",
          tierBenefit: "",
          note: held.length
            ? claimed
              ? `Cited "${claimed}", which is not a programme on file for this category — dropped.`
              : ""
            : "",
          matchedHeld: false,
        },
      };
    }

    const earns = EARNS_VALUES.has(String(given.earns || "").toLowerCase())
      ? String(given.earns).toLowerCase()
      : "unknown";
    // Strip any invented accrual figure; keep the qualitative claim.
    const strip = (s) =>
      POINTS_CLAIM.test(String(s || ""))
        ? String(s).replace(POINTS_CLAIM, "an unstated amount")
        : String(s || "");

    return {
      ...o,
      loyalty: {
        program: match.program,
        category: match.category,
        tier: match.tier,
        earns,
        tierBenefit: strip(given.tierBenefit),
        note: strip(given.note),
        matchedHeld: true,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Booking channel
//
// The fee is a fact about the agency's terms, not something the model gets to
// state. It is attached server-side from the profile so a quoted price is
// always the configured one.
// ---------------------------------------------------------------------------

function attachBookingChannels(options, profile, tool) {
  const agency = profile.agency || {};
  const available = !!agency.enabled && tool.agencyBookable !== false;

  return (options || []).map((o) => ({
    ...o,
    booking: {
      direct: { url: o.url || "", fee: 0, available: !!o.url },
      agency: {
        available,
        name: agency.name,
        fee: available ? agency.feePerBooking : 0,
        currency: agency.currency,
        recommended: available && o.agencyRecommended === true,
        reason: available && o.agencyRecommended === true ? String(o.agencyReason || "") : "",
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Routes: catalog + profiles
// ---------------------------------------------------------------------------

app.get("/api/tools", (_req, res) => res.json(TOOLS));

app.get("/api/profiles", async (_req, res) => res.json(await listProfiles()));

app.post("/api/profiles", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Profile name is required." });
  res.status(201).json(await createProfile({ ...req.body, name }));
});

app.get("/api/profiles/:id", async (req, res) => {
  const profile = await getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found." });
  res.json(profile);
});

app.patch("/api/profiles/:id", async (req, res) => {
  const updated = await updateProfile(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

app.delete("/api/profiles/:id", async (req, res) => {
  const ok = await deleteProfile(req.params.id);
  if (!ok) return res.status(404).json({ error: "Profile not found." });
  res.status(204).end();
});

app.put("/api/profiles/:id/tools/:toolId", async (req, res) => {
  if (!TOOL_IDS.includes(req.params.toolId)) {
    return res.status(400).json({ error: "Unknown tool." });
  }
  const updated = await setToolPreferences(
    req.params.id,
    req.params.toolId,
    req.body?.preferences || [],
  );
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Routes: party, loyalty, agency
// ---------------------------------------------------------------------------

app.get("/api/meta", (_req, res) =>
  res.json({ partyRoles: PARTY_ROLES, loyaltyCategories: LOYALTY_CATEGORIES }),
);

app.put("/api/profiles/:id/party", async (req, res) => {
  if (!String(req.body?.name || "").trim()) {
    return res.status(400).json({ error: "A name is required." });
  }
  const updated = await upsertPartyMember(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

app.delete("/api/profiles/:id/party/:memberId", async (req, res) => {
  const updated = await deletePartyMember(req.params.id, req.params.memberId);
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

app.put("/api/profiles/:id/loyalty", async (req, res) => {
  if (!String(req.body?.program || "").trim()) {
    return res.status(400).json({ error: "A programme name is required." });
  }
  const updated = await upsertLoyalty(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

app.delete("/api/profiles/:id/loyalty/:loyaltyId", async (req, res) => {
  const updated = await deleteLoyalty(req.params.id, req.params.loyaltyId);
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

app.put("/api/profiles/:id/agency", async (req, res) => {
  const updated = await setAgency(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Profile not found." });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Routes: public-domain enrichment
//
// Research produces SUGGESTIONS with sources. Nothing reaches the profile until
// a human accepts it — see the enrichment prompt for why.
// ---------------------------------------------------------------------------

const ENRICH_PROMPT = `You are researching a touring musician from PUBLIC SOURCES so their lifestyle team has a starting point for a preference profile.

You will be given the artist's name and what is already on file. Search the public web — interviews, published tour riders, press, official sites, verified social posts — and report what it suggests about how they travel and what they need.

## The one rule that matters
Everything you return is a LEAD FOR A HUMAN TO VERIFY, never a fact. A quote from a 2019 interview is not what someone eats today. So:
- **Every suggestion must carry a real source URL you actually found.** No source, no suggestion.
- Include the supporting quote or line, verbatim and short.
- Set "confidence": "high" only for something stated directly and recently by the artist or their official channels; "medium" for reliable second-hand reporting; "low" for inference.
- **Never report an allergy or a medical condition as a dietary/preference suggestion.** Health claims from the press are frequently wrong and the cost of being wrong is somebody in hospital. If you find one, report it as a "notes" suggestion worded as something to CHECK WITH THE ARTIST — never as a constraint.
- Do not report anything already on file.
- Do not report gossip, relationships, finances, addresses, or anything about their private life that is not a travel or hospitality preference. If a source is a tabloid, skip it.
- If you find little, return few suggestions or none. An empty list is a perfectly good answer.

## Fields you may target
- "dietary" — a publicly stated diet (vegan, vegetarian, sober/no alcohol)
- "otherPreferences" — standing travel/hospitality preferences
- "brands.hotelChains" | "brands.airlines" | "brands.railOperators" | "brands.carHire" — suppliers they are publicly associated with
- "notes" — anything else the team should know or check
- scope "tool" with a "toolId" — a preference specific to one service area (hotel, dining, catering, transport, flights, venue, wellness, grocery, downtime)

## Output
A short conversational summary of what you found and how solid it is, then EXACTLY ONE fenced JSON block:

\`\`\`json
{
  "summary": "1-3 sentences: what you found, and how much of it is well sourced",
  "suggestions": [
    {
      "scope": "global | tool",
      "toolId": "hotel (only when scope is tool, else omit)",
      "field": "dietary | otherPreferences | notes | preferences | brands.hotelChains | brands.airlines | brands.railOperators | brands.carHire",
      "value": "the preference, in the words the team would file it under",
      "confidence": "high | medium | low",
      "source": "publication or site name",
      "sourceUrl": "https://…",
      "quote": "short verbatim line supporting it"
    }
  ]
}
\`\`\``;

app.post("/api/profiles/:id/enrich", async (req, res) => {
  const profile = await getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found." });

  const known = [
    `ARTIST: ${profile.name}`,
    req.body?.hint ? `CONTEXT FROM THE TEAM: ${req.body.hint}` : "",
    "",
    "ALREADY ON FILE (do not repeat any of this):",
    `  dietary: ${(profile.dietary || []).join(", ") || "none"}`,
    `  preferences: ${(profile.otherPreferences || []).join(", ") || "none"}`,
    `  hotel chains: ${(profile.brands?.hotelChains || []).join(", ") || "none"}`,
    `  airlines: ${(profile.brands?.airlines || []).join(", ") || "none"}`,
    `  notes: ${(profile.notes || []).join("; ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    // Grounded research asks for verbatim quotes, which regularly trips
    // Gemini's recitation filter — it returns an empty candidate instead of an
    // answer. That is intermittent, so one retry recovers most of them.
    let response;
    let text = "";
    let finishReason;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: known,
        config: {
          systemInstruction: ENRICH_PROMPT,
          maxOutputTokens: 8000,
          tools: [{ googleSearch: {} }],
        },
      });
      text = response.text || "";
      finishReason = response.candidates?.[0]?.finishReason;
      if (text.trim()) break;
    }

    if (!text.trim()) {
      return res.status(502).json({ error: emptyResponseReason(finishReason) });
    }

    let data;
    try {
      data = extractJson(text);
    } catch {
      return res.status(502).json({ error: "Could not parse the research response.", raw: text });
    }

    // A suggestion with no source is not a lead, it is a guess — drop it here
    // rather than letting the UI offer it for approval.
    const sourced = (data.suggestions || []).filter((s) => /^https?:\/\//i.test(s?.sourceUrl || ""));
    const dropped = (data.suggestions || []).length - sourced.length;

    const updated = await saveEnrichmentSuggestions(req.params.id, {
      suggestions: sourced,
      summary: data.summary || "",
    });

    res.json({
      profile: updated,
      summary: data.summary || "",
      found: sourced.length,
      droppedUnsourced: dropped,
    });
  } catch (err) {
    console.error(err);
    res.status(err?.status || 500).json({ error: err?.message || "Research failed." });
  }
});

/** Accept or dismiss one researched suggestion. Accepting is the only write path. */
app.post("/api/profiles/:id/enrich/:suggestionId", async (req, res) => {
  const updated = await resolveEnrichmentSuggestion(
    req.params.id,
    req.params.suggestionId,
    req.body?.accept === true,
  );
  if (!updated) return res.status(404).json({ error: "Suggestion not found." });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Routes: tours + threads
// ---------------------------------------------------------------------------

app.post("/api/profiles/:id/tours", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Tour name is required." });
  const tour = await createTour(req.params.id, name);
  if (!tour) return res.status(404).json({ error: "Profile not found." });
  res.status(201).json(tour);
});

app.delete("/api/profiles/:id/tours/:tourId", async (req, res) => {
  const ok = await deleteTour(req.params.id, req.params.tourId);
  if (!ok) return res.status(404).json({ error: "Tour not found." });
  res.status(204).end();
});

app.get("/api/profiles/:id/tours/:tourId/itinerary", async (req, res) => {
  const summary = await getTourSummary(req.params.id, req.params.tourId);
  if (!summary) return res.status(404).json({ error: "Tour not found." });
  summary.itinerary = applyBookingStatus(summary.itinerary, {
    confirmations: summary.confirmations,
    chosenNames: summary.chosenNames,
    profile: await getProfile(req.params.id),
  });
  res.json(summary);
});

/**
 * The only way a segment becomes "confirmed" — a human saying they booked it,
 * and saying through which channel, because that is what the fee depends on.
 */
app.post("/api/profiles/:id/tours/:tourId/confirm", async (req, res) => {
  const { segmentKey: key, reference, confirmed, channel } = req.body || {};
  if (!key) return res.status(400).json({ error: "segmentKey is required." });
  if (channel && !Object.values(BOOKING_CHANNELS).includes(channel)) {
    return res.status(400).json({ error: "Unknown booking channel." });
  }

  const confirmations = await confirmSegment(
    req.params.id,
    req.params.tourId,
    key,
    reference || "",
    confirmed !== false,
    channel || BOOKING_CHANNELS.DIRECT,
  );
  if (!confirmations) return res.status(404).json({ error: "Tour not found." });

  const summary = await getTourSummary(req.params.id, req.params.tourId);
  summary.itinerary = applyBookingStatus(summary.itinerary, {
    confirmations: summary.confirmations,
    chosenNames: summary.chosenNames,
    profile: await getProfile(req.params.id),
  });
  res.json(summary);
});

/**
 * A ready-to-send brief for the travel agency covering the segments the user
 * picks. Composed from stored facts only — no model call — because this is
 * the document a human acts on, and every line of it has to be true.
 */
app.post("/api/profiles/:id/tours/:tourId/agency-brief", async (req, res) => {
  const keys = req.body?.segmentKeys;
  if (!Array.isArray(keys) || !keys.length) {
    return res.status(400).json({ error: "Pick at least one segment to send." });
  }

  const profile = await getProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found." });
  const summary = await getTourSummary(req.params.id, req.params.tourId);
  if (!summary) return res.status(404).json({ error: "Tour not found." });

  const itinerary = applyBookingStatus(summary.itinerary, {
    confirmations: summary.confirmations,
    chosenNames: summary.chosenNames,
    profile,
  });

  const wanted = new Set(keys);
  const picked = (itinerary?.days || []).flatMap((d) =>
    (d.segments || []).filter((s) => wanted.has(s.segmentKey)).map((s) => ({ day: d.day, ...s })),
  );
  if (!picked.length) return res.status(404).json({ error: "No matching segments." });

  const agency = profile.agency || {};
  const party = travellingParty(profile);
  const allergies = partyAllergies(profile);
  const contact = (profile.party || []).find((m) => m.booksOnBehalf);

  const lines = [
    `BOOKING REQUEST — ${profile.name} — ${summary.tourName}`,
    contact ? `Raised by: ${contact.name} (${contact.role})${contact.email ? ` · ${contact.email}` : ""}` : "",
    "",
    `PARTY (${party.length}): ${party.map((m) => `${m.name} — ${m.role}`).join("; ")}`,
    allergies.length
      ? `ALLERGIES ACROSS THE PARTY — SAFETY CRITICAL: ${allergies
          .map((a) => `${a.name} (${a.severity}; ${allergyOwners(profile, a.name).join(", ")})`)
          .join("; ")}`
      : "ALLERGIES: none recorded",
    party.some((m) => (m.dietary || []).length)
      ? `DIETARY: ${party
          .filter((m) => (m.dietary || []).length)
          .map((m) => `${m.name}: ${m.dietary.join(", ")}`)
          .join("; ")}`
      : "",
    (profile.loyalty || []).length
      ? `LOYALTY NUMBERS TO APPLY: ${profile.loyalty
          .map(
            (l) =>
              `${l.program}${l.memberId ? ` #${l.memberId}` : " (no number on file)"}${
                l.tier ? ` — ${l.tier}` : ""
              }`,
          )
          .join("; ")}`
      : "",
    "",
    "REQUESTED BOOKINGS:",
    ...picked.map(
      (s, i) =>
        `  ${i + 1}. ${s.day} · ${s.time || "TBC"} — ${s.title}` +
        `${s.provider ? ` — ${s.provider}` : ""}${s.location ? ` — ${s.location}` : ""}` +
        `${s.url ? `\n     ref link: ${s.url}` : ""}` +
        `${s.carrying ? `\n     carrying: ${s.carrying}` : ""}` +
        `${s.notes ? `\n     notes: ${s.notes}` : ""}`,
    ),
    "",
    `FEE: ${agency.currency} ${agency.feePerBooking} per booking placed × ${picked.length} = ${
      agency.currency
    } ${agency.feePerBooking * picked.length}.`,
    "Nothing in this request is booked yet. Please confirm each line back with a reference.",
  ].filter((l) => l !== "");

  res.json({
    brief: lines.join("\n"),
    segmentCount: picked.length,
    fee: agency.feePerBooking * picked.length,
    currency: agency.currency,
    agencyName: agency.name,
    agencyContact: agency.contact,
  });
});

app.get("/api/profiles/:id/tours/:tourId/threads/:toolId", async (req, res) => {
  const thread = await getThread(req.params.id, req.params.tourId, req.params.toolId);
  if (!thread) return res.status(404).json({ error: "Thread not found." });
  res.json(thread);
});

app.post("/api/profiles/:id/tours/:tourId/threads/:toolId/status", async (req, res) => {
  const { name, status, reason } = req.body || {};
  if (!name || !status) return res.status(400).json({ error: "name and status are required." });
  const thread = await setOptionStatus(
    req.params.id,
    req.params.tourId,
    req.params.toolId,
    name,
    status,
    reason || "",
  );
  if (!thread) return res.status(404).json({ error: "Thread not found." });
  res.json(thread);
});

// ---------------------------------------------------------------------------
// Chat — the main endpoint
// ---------------------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  const { profileId, tourId, toolId } = req.body || {};

  if (!message) return res.status(400).json({ error: "Message is required." });
  if (!profileId || !tourId || !toolId) {
    return res.status(400).json({ error: "Select a profile, a tour, and a service area first." });
  }

  const tool = getTool(toolId);
  if (!tool) return res.status(400).json({ error: "Unknown service area." });

  const profile = await getProfile(profileId);
  if (!profile) return res.status(404).json({ error: "Profile not found." });

  const tour = profile.tours.find((t) => t.id === tourId);
  if (!tour) return res.status(404).json({ error: "Tour not found." });

  const thread = tour.threads[toolId] || { messages: [], decisions: [], considered: [] };
  const isPlanner = toolId === MASTER_TOOL_ID;

  // The planner reads every other thread on this tour; specialists see only
  // their own.
  const summary = isPlanner ? await getTourSummary(profileId, tourId) : null;
  const context = isPlanner
    ? buildPlannerContext({ profile, tour, thread, summary })
    : buildContext({ profile, tool, tour, thread });

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: context + "\n" + message,
      config: {
        systemInstruction: isPlanner ? PLANNER_SYSTEM_PROMPT : SYSTEM_PROMPT,
        maxOutputTokens: isPlanner ? 16000 : 8000,
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";
    let data;
    try {
      data = extractJson(text);
    } catch {
      return res.status(502).json({ error: "Could not parse the concierge response.", raw: text });
    }

    // Active allergies = everyone travelling, plus anything stated this turn.
    // Union, never intersection — a stored allergy stays in force even if this
    // message forgot to mention it, and a companion's allergy is as binding as
    // the artist's because they eat at the same table.
    const stated = (data.profileUpdates?.global?.allergies || []).map((a) =>
      typeof a === "string" ? { name: a, severity: "unknown" } : a,
    );
    const activeAllergies = [...partyAllergies(profile), ...stated].filter((a) => a?.name);

    data.options = enforceAllergySafety(data.options, activeAllergies, tool);
    data.options = enforceLoyalty(data.options, profile, tool.loyaltyCategory);
    data.options = attachBookingChannels(data.options, profile, tool);

    data.allergyWatch = {
      inScope: tool.allergyRelevant && activeAllergies.length > 0,
      // Name whose allergy it is — "tree nuts (Dana, tour manager)" is
      // actionable in a way that a bare list is not.
      active: activeAllergies.map((a) => ({ ...a, owners: allergyOwners(profile, a.name) })),
      severe: activeAllergies
        .filter((a) => normalizeSeverity(a.severity) === "severe")
        .map((a) => a.name),
      unverifiedCount: data.options.filter((o) => o.allergySafety.status === "unverified").length,
    };

    data.party = travellingParty(profile).map((m) => ({ name: m.name, role: m.role }));
    data.agency = profile.agency;

    // Persist the turn — this is what makes the next message in this thread
    // aware of what was decided and what was already ruled out. The full
    // summary is stored per option so the sidebar can show it on demand.
    const updatedThread = await appendThreadTurn(profileId, tourId, toolId, {
      messages: [
        { role: "user", text: message },
        { role: "agent", text: data.reply || "" },
      ],
      decisions: data.decisions || [],
      considered: (data.options || []).map((o) => ({
        name: o.name,
        url: o.url,
        status: "considered",
        location: o.location,
        priceTier: o.priceTier,
        notes: o.notes,
        matches: o.matches,
        allergySafety: o.allergySafety,
        loyalty: o.loyalty,
        booking: o.booking,
      })),
    });

    if (isPlanner && data.itinerary) {
      const saved = await saveItinerary(profileId, tourId, data.itinerary);
      // Booking state, fees, and loyalty claims are all derived from stored
      // facts here, never from what the model claimed.
      data.itinerary = applyBookingStatus(saved.itinerary, {
        confirmations: saved.confirmations,
        chosenNames: summary?.chosenNames || [],
        profile,
      });
    }

    const updatedProfile = await mergeLearnings(profileId, toolId, data.profileUpdates || {});

    // Tell the UI what got written to the person's global record, so a dietary
    // note dropped in the transport chat visibly lands everywhere.
    const g = data.profileUpdates?.global || {};
    data.globalLearned = [
      ...(g.dietary || []).map((x) => ({ kind: "dietary", text: x })),
      ...(g.allergies || []).map((a) => ({
        kind: "allergy",
        text: typeof a === "string" ? a : `${a.name} (${a.severity})`,
      })),
      ...(g.otherPreferences || []).map((x) => ({ kind: "preference", text: x })),
      ...(g.notes || []).map((x) => ({ kind: "note", text: x })),
      ...Object.entries(g.brands || {}).flatMap(([field, list]) =>
        (list || []).map((x) => ({
          kind: field === "avoid" ? "avoid" : "brand",
          text: field === "avoid" ? `avoid ${x}` : x,
        })),
      ),
      // Only members that actually exist get written, so only report those.
      ...(data.profileUpdates?.party || []).flatMap((m) => {
        const exists = (updatedProfile?.party || []).some(
          (x) => x.name.toLowerCase() === String(m.name || "").toLowerCase(),
        );
        if (!exists) return [];
        const bits = [
          ...(m.dietary || []),
          ...(m.allergies || []).map((a) => (typeof a === "string" ? a : a.name)),
          ...(m.preferences || []),
        ];
        return bits.map((b) => ({ kind: "party", text: `${m.name}: ${b}` }));
      }),
    ];

    data.thread = updatedThread;
    data.profile = updatedProfile;
    res.json(data);
  } catch (err) {
    console.error(err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Concierge lookup failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IHMS concierge running at http://localhost:${PORT}`);
});
