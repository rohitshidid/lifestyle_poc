import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = "gemini-2.5-flash";

// The model extracts constraints from the free-text request, uses Google Search
// grounding to find hotels in the requested location that satisfy those
// constraints, and returns a single JSON object at the end of its reply that we
// parse and serve.
const SYSTEM_PROMPT = `You are the Intelligent Health Monitoring System's hotel concierge for touring musicians.

The user gives you a free-form paragraph describing what they are looking for. It may include:
- a location / city they are travelling to
- dietary constraints (vegan, halal, kosher, gluten-free, etc.)
- allergies (nuts, shellfish, dairy, etc.)
- any other preferences (quiet room, gym, near the venue, budget tier, pet-friendly, accessibility, etc.)

Your job:
1. Extract the location and every constraint from the paragraph.
2. Use Google Search to find real hotels in that location that plausibly match the constraints, paying special attention to dietary needs and allergies (on-site restaurant options, kitchenettes, allergy-friendly kitchens, nearby suitable restaurants).
3. Return the results.

After any searching, end your reply with EXACTLY ONE fenced JSON code block (\`\`\`json ... \`\`\`) and nothing after it, in this shape:

{
  "parsed": {
    "location": "string or null",
    "dietary": ["..."],
    "allergies": ["..."],
    "otherPreferences": ["..."]
  },
  "hotels": [
    {
      "name": "Hotel name",
      "url": "https://... (a real link you found)",
      "location": "neighbourhood / city",
      "priceTier": "budget | mid | luxury | unknown",
      "matches": ["short phrase per constraint it satisfies"],
      "notes": "one or two sentences on why this fits the dietary/allergy needs"
    }
  ]
}

Rules:
- Only include hotels you actually found via search, with real URLs. Do not invent links.
- Return 3-6 hotels when possible. If the location is missing, set "location" to null and return an empty "hotels" array.
- Keep every string concise. Output valid JSON only inside the block.`;

function extractJson(text) {
  // Prefer a fenced ```json block; fall back to the last {...} span.
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

app.post("/api/search", async (req, res) => {
  const request = (req.body?.request || "").trim();
  if (!request) {
    return res.status(400).json({ error: "Please describe what you are looking for." });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: request,
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
      return res.status(502).json({
        error: "Could not parse the concierge response.",
        raw: text,
      });
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
