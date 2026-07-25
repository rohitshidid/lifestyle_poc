// Preference Profile store.
//
// Deliberately a flat JSON file: a POC needs zero-setup persistence, and the
// surface here (list/get/create/update/remove/merge) is small enough to swap for
// a real database without touching callers.

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "profiles.json");

// All writes go through this chain so concurrent requests can't interleave a
// read-modify-write and lose an update.
let writeQueue = Promise.resolve();

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(profiles) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(profiles, null, 2));
}

function serialize(fn) {
  const next = writeQueue.then(fn, fn);
  // Keep the chain alive even if one operation rejects.
  writeQueue = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Allergy severity
//
// Severity is ranked so a merge can only ever escalate. Downgrading an allergy
// on the strength of a loosely-worded sentence is the one failure mode in this
// system that can put someone in hospital, so it is not permitted.
// ---------------------------------------------------------------------------

const SEVERITY_RANK = { unknown: 0, mild: 1, moderate: 2, severe: 3 };

export function normalizeSeverity(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("anaphyla") || v.includes("severe") || v.includes("critical")) return "severe";
  if (v.includes("moderate")) return "moderate";
  if (v.includes("mild")) return "mild";
  return "unknown";
}

function normalizeAllergy(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { name: entry.trim(), severity: "unknown" };
  }
  const name = String(entry.name || "").trim();
  if (!name) return null;
  return { name, severity: normalizeSeverity(entry.severity) };
}

/** Merge allergy lists, keeping the highest severity ever recorded for a name. */
function mergeAllergies(existing = [], incoming = []) {
  const byName = new Map();
  for (const raw of [...existing, ...incoming]) {
    const a = normalizeAllergy(raw);
    if (!a) continue;
    const key = a.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, a);
      continue;
    }
    // Escalate only — never downgrade a recorded severity.
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[prev.severity]) {
      byName.set(key, { ...prev, severity: a.severity });
    }
  }
  return [...byName.values()];
}

/** Case-insensitive union of two string lists, preserving first-seen casing. */
function mergeStrings(existing = [], incoming = []) {
  const seen = new Map();
  for (const raw of [...existing, ...incoming]) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

function blankProfile(name) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name || "Untitled profile",
    createdAt: now,
    updatedAt: now,
    dietary: [],
    allergies: [],
    otherPreferences: [],
    // Durable free-text facts learned across interactions (e.g. "prefers high
    // floors", "disliked the Berlin Marriott").
    notes: [],
    // Lightweight trip log so the profile shows its own history.
    history: [],
  };
}

export async function listProfiles() {
  const profiles = await readAll();
  return profiles.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function getProfile(id) {
  const profiles = await readAll();
  return profiles.find((p) => p.id === id) || null;
}

export async function createProfile(data = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const profile = {
      ...blankProfile(data.name),
      dietary: mergeStrings([], data.dietary),
      allergies: mergeAllergies([], data.allergies),
      otherPreferences: mergeStrings([], data.otherPreferences),
      notes: mergeStrings([], data.notes),
    };
    profiles.push(profile);
    await writeAll(profiles);
    return profile;
  });
}

/** Replace fields outright — used by the manual profile editor in the UI. */
export async function updateProfile(id, patch = {}) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === id);
    if (i === -1) return null;

    const current = profiles[i];
    const updated = {
      ...current,
      name: patch.name !== undefined ? String(patch.name).trim() || current.name : current.name,
      dietary: patch.dietary !== undefined ? mergeStrings([], patch.dietary) : current.dietary,
      allergies:
        patch.allergies !== undefined
          ? mergeAllergies([], patch.allergies)
          : current.allergies,
      otherPreferences:
        patch.otherPreferences !== undefined
          ? mergeStrings([], patch.otherPreferences)
          : current.otherPreferences,
      notes: patch.notes !== undefined ? mergeStrings([], patch.notes) : current.notes,
      updatedAt: new Date().toISOString(),
    };
    profiles[i] = updated;
    await writeAll(profiles);
    return updated;
  });
}

/**
 * Continuous learning: fold newly-observed durable facts into a profile.
 * Additive by design — learning never removes a stored constraint, because a
 * single ambiguous sentence should not be able to erase a standing allergy.
 */
export async function mergeLearnings(id, learnings = {}, historyEntry = null) {
  return serialize(async () => {
    const profiles = await readAll();
    const i = profiles.findIndex((p) => p.id === id);
    if (i === -1) return null;

    const current = profiles[i];
    const updated = {
      ...current,
      dietary: mergeStrings(current.dietary, learnings.dietary),
      allergies: mergeAllergies(current.allergies, learnings.allergies),
      otherPreferences: mergeStrings(current.otherPreferences, learnings.otherPreferences),
      notes: mergeStrings(current.notes, learnings.notes),
      updatedAt: new Date().toISOString(),
    };

    if (historyEntry) {
      updated.history = [
        { at: new Date().toISOString(), ...historyEntry },
        ...(current.history || []),
      ].slice(0, 25);
    }

    profiles[i] = updated;
    await writeAll(profiles);
    return updated;
  });
}

export async function deleteProfile(id) {
  return serialize(async () => {
    const profiles = await readAll();
    const next = profiles.filter((p) => p.id !== id);
    if (next.length === profiles.length) return false;
    await writeAll(next);
    return true;
  });
}

export { mergeAllergies, mergeStrings };
