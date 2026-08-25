import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ExtField = { value?: string };

type Candidate = {
  pageId: number;
  title: string;
  thumbnailUrl: string;
  descriptionUrl: string | null;
  width: number;
  height: number;
  mime: string | null;
  mediaType: string | null;
  artist: string | null;
  license: string | null;
  licenseUrl: string | null;
  description: string | null;
  categories: string | null;
  score: number;
  sourceQuery: string;
};

function cleanHtml(value?: string | null) {
  if (!value) return null;
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(ext: Record<string, ExtField> | undefined, key: string) {
  return cleanHtml(ext?.[key]?.value ?? null);
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function includesAny(text: string, words: string[]) {
  const x = text.toLowerCase();
  return words.some((w) => x.includes(w));
}

function allowedLicense(c: Candidate) {
  if (!c.license || !c.licenseUrl) return false;
  const x = `${c.license} ${c.licenseUrl}`.toLowerCase();

  return [
    "cc by",
    "cc-by",
    "cc0",
    "public domain",
    "creativecommons.org/licenses/by/",
    "creativecommons.org/licenses/by-sa/",
    "creativecommons.org/publicdomain/",
  ].some((v) => x.includes(v));
}

function destinationQuerySet(destination: string) {
  return [
    `${destination} landscape`,
    `${destination} scenic`,
    `${destination} panoramic`,
    `${destination} travel`,
    `${destination} view`,
  ];
}

function score(destination: string, c: Omit<Candidate, "score">) {
  let s = 0;

  const text = `${c.title} ${c.description ?? ""} ${c.categories ?? ""}`.toLowerCase();
  const q = tokens(destination);
  const hits = q.filter((t) => text.includes(t)).length;

  if (q.length && hits === q.length) s += 30;
  else if (hits) s += 14;

  if (c.mediaType === "BITMAP") s += 8;
  if (c.mime === "image/jpeg") s += 7;
  if (c.width >= 1200) s += 7;

  if (c.width && c.height) {
    const ratio = c.width / c.height;
    if (ratio >= 1.3 && ratio <= 2.15) s += 16;
    else if (ratio >= 1.15 && ratio <= 2.4) s += 8;
    else if (ratio < 0.95) s -= 12;
  }

  if (c.license && c.licenseUrl) s += 6;

  const strongTravelTerms = [
    "landscape","panorama","panoramic","scenic","view","skyline","cityscape",
    "old town","historic centre","historic center","coast","coastal","beach",
    "sea","mountain","mountains","valley","lake","river","fjord","village",
    "harbour","harbor","island","forest","waterfall","cliff","sunrise","sunset"
  ];

  if (includesAny(text, strongTravelTerms)) s += 14;

  const hardNegativeTerms = [
    "map","locator","flag","logo","coat of arms","diagram","icon","poster","stamp",
    "passport","ticket","brochure","sign","screenshot","document","plan","route map"
  ];

  if (includesAny(text, hardNegativeTerms)) s -= 55;

  const weakTravelTerms = [
    "station","platform","corridor","interior","shop","store","parking","car park",
    "construction","football","match","train","railway","airport"
  ];

  if (includesAny(text, weakTravelTerms)) s -= 24;

  if (c.sourceQuery.endsWith(" landscape")) s += 10;
  else if (c.sourceQuery.endsWith(" scenic")) s += 8;
  else if (c.sourceQuery.endsWith(" panoramic")) s += 7;
  else if (c.sourceQuery.endsWith(" view")) s += 4;
  else if (c.sourceQuery.endsWith(" travel")) s += 2;

  return s;
}

async function searchCommons(query: string, destination: string): Promise<Candidate[]> {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|size|mime|mediatype|extmetadata",
    iiurlwidth: "1280",
    iiextmetadatalanguage: "en",
    iiextmetadatafilter:
      "Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories",
  });

  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${p.toString()}`, {
    headers: {
      "User-Agent": "TravelGinniDestinationImageRetrievalV2/1.0",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!r.ok) throw new Error(`Commons ${r.status}`);

  const data = await r.json();
  const pages = Object.values(data?.query?.pages ?? {}) as any[];

  return pages.flatMap((page: any): Candidate[] => {
    const i = page?.imageinfo?.[0];
    if (!i?.thumburl) return [];

    const base = {
      pageId: Number(page.pageid),
      title: String(page.title ?? ""),
      thumbnailUrl: i.thumburl as string,
      descriptionUrl: i.descriptionurl ?? null,
      width: Number(i.width ?? 0),
      height: Number(i.height ?? 0),
      mime: i.mime ?? null,
      mediaType: i.mediatype ?? null,
      artist: meta(i.extmetadata, "Artist"),
      license: meta(i.extmetadata, "LicenseShortName"),
      licenseUrl: meta(i.extmetadata, "LicenseUrl"),
      description: meta(i.extmetadata, "ImageDescription"),
      categories: meta(i.extmetadata, "Categories"),
      sourceQuery: query,
    };

    const candidate: Candidate = {
      ...base,
      score: score(destination, base),
    };

    if (candidate.mediaType !== "BITMAP") return [];
    if (!["image/jpeg", "image/png", "image/webp"].includes(candidate.mime ?? "")) return [];

    return [candidate];
  });
}

function normalizedWords(c: Candidate) {
  return new Set(tokens(`${c.title} ${c.description ?? ""}`));
}

function nearDuplicate(a: Candidate, b: Candidate) {
  const aw = normalizedWords(a);
  const bw = normalizedWords(b);
  const intersection = [...aw].filter((w) => bw.has(w)).length;
  const union = new Set([...aw, ...bw]).size || 1;
  return intersection / union >= 0.65;
}

async function getCandidates(destination: string) {
  const querySet = destinationQuerySet(destination);

  const groups = await Promise.all(
    querySet.map((query) => searchCommons(query, destination))
  );

  const byId = new Map<number, Candidate>();
  for (const candidate of groups.flat()) {
    const existing = byId.get(candidate.pageId);
    if (!existing || candidate.score > existing.score) {
      byId.set(candidate.pageId, candidate);
    }
  }

  return {
    querySet,
    candidates: [...byId.values()].sort((a, b) => b.score - a.score),
  };
}

function selectThree(candidates: Candidate[]) {
  const eligible = candidates.filter(allowedLicense);
  const selected: Candidate[] = [];
  const minimumUsableScore = 45;

  for (const c of eligible) {
    if (c.score < minimumUsableScore) continue;

    if (!selected.some((s) => nearDuplicate(s, c))) {
      selected.push(c);
    }

    if (selected.length === 3) break;
  }

  for (const c of eligible) {
    if (selected.length === 3) break;
    if (c.score < minimumUsableScore) continue;
    if (!selected.some((s) => s.pageId === c.pageId)) selected.push(c);
  }

  return { eligible, selected };
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
          usage:
            "/api/image-batch-test?destinations=Scottish%20Highlands|Mallorca|Lofoten",
          note: "Send up to 20 destination names per request. Validation only.",
        },
        { status: 400 }
      );
    }

    const results: any[] = [];
    const concurrency = 4;

    for (let i = 0; i < names.length; i += concurrency) {
      const chunk = names.slice(i, i + concurrency);

      const chunkResults = await Promise.all(
        chunk.map(async (destination) => {
          try {
            const { querySet, candidates } = await getCandidates(destination);
            const { eligible, selected } = selectThree(candidates);

            return {
              destination,
              status:
                selected.length >= 3
                  ? "GOOD_3"
                  : selected.length > 0
                  ? "PARTIAL"
                  : "NO_ELIGIBLE_IMAGES",
              queries_used: querySet,
              candidates_found: candidates.length,
              eligible_found: eligible.length,
              selected_images: selected.map((c, index) => ({
                rank: index + 1,
                title: c.title,
                score: c.score,
                source_query: c.sourceQuery,
                thumbnail_url: c.thumbnailUrl,
                commons_page: c.descriptionUrl,
                creator: c.artist,
                license: c.license,
                license_url: c.licenseUrl,
                description: c.description,
              })),
              top_10_candidates: candidates.slice(0, 10).map((c) => ({
                title: c.title,
                score: c.score,
                source_query: c.sourceQuery,
                license_eligible: allowedLicense(c),
                thumbnail_url: c.thumbnailUrl,
                description: c.description,
              })),
            };
          } catch (e) {
            return {
              destination,
              status: "ERROR",
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
      retrieval_version: "travel-oriented-multi-query-v2",
      requested: names.length,
      elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
      classification_counts: counts,
      results,
      note:
        "No ImageKit uploads and no database writes. This version retrieves from multiple visual/travel-oriented Commons queries before ranking.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "batch test failed",
      },
      { status: 500 }
    );
  }
}
