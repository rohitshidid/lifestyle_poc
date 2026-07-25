import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { TOOLS, TOOL_IDS, getTool } from "./tools.js";
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
  normalizeSeverity,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
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
- their preferences for THIS service area specifically
- the conversation so far on this tour for this service area
- the decisions already locked in for this tour
- the options already considered, and their status

## Memory rules (critical)
- The conversation is CONTINUOUS. Treat earlier turns as binding context.
- Never re-propose an option already marked "rejected" unless the user's new message explicitly reverses that.
- Respect locked-in decisions. If the user's new message contradicts one (a changed route, new dates, a dropped city), acknowledge the change, say which prior decision it supersedes, and return that superseded decision in "supersededDecisions".
- When the route or plan changes, carry forward everything still valid. Do not restart from scratch.

## Allergy safety rules (highest priority — these override everything else)
- Allergies are safety-critical, NOT preferences. Never trade an allergy away for a preference, and never call a place suitable because it is a close-enough match.
- For each option give an explicit "allergySafety" verdict:
  - "verified"   — you found a published allergen policy or equivalent concrete evidence. Say what you found in the note.
  - "unverified" — no allergen information found. This is the correct answer when you lack evidence. Do not guess.
  - "risk"       — something actively conflicts with the allergy.
  - "not_applicable" — the artist has no recorded allergies, or this service area cannot involve allergens.
- Never state or imply an option is safe without evidence. "unverified" always beats an optimistic guess.

## Learning
Report durable, reusable facts in "profileUpdates":
- "global" — true on every future tour (a standing allergy, "always wants a quiet room").
- "tool"   — true for this service area only ("prefers boutique hotels", "hates sprinter vans").
Do NOT report trip-specific details (this city, these dates, this venue) — those belong in decisions, not the profile.

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
      "notes": "one or two sentences on why this fits"
    }
  ],
  "decisions": ["a decision locked in during THIS turn, if any"],
  "supersededDecisions": ["a previously locked decision this turn invalidates, if any"],
  "profileUpdates": {
    "global": { "dietary": [], "allergies": [{"name":"...","severity":"..."}], "otherPreferences": [], "notes": [] },
    "tool":   { "preferences": [], "notes": [] }
  }
}

Rules:
- Only include options you actually found via search, with real URLs. Do not invent links.
- Return 3-6 options when you are searching. If the user is just talking (confirming, changing plans, asking a question), return an empty "options" array and answer in "reply".
- Keep every string concise. Output valid JSON only inside the block.`;

function buildContext({ profile, tool, tour, thread }) {
  const allergies = (profile.allergies || [])
    .map((a) => `${a.name} (${a.severity})`)
    .join(", ");

  const lines = [
    `SERVICE AREA: ${tool.label} — ${tool.blurb}`,
    `ALLERGY-RELEVANT AREA: ${tool.allergyRelevant ? "yes" : "no"}`,
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
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
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

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: buildContext({ profile, tool, tour, thread }) + "\n" + message,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8000,
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

    // Active allergies = profile plus anything stated this turn. Union, never
    // intersection — a stored allergy stays in force even if this message
    // forgot to mention it.
    const stated = (data.profileUpdates?.global?.allergies || []).map((a) =>
      typeof a === "string" ? { name: a, severity: "unknown" } : a,
    );
    const activeAllergies = [...(profile.allergies || []), ...stated].filter((a) => a?.name);

    data.options = enforceAllergySafety(data.options, activeAllergies, tool);
    data.allergyWatch = {
      inScope: tool.allergyRelevant && activeAllergies.length > 0,
      active: activeAllergies,
      severe: activeAllergies
        .filter((a) => normalizeSeverity(a.severity) === "severe")
        .map((a) => a.name),
      unverifiedCount: data.options.filter((o) => o.allergySafety.status === "unverified").length,
    };

    // Persist the turn — this is what makes the next message in this thread
    // aware of what was decided and what was already ruled out.
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
      })),
    });

    const updatedProfile = await mergeLearnings(profileId, toolId, data.profileUpdates || {});

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
