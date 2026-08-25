import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ExtField = {
  value?: string;
};

type CommonsCandidate = {
  pageId: number;
  title: string;
  originalUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  mediaType: string | null;
  descriptionUrl: string | null;
  artist: string | null;
  credit: string | null;
  licenseShortName: string | null;
  licenseUrl: string | null;
  imageDescription: string | null;
  categories: string | null;
  score: number;
  scoreReasons: string[];
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

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function queryTokens(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function includesAny(text: string, values: string[]) {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value));
}

function scoreCandidate(
  destination: string,
  candidate: Omit<CommonsCandidate, "score" | "scoreReasons">
) {
  let score = 0;
  const reasons: string[] = [];

  const title = candidate.title.toLowerCase();
  const description = (candidate.imageDescription ?? "").toLowerCase();
  const categories = (candidate.categories ?? "").toLowerCase();
  const combined = `${title} ${description} ${categories}`;
  const tokens = queryTokens(destination);

  const matchedTokens = tokens.filter((token) => combined.includes(token));
  if (tokens.length && matchedTokens.length === tokens.length) {
    score += 36;
    reasons.push("all destination terms found in Commons metadata");
  } else if (matchedTokens.length) {
    score += 18;
    reasons.push("some destination terms found in Commons metadata");
  }

  if (candidate.mediaType === "BITMAP") {
    score += 10;
    reasons.push("bitmap photograph candidate");
  }

  if (candidate.mime === "image/jpeg") {
    score += 8;
    reasons.push("JPEG photograph");
  }

  const width = candidate.width ?? 0;
  const height = candidate.height ?? 0;

  if (width >= 1200) {
    score += 8;
    reasons.push("high resolution");
  }

  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio >= 1.25 && ratio <= 2.2) {
      score += 14;
      reasons.push("landscape ratio suited to a destination card");
    } else if (ratio < 0.9) {
      score -= 10;
      reasons.push("portrait ratio penalty");
    }
  }

  if (candidate.licenseShortName && candidate.licenseUrl) {
    score += 8;
    reasons.push("license metadata present");
  }

  const negativeTerms = [
    "map", "flag", "logo", "coat of arms", "diagram", "icon", "locator",
    "route", "sign", "poster", "stamp", "portrait", "selfie", "passport",
    "ticket", "brochure"
  ];

  if (includesAny(combined, negativeTerms)) {
    score -= 30;
    reasons.push("non-destination / graphic-style metadata penalty");
  }

  const positiveTerms = [
    "view", "panorama", "landscape", "cityscape", "coast", "beach",
    "mountain", "historic", "old town", "skyline", "harbour", "harbor",
    "lake", "island"
  ];

  if (includesAny(combined, positiveTerms)) {
    score += 6;
    reasons.push("representative scenery metadata");
  }

  return { score, reasons };
}

function getMeta(
  extmetadata: Record<string, ExtField> | undefined,
  key: string
) {
  return cleanHtml(extmetadata?.[key]?.value ?? null);
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const destination =
      request.nextUrl.searchParams.get("q")?.trim() || "Mallorca";

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;

    if (!privateKey || !endpoint) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "IMAGEKIT_PRIVATE_KEY or IMAGEKIT_URL_ENDPOINT is missing from Vercel.",
        },
        { status: 500 }
      );
    }

    const commonsParams = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrsearch: destination,
      gsrnamespace: "6",
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|size|mime|mediatype|extmetadata",
      iiurlwidth: "1600",
      iiextmetadatalanguage: "en",
      iiextmetadatafilter:
        "Artist|Credit|LicenseShortName|LicenseUrl|ImageDescription|Categories",
    });

    const commonsResponse = await fetch(
      `https://commons.wikimedia.org/w/api.php?${commonsParams.toString()}`,
      {
        headers: {
          "User-Agent":
            "TravelGinniDestinationImageExperiment/1.0 (destination discovery prototype)",
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!commonsResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "wikimedia_search",
          status: commonsResponse.status,
        },
        { status: 502 }
      );
    }

    const commonsPayload = await commonsResponse.json();
    const pages = Object.values(commonsPayload?.query?.pages ?? {}) as any[];

    const candidates: CommonsCandidate[] = pages
      .flatMap((page: any): CommonsCandidate[] => {
        const info = page?.imageinfo?.[0];
        if (!info) return [];

        const base = {
          pageId: Number(page.pageid),
          title: String(page.title ?? ""),
          originalUrl: info.url ?? null,
          thumbnailUrl: info.thumburl ?? info.url ?? null,
          width: Number.isFinite(Number(info.width)) ? Number(info.width) : null,
          height: Number.isFinite(Number(info.height)) ? Number(info.height) : null,
          mime: info.mime ?? null,
          mediaType: info.mediatype ?? null,
          descriptionUrl: info.descriptionurl ?? null,
          artist: getMeta(info.extmetadata, "Artist"),
          credit: getMeta(info.extmetadata, "Credit"),
          licenseShortName: getMeta(info.extmetadata, "LicenseShortName"),
          licenseUrl: getMeta(info.extmetadata, "LicenseUrl"),
          imageDescription: getMeta(info.extmetadata, "ImageDescription"),
          categories: getMeta(info.extmetadata, "Categories"),
        };

        const scored = scoreCandidate(destination, base);

        return [
          {
            ...base,
            score: scored.score,
            scoreReasons: scored.reasons,
          },
        ];
      })
      .filter(
        (candidate) =>
          Boolean(candidate.thumbnailUrl) &&
          candidate.mediaType === "BITMAP" &&
          ["image/jpeg", "image/png", "image/webp"].includes(candidate.mime ?? "")
      )
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      return NextResponse.json(
        {
          ok: false,
          stage: "selection",
          destination,
          reason: "no_usable_commons_candidates",
        },
        { status: 404 }
      );
    }

    const selected = candidates[0];

    if (!selected.licenseShortName || !selected.licenseUrl) {
      return NextResponse.json(
        {
          ok: false,
          stage: "license_check",
          destination,
          reason: "selected_candidate_missing_license_metadata",
          selected,
          candidates,
        },
        { status: 422 }
      );
    }

    const allowedLicenseHints = [
      "cc by",
      "cc-by",
      "cc0",
      "public domain",
      "pd",
    ];

    const licenseText = `${selected.licenseShortName} ${
      selected.licenseUrl ?? ""
    }`.toLowerCase();

    if (!allowedLicenseHints.some((hint) => licenseText.includes(hint))) {
      return NextResponse.json(
        {
          ok: false,
          stage: "license_check",
          destination,
          reason: "license_not_in_v1_allowlist",
          selected,
          candidates,
        },
        { status: 422 }
      );
    }

    const extension =
      selected.mime === "image/png"
        ? "png"
        : selected.mime === "image/webp"
        ? "webp"
        : "jpg";

    const fileName = `${
      slugify(destination) || "destination"
    }-${selected.pageId}.${extension}`;

    const form = new FormData();
    form.append("file", selected.thumbnailUrl!);
    form.append("fileName", fileName);
    form.append("folder", "/travelginni-test");
    form.append("useUniqueFileName", "false");
    form.append("overwriteFile", "true");
    form.append("tags", "travelginni-test,wikimedia-commons,destination-image");

    const auth = Buffer.from(`${privateKey}:`).toString("base64");

    const uploadResponse = await fetch(
      "https://upload.imagekit.io/api/v1/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
        body: form,
        cache: "no-store",
      }
    );

    const uploadPayload = await uploadResponse.json();

    if (!uploadResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "imagekit_upload",
          destination,
          status: uploadResponse.status,
          selected,
          imagekit_error: uploadPayload,
        },
        { status: 502 }
      );
    }

    const publicUrl =
      uploadPayload?.url ??
      `${endpoint.replace(/\/$/, "")}/travelginni-test/${fileName}`;

    return NextResponse.json({
      ok: true,
      diagnostic_only: true,
      destination,
      elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      candidate_count: candidates.length,
      selected: {
        commons_page_id: selected.pageId,
        commons_file_title: selected.title,
        selection_score: selected.score,
        score_reasons: selected.scoreReasons,
        width: selected.width,
        height: selected.height,
        commons_thumbnail_url: selected.thumbnailUrl,
        commons_original_url: selected.originalUrl,
        commons_description_page: selected.descriptionUrl,
        creator: selected.artist,
        credit: selected.credit,
        license: selected.licenseShortName,
        license_url: selected.licenseUrl,
        image_description: selected.imageDescription,
      },
      imagekit: {
        file_id: uploadPayload?.fileId ?? null,
        file_name: uploadPayload?.name ?? fileName,
        file_path: uploadPayload?.filePath ?? null,
        url: publicUrl,
        width: uploadPayload?.width ?? null,
        height: uploadPayload?.height ?? null,
        size_bytes: uploadPayload?.size ?? null,
      },
      top_candidates: candidates.slice(0, 5).map((candidate) => ({
        title: candidate.title,
        score: candidate.score,
        dimensions: `${candidate.width ?? "?"}x${candidate.height ?? "?"}`,
        license: candidate.licenseShortName,
        thumbnail_url: candidate.thumbnailUrl,
        description_page: candidate.descriptionUrl,
        score_reasons: candidate.scoreReasons,
      })),
      attribution_required: {
        creator: selected.artist,
        license: selected.licenseShortName,
        license_url: selected.licenseUrl,
        source_page: selected.descriptionUrl,
      },
      note:
        "Diagnostic selection/upload test only. Review visual accuracy before using this image in the production destination catalog.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Image test failed.",
      },
      { status: 500 }
    );
  }
}
