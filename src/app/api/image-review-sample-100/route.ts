import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Destination = {
  id: string;
  name: string;
  destination_type: string | null;
  country_code: string | null;
};

const TARGETS = [
  { type: "settlement", count: 40 },
  { type: "region", count: 25 },
  { type: "park", count: 20 },
  { type: "rural_area", count: 15 },
];

function env(name: string) {
  return process.env[name]?.trim() || "";
}

async function fetchType(
  supabaseUrl: string,
  apiKey: string,
  type: string,
  count: number
): Promise<Destination[]> {
  const poolSize = Math.max(count * 8, 120);

  const params = new URLSearchParams({
    select: "id,name,destination_type,country_code",
    destination_type: `eq.${type}`,
    is_active: "eq.true",
    name: "not.is.null",
    order: "name.asc",
    limit: String(poolSize),
  });

  const r = await fetch(`${supabaseUrl}/rest/v1/destinations?${params}`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Supabase ${type} query failed (${r.status}): ${body.slice(0, 250)}`);
  }

  const pool = (await r.json()) as Destination[];
  if (pool.length <= count) return pool;

  // Deterministic spread across the alphabetically ordered pool.
  const selected: Destination[] = [];
  const used = new Set<number>();

  for (let i = 0; i < count; i++) {
    const index = Math.min(
      pool.length - 1,
      Math.floor((i + 0.5) * pool.length / count)
    );

    if (!used.has(index)) {
      used.add(index);
      selected.push(pool[index]);
    }
  }

  return selected;
}

export async function GET() {
  try {
    const supabaseUrl =
      env("NEXT_PUBLIC_SUPABASE_URL") ||
      env("SUPABASE_URL");

    const apiKey =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      env("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing Supabase URL/API key environment variable.",
        },
        { status: 500 }
      );
    }

    const groups = await Promise.all(
      TARGETS.map((t) => fetchType(supabaseUrl, apiKey, t.type, t.count))
    );

    const destinations = groups.flat();

    const counts = destinations.reduce((acc: Record<string, number>, d) => {
      const key = d.destination_type || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      validation_only: true,
      endpoint_version: "pexels-100-sample-v1",
      target: 100,
      actual: destinations.length,
      sampling_plan: TARGETS,
      counts,
      destinations,
      note: "Dedicated 100-destination sample endpoint. No image uploads or database writes.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "100-destination sample failed.",
      },
      { status: 500 }
    );
  }
}
