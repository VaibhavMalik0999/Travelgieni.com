import { NextRequest, NextResponse } from "next/server";
import { INTENTS, type IntentKey } from "@/lib/intents";
import type { ExplorePreference, ExplorePreferences } from "@/lib/explore-types";
import { rankExplorePois } from "@/lib/explore-ranking";
import {
  createExplorePoiSourceFromEnvironment,
  ExplorePoiSourceError,
} from "@/lib/explore-poi-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_INTENTS = new Set<IntentKey>(INTENTS.map(({ key }) => key));

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validatePreferences(value: unknown): ExplorePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("preferences must be an object");
  }

  const preferences: ExplorePreferences = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ALLOWED_INTENTS.has(key as IntentKey)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const preference = raw as Partial<ExplorePreference>;
    if (!finite(preference.target) || preference.target < 0 || preference.target > 100) {
      throw new Error(`Invalid target for ${key}`);
    }
    if (!finite(preference.importance) || preference.importance <= 0 || preference.importance > 1) {
      throw new Error(`Invalid importance for ${key}`);
    }
    const matchType = preference.match_type;
    if (matchType !== "minimum" && matchType !== "target" && matchType !== "maximum") {
      throw new Error(`Invalid match_type for ${key}`);
    }
    preferences[key as IntentKey] = {
      target: preference.target,
      importance: preference.importance,
      match_type: matchType,
      ...(finite(preference.tolerance) ? { tolerance: preference.tolerance } : {}),
      ...(finite(preference.hard_min) ? { hard_min: preference.hard_min } : {}),
      ...(finite(preference.hard_max) ? { hard_max: preference.hard_max } : {}),
    };
  }
  if (!Object.keys(preferences).length) {
    throw new Error("Choose at least one travel preference.");
  }
  return preferences;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const destinationId = String(body?.traveller_destination_id ?? "").trim();
    if (!destinationId) {
      return NextResponse.json({ error: "traveller_destination_id is required" }, { status: 400 });
    }
    const preferences = validatePreferences(body?.preferences);
    const requestedLimit = finite(body?.limit) ? Math.round(body.limit) : 20;
    const limit = Math.min(50, Math.max(1, requestedLimit));

    const candidates = await createExplorePoiSourceFromEnvironment().getCandidates(destinationId);
    return NextResponse.json(rankExplorePois(destinationId, candidates, preferences, { limit }));
  } catch (error) {
    if (error instanceof ExplorePoiSourceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.upstreamStatus === 500 ? 500 : 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Explore request." },
      { status: 400 }
    );
  }
}
