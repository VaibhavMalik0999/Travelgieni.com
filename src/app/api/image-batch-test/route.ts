import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string | null;
  src: { large2x?: string; large?: string; landscape?: string; original?: string };
};

type SelectedImage = {
  rank: number;
  title: string;
  score: number;
  source_query: string;
  thumbnail_url: string;
  commons_page: string;
  creator: string;
  license: string;
  license_url: string;
  description: string | null;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

async function searchPexels(destination: string) {
  const apiKey = env("PEXELS_API_KEY");
  if (!apiKey) throw new Error("Missing PEXELS_API_KEY environment variable.");

  const params = new URLSearchParams({
    query: destination,
    orientation: "landscape",
    size: "large",
    per_page: "30",
    page: "1",
  });

  const r = await fetch(`https://api.pexels.com/v1/search?${params.toString()}`, {
    headers: { Authorization: apiKey, Accept: "application/json" },
    cache: "no-store",
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Pexels ${r.status}: ${body.slice(0, 180)}`);
  }

  const data = await r.json();
  return (data?.photos ?? []) as PexelsPhoto[];
}

function selectThree(destination: string, photos: PexelsPhoto[]): SelectedImage[] {
  // Keep this deliberately simple: Pexels search relevance/curation is what we are testing.
  // Avoid near-identical source records and take the first three strong landscape results.
  const seen = new Set<number>();
  const unique = photos.filter((p) => {
    if (!p?.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return p.width > p.height && Boolean(p.src?.large2x || p.src?.large || p.src?.landscape);
  });

  return unique.slice(0, 3).map((p, index) => ({
    rank: index + 1,
    title: p.alt || `${destination} — Pexels photo ${p.id}`,
    // Compatibility field for the existing review UI. This is rank, NOT a visual-quality score.
    score: 3 - index,
    source_query: destination,
    thumbnail_url: p.src.large2x || p.src.large || p.src.landscape || p.src.original || "",
    commons_page: p.url,
    creator: p.photographer,
    license: "Pexels",
    license_url: "https://www.pexels.com/license/",
    description: p.alt,
  }));
}

export async function GET(request: NextRequest) {
  const started = Date.now();

  try {
    const names = (request.nextUrl.searchParams.get("destinations") ?? "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);

    if (!names.length) {
      return NextResponse.json(
        {
          ok: false,
          usage: "/api/image-batch-test?destinations=Scottish%20Highlands|Mallorca|Lofoten",
          note: "Send up to 20 destination names per request. Pexels validation only.",
        },
        { status: 400 }
      );
    }

    const results: any[] = [];
    // One Pexels search per destination. Small concurrency keeps the validation quick and gentle.
    const concurrency = 4;

    for (let i = 0; i < names.length; i += concurrency) {
      const chunk = names.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (destination) => {
          try {
            const photos = await searchPexels(destination);
            const selected = selectThree(destination, photos);
            return {
              destination,
              status: selected.length >= 3 ? "GOOD_3" : selected.length > 0 ? "PARTIAL" : "NO_IMAGES",
              source: "pexels",
              query_used: destination,
              candidates_found: photos.length,
              eligible_found: photos.filter((p) => p.width > p.height).length,
              selected_images: selected,
            };
          } catch (e) {
            return {
              destination,
              status: "ERROR",
              source: "pexels",
              error: e instanceof Error ? e.message : "unknown error",
              selected_images: [],
            };
          }
        })
      );
      results.push(...chunkResults);
    }

    const counts = results.reduce((a: Record<string, number>, r) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {});

    return NextResponse.json({
      ok: true,
      diagnostic_only: true,
      image_source: "pexels",
      retrieval_version: "pexels-search-v1",
      requested: names.length,
      elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
      classification_counts: counts,
      results,
      note: "Validation only. One Pexels search per destination. No ImageKit uploads and no database writes.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Pexels batch test failed" },
      { status: 500 }
    );
  }
}
