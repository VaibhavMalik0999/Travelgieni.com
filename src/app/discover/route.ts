import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_INTENTS = new Set([
  'arts_entertainment',
  'bars_evening_drinks',
  'beach_coast',
  'cafe_culture',
  'clubbing_nightlife',
  'culture_history',
  'family_attractions',
  'food_dining',
  'hiking_outdoors',
  'nature_scenery',
  'resort_experience',
  'shopping_markets',
  'sports_recreation',
  'water_activities',
  'wellness',
]);

type MatchType = 'minimum' | 'target' | 'maximum';

type Preference = {
  target: number;
  importance: number;
  match_type: MatchType;
  tolerance?: number;
  hard_min?: number;
  hard_max?: number;
};

type RequestBody = {
  preferences?: Record<string, Preference>;
  limit?: number;
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validatePreferences(input: unknown): Record<string, Preference> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('preferences must be an object');
  }

  const clean: Record<string, Preference> = {};

  for (const [intent, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_INTENTS.has(intent)) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const value = raw as Partial<Preference>;

    if (!isNumber(value.target) || value.target < 0 || value.target > 100) {
      throw new Error(`Invalid target for ${intent}`);
    }

    if (!isNumber(value.importance) || value.importance <= 0 || value.importance > 1) {
      throw new Error(`Invalid importance for ${intent}`);
    }

    if (
      value.match_type !== 'minimum' &&
      value.match_type !== 'target' &&
      value.match_type !== 'maximum'
    ) {
      throw new Error(`Invalid match_type for ${intent}`);
    }

    const tolerance = isNumber(value.tolerance)
      ? Math.min(50, Math.max(5, value.tolerance))
      : 18;

    const pref: Preference = {
      target: value.target,
      importance: value.importance,
      match_type: value.match_type,
      tolerance,
    };

    if (isNumber(value.hard_min)) {
      pref.hard_min = Math.min(100, Math.max(0, value.hard_min));
    }

    if (isNumber(value.hard_max)) {
      pref.hard_max = Math.min(100, Math.max(0, value.hard_max));
    }

    if (
      pref.hard_min !== undefined &&
      pref.hard_max !== undefined &&
      pref.hard_min > pref.hard_max
    ) {
      throw new Error(`hard_min cannot exceed hard_max for ${intent}`);
    }

    clean[intent] = pref;
  }

  if (Object.keys(clean).length === 0) {
    throw new Error('Choose at least one travel preference.');
  }

  return clean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const preferences = validatePreferences(body.preferences);
    const limit = Math.min(12, Math.max(3, isNumber(body.limit) ? Math.round(body.limit) : 8));

    // Reuse the URL variable already used by the existing TravelGieni repo.
    // SUPABASE_URL is also supported if you prefer a server-only URL variable.
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            'Server configuration is incomplete. Add SUPABASE_SERVICE_ROLE_KEY in Vercel. The app can reuse NEXT_PUBLIC_SUPABASE_URL for the project URL.',
        },
        { status: 500 },
      );
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/match_travelginni_destinations_final`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_preferences: preferences,
          p_limit: limit,
          p_apply_diversity: true,
        }),
        cache: 'no-store',
      },
    );

    const payload = await response.json();

    if (!response.ok) {
      console.error('TravelGieni matcher error', payload);
      return NextResponse.json(
        { error: 'The destination matcher could not complete this search.' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      results: payload,
      resultCount: Array.isArray(payload) ? payload.length : 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid discovery request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
