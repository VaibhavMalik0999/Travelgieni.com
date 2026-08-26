import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DestinationInput = {
  id: string;
  name: string;
  destinationType?: string | null;
  countryCode?: string | null;
};

type PexelsPhoto = {
  id: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string | null;
  width: number;
  height: number;
  src: {
    landscape?: string;
    large?: string;
    large2x?: string;
    original?: string;
  };
};

const HARD_REJECT_TERMS = [
  "petrol station",
  "gas station",
  "fuel station",
  "classroom",
  "lecture hall",
  "office",
  "coworking",
  "meeting room",
  "conference room",
  "business meeting",
  "student",
  "students",
  "teacher",
  "woman",
  "women",
  "man",
  "men",
  "girl",
  "girls",
  "boy",
  "boys",
  "person",
  "people",
  "portrait",
  "selfie",
  "laptop",
  "computer",
  "desk",
  "shopping cart",
  "supermarket",
  "warehouse",
  "factory",
  "car dealership",
  "parking lot",
  "parking garage",
  "vehicle",
];

const TRAVEL_VISUAL_TERMS = [
  "landscape",
  "scenery",
  "scenic",
  "view",
  "panorama",
  "skyline",
  "cityscape",
  "town",
  "village",
  "street",
  "architecture",
  "historic",
  "castle",
  "ruins",
  "harbor",
  "harbour",
  "coast",
  "coastal",
  "beach",
  "sea",
  "ocean",
  "island",
  "mountain",
  "mountains",
  "valley",
  "lake",
  "river",
  "forest",
  "waterfall",
  "cliff",
  "snow",
  "fjord",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textHasAny(text: string, terms: string[]) {
  const value = text.toLowerCase();
  return terms.some((term) => {
    const pattern = escapeRegExp(term.toLowerCase()).replace(/\\ /g, "\\s+");
    return new RegExp(`(^|[^a-z])${pattern}([^a-z]|$)`, "i").test(value);
  });
}

function candidateScore(photo: PexelsPhoto) {
  const alt = (photo.alt ?? "").trim().toLowerCase();

  if (textHasAny(alt, HARD_REJECT_TERMS)) return -1000;

  let score = 0;
  if (photo.width > photo.height) score += 20;

  const ratio = photo.height > 0 ? photo.width / photo.height : 0;
  if (ratio >= 1.35 && ratio <= 2.2) score += 8;

  if (alt) score += 4;
  if (textHasAny(alt, TRAVEL_VISUAL_TERMS)) score += 18;

  return score;
}

function buildSearchQueries(destination: DestinationInput) {
  const type = (destination.destinationType ?? "").toLowerCase();
  const suffix =
    type === "park"
      ? "nature landscape"
      : type === "rural_area" || type === "mountains" || type === "lake"
      ? "scenic landscape"
      : type === "region" || type === "coast" || type === "island"
      ? "travel landscape"
      : "travel";

  return [destination.name, `${destination.name} ${suffix}`];
}

async function searchPexels(query: string, apiKey: string): Promise<PexelsPhoto[]> {
  const params = new URLSearchParams({
    query,
    orientation: "landscape",
    per_page: "30",
    page: "1",
  });

  const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
    },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Pexels ${response.status}`);
  }

  const data = await response.json();
  return (data?.photos ?? []) as PexelsPhoto[];
}

function chooseHero(photos: PexelsPhoto[]) {
  return photos
    .map((photo, index) => ({ photo, score: candidateScore(photo), index }))
    .filter(({ score }) => score >= 20)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.photo ?? null;
}

async function findHeroImage(destination: DestinationInput) {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) throw new Error("PEXELS_API_KEY is missing from Vercel.");

  const queries = buildSearchQueries(destination);
  let candidates: PexelsPhoto[] = [];
  let photo: PexelsPhoto | null = null;
  let queryUsed = queries[0];

  for (const query of queries) {
    const batch = await searchPexels(query, apiKey);
    const known = new Set(candidates.map((candidate) => candidate.id));
    candidates = [...candidates, ...batch.filter((candidate) => !known.has(candidate.id))];
    photo = chooseHero(candidates);
    queryUsed = query;

    if (photo) break;
  }

  if (!photo) return null;

  const imageUrl =
    photo.src?.large2x ??
    photo.src?.large ??
    photo.src?.landscape ??
    photo.src?.original;

  if (!imageUrl) return null;

  return {
    pexels_id: photo.id,
    image_url: imageUrl,
    photo_url: photo.url,
    photographer: photo.photographer,
    photographer_url: photo.photographer_url,
    alt: photo.alt ?? `${destination.name} travel photo`,
    selection_score: candidateScore(photo),
    query_used: queryUsed,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = Array.isArray(body?.destinations) ? body.destinations : [];

    const destinations: DestinationInput[] = raw
      .map((item: unknown) => {
        const candidate = item as Partial<DestinationInput>;
        return {
          id: String(candidate?.id ?? "").trim(),
          name: String(candidate?.name ?? "").trim(),
          destinationType: candidate?.destinationType
            ? String(candidate.destinationType).trim()
            : null,
          countryCode: candidate?.countryCode
            ? String(candidate.countryCode).trim()
            : null,
        };
      })
      .filter((item: DestinationInput) => item.id && item.name)
      .slice(0, 20);

    if (!destinations.length) {
      return NextResponse.json(
        { ok: false, error: "Send at least one destination id and name." },
        { status: 400 }
      );
    }

    const results: Array<{
      id: string;
      name: string;
      image: Awaited<ReturnType<typeof findHeroImage>>;
      error?: string;
    }> = [];

    const concurrency = 4;
    for (let i = 0; i < destinations.length; i += concurrency) {
      const chunk = destinations.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (destination) => {
          try {
            return {
              id: destination.id,
              name: destination.name,
              image: await findHeroImage(destination),
            };
          } catch (error) {
            return {
              id: destination.id,
              name: destination.name,
              image: null,
              error: error instanceof Error ? error.message : "Image lookup failed",
            };
          }
        })
      );
      results.push(...chunkResults);
    }

    return NextResponse.json({
      ok: true,
      image_source: "pexels",
      hero_images_per_destination: 1,
      selection_version: "travel-subject-filter-v1",
      requested: destinations.length,
      results,
      note:
        "Discovery-card hero images only. Rejects obvious non-travel subjects before choosing one image. No ImageKit upload and no Supabase write.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Destination image lookup failed",
      },
      { status: 500 }
    );
  }
}
