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
  // Pull a larger deterministic pool, then spread the sample across it.
  // This avoids taking only the first N alphabetically while keeping the test repeatable.
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
          accepted_url_vars: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
          accepted_key_vars: [
            "SUPABASE_SERVICE_ROLE_KEY",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            "SUPABASE_ANON_KEY",
          ],
        },
        { status: 500 }
      );
    }

    const groups = await Promise.all(
      TARGETS.map(t => fetchType(supabaseUrl, apiKey, t.type, t.count))
    );

    const destinations = groups.flat();
    const counts = destinations.reduce((acc: Record<string, number>, d) => {
      const k = d.destination_type || "unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      validation_only: true,
      target: 100,
      actual: destinations.length,
      sampling_plan: TARGETS,
      counts,
      destinations,
      note:
        "This endpoint only samples destinations. It does not write to Supabase or upload images.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Sample failed." },
      { status: 500 }
    );
  }
}
