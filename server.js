import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
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

const SYSTEM_PROMPT = `You are the Intelligent Health Monitoring System's hotel concierge for touring musicians.

The user gives you a free-form paragraph describing what they are looking for. You may also be given a stored PREFERENCE PROFILE for this artist — treat those stored constraints as active for this trip even if the paragraph does not repeat them.

Your job:
1. Extract the location and every constraint from the paragraph, then combine them with the stored profile.
2. Use Google Search to find real hotels in that location matching the combined constraints.
3. Assess each hotel against the artist's ALLERGIES specifically (see the safety rules).
4. Report any new durable facts you learned about this artist.

## Allergy safety rules (highest priority — these override everything else)
- Allergies are safety-critical, NOT preferences. Never trade an allergy away to satisfy a preference, and never treat a hotel as suitable because it is a close-enough match.
- For every hotel, give an explicit "allergySafety" verdict:
  - "verified"   — you found a published allergen policy, allergen-aware kitchen, or equivalent concrete evidence. Cite what you found in the note.
  - "unverified" — no allergen information found. This is the correct answer when you did not find evidence. Do not guess.
  - "risk"       — you found something that actively conflicts with the allergy (e.g. a nut-forward kitchen with no substitutions).
- If the artist has no recorded allergies, use "not_applicable".
- Never state or imply that a hotel is safe for an allergy without evidence. "unverified" is always better than an optimistic guess.

## Learning
Report durable, reusable facts about the artist in "profileUpdates" — things that will still be true on their next trip (a standing dietary requirement, an allergy, "always wants a quiet room", "prefers boutique hotels"). Do NOT report trip-specific details (this city, these dates, this venue). Return empty arrays if nothing durable was learned.

## Output
After any searching, end your reply with EXACTLY ONE fenced JSON code block (\`\`\`json ... \`\`\`) and nothing after it:

{
  "parsed": {
    "location": "string or null",
    "dietary": ["..."],
    "allergies": [{ "name": "tree nuts", "severity": "severe | moderate | mild | unknown" }],
    "otherPreferences": ["..."]
  },
  "hotels": [
    {
      "name": "Hotel name",
      "url": "https://... (a real link you found)",
      "location": "neighbourhood / city",
      "priceTier": "budget | mid | luxury | unknown",
      "matches": ["short phrase per constraint it satisfies"],
      "allergySafety": {
        "status": "verified | unverified | risk | not_applicable",
        "note": "what evidence you did or did not find"
      },
      "notes": "one or two sentences on why this fits"
    }
  ],
  "profileUpdates": {
    "dietary": ["..."],
    "allergies": [{ "name": "...", "severity": "..." }],
    "otherPreferences": ["..."],
    "notes": ["durable free-text facts about this artist"]
  }
}

Rules:
- Only include hotels you actually found via search, with real URLs. Do not invent links.
- Return 3-6 hotels when possible. If the location is missing, set "location" to null and return an empty "hotels" array.
- Keep every string concise. Output valid JSON only inside the block.`;

function profileContext(profile) {
  if (!profile) return "";
  const allergies = (profile.allergies || [])
    .map((a) => `${a.name} (${a.severity})`)
    .join(", ");
  return `
STORED PREFERENCE PROFILE — "${profile.name}"
Dietary: ${(profile.dietary || []).join(", ") || "none recorded"}
Allergies: ${allergies || "none recorded"}
Other preferences: ${(profile.otherPreferences || []).join(", ") || "none recorded"}
Learned notes: ${(profile.notes || []).join("; ") || "none recorded"}

These constraints are active for this trip. The paragraph below may add to them.
---
`;
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
// the actual safety boundary: if allergies are in play, no hotel may reach the
// user without an explicit verdict, and anything the model left blank, unknown,
// or optimistic-without-evidence is forced to "unverified".
// ---------------------------------------------------------------------------

const VALID_STATUS = new Set(["verified", "unverified", "risk", "not_applicable"]);

function enforceAllergySafety(hotels, activeAllergies) {
  const hasAllergies = activeAllergies.length > 0;

  return (hotels || []).map((h) => {
    if (!hasAllergies) {
      return {
        ...h,
        allergySafety: { status: "not_applicable", note: "No allergies on record." },
      };
    }

    const given = h.allergySafety || {};
    let status = String(given.status || "").toLowerCase();
    let note = given.note;

    if (!VALID_STATUS.has(status) || status === "not_applicable") {
      // Allergies exist, so "not applicable" is never a valid answer here.
      status = "unverified";
      note = note || "No allergen information found for this property.";
    }
    if (status === "verified" && !note) {
      // A "safe" verdict with no evidence behind it is exactly what we refuse
      // to pass along.
      status = "unverified";
      note = "Marked safe without supporting evidence — treat as unverified.";
    }
    return { ...h, allergySafety: { status, note: note || "" } };
  });
}

function severeAllergyNames(allergies) {
  return allergies
    .filter((a) => normalizeSeverity(a.severity) === "severe")
    .map((a) => a.name);
}

// ---------------------------------------------------------------------------
// Profile routes
// ---------------------------------------------------------------------------

app.get("/api/profiles", async (_req, res) => {
  res.json(await listProfiles());
});

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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

app.post("/api/search", async (req, res) => {
  const request = (req.body?.request || "").trim();
  const profileId = req.body?.profileId || null;

  if (!request) {
    return res.status(400).json({ error: "Please describe what you are looking for." });
  }

  let profile = null;
  if (profileId) {
    profile = await getProfile(profileId);
    if (!profile) return res.status(404).json({ error: "Profile not found." });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: profileContext(profile) + request,
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

    // Active allergies = everything on the profile plus anything stated this
    // time. Union, never intersection — a stored allergy stays in force even if
    // this request forgot to mention it.
    const stated = (data.parsed?.allergies || []).map((a) =>
      typeof a === "string" ? { name: a, severity: "unknown" } : a,
    );
    const activeAllergies = [...(profile?.allergies || []), ...stated].filter(
      (a) => a && a.name,
    );

    data.hotels = enforceAllergySafety(data.hotels, activeAllergies);
    data.allergyWatch = {
      active: activeAllergies,
      severe: severeAllergyNames(activeAllergies),
      unverifiedCount: data.hotels.filter((h) => h.allergySafety.status === "unverified").length,
    };

    // Continuous learning — fold durable facts back into the profile.
    if (profile) {
      const updated = await mergeLearnings(profile.id, data.profileUpdates || {}, {
        request: request.slice(0, 300),
        location: data.parsed?.location || null,
      });
      data.profile = updated;
    }

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
