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
};

function cleanHtml(value?: string | null) {
  if (!value) return null;
  return value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function meta(ext: Record<string, ExtField> | undefined, key: string) {
  return cleanHtml(ext?.[key]?.value ?? null);
}

function tokens(s: string) {
  return s.toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter(t => t.length >= 3);
}

function allowedLicense(c: Candidate) {
  if (!c.license || !c.licenseUrl) return false;
  const x = `${c.license} ${c.licenseUrl}`.toLowerCase();
  return [
    "cc by", "cc-by", "cc0", "public domain",
    "creativecommons.org/licenses/by/",
    "creativecommons.org/licenses/by-sa/",
    "creativecommons.org/publicdomain/"
  ].some(v => x.includes(v));
}

function score(destination: string, c: Omit<Candidate, "score">) {
  let s = 0;
  const text = `${c.title} ${c.description ?? ""} ${c.categories ?? ""}`.toLowerCase();
  const q = tokens(destination);
  const hits = q.filter(t => text.includes(t)).length;
  if (q.length && hits === q.length) s += 36;
  else if (hits) s += 18;
  if (c.mediaType === "BITMAP") s += 10;
  if (c.mime === "image/jpeg") s += 8;
  if (c.width >= 1200) s += 8;
  if (c.width && c.height) {
    const r = c.width / c.height;
    if (r >= 1.25 && r <= 2.2) s += 14;
    else if (r < 0.9) s -= 10;
  }
  if (c.license && c.licenseUrl) s += 8;
  const negative = ["map","flag","logo","coat of arms","diagram","icon","locator",
    "route","sign","poster","stamp","portrait","selfie","passport","ticket","brochure"];
  if (negative.some(v => text.includes(v))) s -= 30;
  const positive = ["view","panorama","landscape","cityscape","coast","beach",
    "mountain","historic","old town","skyline","harbour","harbor","lake","island"];
  if (positive.some(v => text.includes(v))) s += 6;
  return s;
}

async function getCandidates(destination: string): Promise<Candidate[]> {
  const p = new URLSearchParams({
    action: "query", format: "json", origin: "*",
    generator: "search", gsrsearch: destination, gsrnamespace: "6", gsrlimit: "12",
    prop: "imageinfo", iiprop: "url|size|mime|mediatype|extmetadata",
    iiurlwidth: "1200", iiextmetadatalanguage: "en",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories"
  });

  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${p}`, {
    headers: {
      "User-Agent": "TravelGinniDestinationImageBatchExperiment/1.0",
      Accept: "application/json"
    },
    cache: "no-store"
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
      categories: meta(i.extmetadata, "Categories")
    };
    const candidate: Candidate = { ...base, score: score(destination, base) };
    if (candidate.mediaType !== "BITMAP") return [];
    if (!["image/jpeg","image/png","image/webp"].includes(candidate.mime ?? "")) return [];
    return [candidate];
  }).sort((a,b) => b.score - a.score);
}

function normalizedWords(c: Candidate) {
  return new Set(tokens(`${c.title} ${c.description ?? ""}`));
}

// Cheap diversity guard: avoid selecting three near-identical filenames/descriptions.
// This is intentionally simple; the 100-destination test tells us whether it is enough.
function selectThree(candidates: Candidate[]) {
  const eligible = candidates.filter(allowedLicense);
  const selected: Candidate[] = [];

  for (const c of eligible) {
    if (!selected.length) {
      selected.push(c);
      continue;
    }
    const cw = normalizedWords(c);
    const tooSimilar = selected.some(s => {
      const sw = normalizedWords(s);
      const intersection = [...cw].filter(w => sw.has(w)).length;
      const union = new Set([...cw, ...sw]).size || 1;
      return intersection / union >= 0.72;
    });
    if (!tooSimilar) selected.push(c);
    if (selected.length === 3) break;
  }

  // If diversity filtering leaves <3, fill from remaining eligible candidates.
  for (const c of eligible) {
    if (selected.length === 3) break;
    if (!selected.some(s => s.pageId === c.pageId)) selected.push(c);
  }
  return { eligible, selected };
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const names = (request.nextUrl.searchParams.get("destinations") ?? "")
      .split("|").map(x => x.trim()).filter(Boolean).slice(0, 20);

    if (!names.length) {
      return NextResponse.json({
        ok: false,
        usage: "/api/image-batch-test?destinations=Mallorca|Lofoten|Prague",
        note: "Send up to 20 destination names per request. Run five batches for 100 destinations."
      }, { status: 400 });
    }

    // Small concurrency to be respectful to Commons and avoid Vercel timeouts.
    const results: any[] = [];
    const concurrency = 4;
    for (let i = 0; i < names.length; i += concurrency) {
      const chunk = names.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map(async destination => {
        try {
          const candidates = await getCandidates(destination);
          const { eligible, selected } = selectThree(candidates);
          return {
            destination,
            status: selected.length >= 3 ? "GOOD_3" :
                    selected.length > 0 ? "PARTIAL" : "NO_ELIGIBLE_IMAGES",
            candidates_found: candidates.length,
            eligible_found: eligible.length,
            selected_images: selected.map((c, index) => ({
              rank: index + 1,
              title: c.title,
              score: c.score,
              thumbnail_url: c.thumbnailUrl,
              commons_page: c.descriptionUrl,
              creator: c.artist,
              license: c.license,
              license_url: c.licenseUrl,
              description: c.description
            }))
          };
        } catch (e) {
          return {
            destination,
            status: "ERROR",
            error: e instanceof Error ? e.message : "unknown error",
            selected_images: []
          };
        }
      }));
      results.push(...chunkResults);
    }

    const counts = results.reduce((a: Record<string,number>, r) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {});

    return NextResponse.json({
      ok: true,
      diagnostic_only: true,
      requested: names.length,
      elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
      classification_counts: counts,
      results,
      note: "No ImageKit uploads and no database writes. Review the three-image sets visually before production use."
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "batch test failed"
    }, { status: 500 });
  }
}
