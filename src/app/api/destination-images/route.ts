import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DestinationInput = {
  id: string;
  name: string;
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

async function findHeroImage(destination: DestinationInput) {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) throw new Error("PEXELS_API_KEY is missing from Vercel.");

  const params = new URLSearchParams({
    query: destination.name,
    orientation: "landscape",
    per_page: "15",
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
  const photos = (data?.photos ?? []) as PexelsPhoto[];
  const photo = photos.find((candidate) => candidate.width > candidate.height) ?? photos[0];

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

    const concurrency = 5;
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
      requested: destinations.length,
      results,
      note: "Discovery-card hero images only. No ImageKit upload and no Supabase write.",
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
