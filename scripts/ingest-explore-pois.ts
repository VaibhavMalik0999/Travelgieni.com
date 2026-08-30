import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { INTENTS, type IntentKey } from "../src/lib/intents.ts";

const VALID_INTENTS = new Set<IntentKey>(INTENTS.map(({ key }) => key));
const DEFAULT_BATCH_SIZE = 250;

type CsvRow = Record<string, string>;
type IntentScores = Partial<Record<IntentKey, number>>;
export type CategoryIntentMap = Record<string, IntentScores>;

type PreparedPoi = {
  poi_id: string;
  overture_poi_id: string;
  name: string;
  canonical_category: string;
  latitude: number;
  longitude: number;
  website_url: string | null;
  source_url: string | null;
  source_metadata: Record<string, unknown>;
};

type PreparedDestinationPoi = {
  traveller_destination_id: string;
  poi_id: string;
  is_valid_for_destination: boolean;
  destination_significance: number;
};

type PreparedPoiIntent = {
  poi_id: string;
  intent_key: IntentKey;
  structured_relevance: number;
  semantic_relevance: number | null;
};

export type PreparedIngestion = {
  inputRows: number;
  validRows: number;
  skippedRows: number;
  issues: string[];
  pois: PreparedPoi[];
  destinationPois: PreparedDestinationPoi[];
  poiIntents: PreparedPoiIntent[];
};

export function parseCsv(input: string): CsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  if (!records.length) return [];

  const headers = records[0].map((value) => value.trim());
  if (headers.some((header) => !header)) throw new Error("CSV contains an empty header.");
  return records.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]))
  );
}

function normalizeCategory(value: string) {
  return value.trim().toLowerCase();
}

function parseJsonOrText(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstUrl(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/https?:\/\/[^\s,;"']+/i);
    return match?.[0] ?? null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = firstUrl(item);
      if (found) return found;
    }
  }
  return null;
}

function parseBoolean(value: string): boolean | null {
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function parseUnitScore(value: string): number | null {
  if (!value) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 1 ? score : null;
}

function parseSemanticScores(value: string, issues: string[], rowNumber: number): IntentScores | null {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    issues.push(`row ${rowNumber}: semantic_relevance must be a JSON object`);
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    issues.push(`row ${rowNumber}: semantic_relevance must be a JSON object`);
    return null;
  }
  const result: IntentScores = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (!VALID_INTENTS.has(key as IntentKey)) {
      issues.push(`row ${rowNumber}: invalid semantic intent key ${key}`);
      return null;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      issues.push(`row ${rowNumber}: semantic score for ${key} must be between 0 and 1`);
      return null;
    }
    result[key as IntentKey] = raw;
  }
  return result;
}

export function validateCategoryIntentMap(value: unknown): CategoryIntentMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Category-to-intent mapping must be a JSON object.");
  }
  const result: CategoryIntentMap = {};
  for (const [category, rawScores] of Object.entries(value)) {
    if (!rawScores || typeof rawScores !== "object" || Array.isArray(rawScores)) {
      throw new Error(`Mapping for ${category} must be an object.`);
    }
    const scores: IntentScores = {};
    for (const [key, raw] of Object.entries(rawScores)) {
      if (!VALID_INTENTS.has(key as IntentKey)) throw new Error(`Invalid intent key in mapping: ${key}`);
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
        throw new Error(`Mapping score for ${category}/${key} must be between 0 and 1.`);
      }
      scores[key as IntentKey] = raw;
    }
    result[normalizeCategory(category)] = scores;
  }
  return result;
}

export function prepareIngestion(rows: CsvRow[], mapping: CategoryIntentMap): PreparedIngestion {
  const issues: string[] = [];
  const pois = new Map<string, PreparedPoi>();
  const destinationPois = new Map<string, PreparedDestinationPoi>();
  const poiIntents = new Map<string, PreparedPoiIntent>();
  let validRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowIssues: string[] = [];
    const destinationId = row.canonical_destination_id?.trim();
    const overtureId = row.overture_poi_id?.trim();
    const name = row.poi_name?.trim();
    const category = (row.taxonomy_primary || row.basic_category || "").trim();
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const validity = parseBoolean(row.is_valid_for_destination ?? "");
    const significance = parseUnitScore(row.destination_significance ?? "");
    const confidence = parseUnitScore(row.overture_confidence ?? "");
    const semanticScores = parseSemanticScores(row.semantic_relevance ?? "", rowIssues, rowNumber);
    const structuredScores =
      mapping[normalizeCategory(row.taxonomy_primary ?? "")] ??
      mapping[normalizeCategory(row.basic_category ?? "")];
    const hasStructuredScores = Boolean(structuredScores && Object.keys(structuredScores).length);
    const hasSemanticScores = Boolean(semanticScores && Object.keys(semanticScores).length);

    if (!destinationId) rowIssues.push(`row ${rowNumber}: canonical_destination_id is required`);
    if (!overtureId) rowIssues.push(`row ${rowNumber}: overture_poi_id is required`);
    if (!name) rowIssues.push(`row ${rowNumber}: poi_name is required`);
    if (!category) rowIssues.push(`row ${rowNumber}: taxonomy_primary or basic_category is required`);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) rowIssues.push(`row ${rowNumber}: latitude is invalid`);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) rowIssues.push(`row ${rowNumber}: longitude is invalid`);
    if (validity === null) rowIssues.push(`row ${rowNumber}: is_valid_for_destination is required and must be boolean`);
    if (significance === null) rowIssues.push(`row ${rowNumber}: destination_significance is required and must be between 0 and 1`);
    if (row.overture_confidence && confidence === null) rowIssues.push(`row ${rowNumber}: overture_confidence must be between 0 and 1`);
    if (!hasStructuredScores && !hasSemanticScores) rowIssues.push(`row ${rowNumber}: no existing category-to-intent mapping for ${category || "category"}`);

    if (rowIssues.length || !destinationId || !overtureId || !name || !category || validity === null || significance === null || !semanticScores) {
      issues.push(...rowIssues);
      return;
    }

    validRows++;
    const websites = parseJsonOrText(row.websites ?? "");
    const socials = parseJsonOrText(row.socials ?? "");
    const addresses = parseJsonOrText(row.addresses ?? "");
    const existing = pois.get(overtureId);
    const candidate: PreparedPoi = {
      poi_id: overtureId,
      overture_poi_id: overtureId,
      name,
      canonical_category: category,
      latitude,
      longitude,
      website_url: firstUrl(websites),
      source_url: null,
      source_metadata: {
        canonical_name: row.canonical_name || null,
        basic_category: row.basic_category || null,
        taxonomy_primary: row.taxonomy_primary || null,
        overture_confidence: confidence,
        websites,
        socials,
        addresses,
        distance_km: row.distance_km ? Number(row.distance_km) : null,
      },
    };
    // The highest-confidence duplicate is the deterministic canonical POI record.
    const existingConfidence = Number(existing?.source_metadata.overture_confidence ?? -1);
    if (!existing || (confidence ?? -1) > existingConfidence) pois.set(overtureId, candidate);

    destinationPois.set(`${destinationId}\u0000${overtureId}`, {
      traveller_destination_id: destinationId,
      poi_id: overtureId,
      is_valid_for_destination: validity,
      destination_significance: significance,
    });
    const mappedIntents = new Set([
      ...Object.keys(structuredScores ?? {}),
      ...Object.keys(semanticScores),
    ] as IntentKey[]);
    for (const intent of mappedIntents) {
      poiIntents.set(`${overtureId}\u0000${intent}`, {
        poi_id: overtureId,
        intent_key: intent,
        // The schema requires a structured value; zero explicitly represents
        // no structured match when an offline semantic rescue exists alone.
        structured_relevance: structuredScores?.[intent] ?? 0,
        semantic_relevance: semanticScores[intent] ?? null,
      });
    }
  });

  return {
    inputRows: rows.length,
    validRows,
    skippedRows: rows.length - validRows,
    issues,
    pois: [...pois.values()],
    destinationPois: [...destinationPois.values()],
    poiIntents: [...poiIntents.values()],
  };
}

type SupabaseConfig = { url: string; key: string; batchSize: number };

async function request(config: SupabaseConfig, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function inFilter(values: string[]) {
  return `in.(${values.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",")})`;
}

async function existingKeys(
  config: SupabaseConfig,
  table: string,
  select: string,
  filterColumn: string,
  values: string[],
  keyFor: (row: Record<string, string>) => string
) {
  const found = new Set<string>();
  for (const batch of chunks([...new Set(values)], 100)) {
    const params = new URLSearchParams({ select, [filterColumn]: inFilter(batch) });
    const response = await request(config, `${table}?${params}`);
    const rows = (await response.json()) as Record<string, string>[];
    rows.forEach((row) => found.add(keyFor(row)));
  }
  return found;
}

async function upsert(config: SupabaseConfig, table: string, conflict: string, rows: unknown[]) {
  for (const batch of chunks(rows, config.batchSize)) {
    await request(config, `${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
  }
}

export async function ingestPrepared(config: SupabaseConfig, prepared: PreparedIngestion) {
  const poiExisting = await existingKeys(config, "tg_explore_pois", "overture_poi_id", "overture_poi_id", prepared.pois.map((row) => row.overture_poi_id), (row) => row.overture_poi_id);
  const destinationExisting = await existingKeys(config, "tg_explore_destination_pois", "traveller_destination_id,poi_id", "poi_id", prepared.destinationPois.map((row) => row.poi_id), (row) => `${row.traveller_destination_id}\u0000${row.poi_id}`);
  const intentExisting = await existingKeys(config, "tg_explore_poi_intents", "poi_id,intent_key", "poi_id", prepared.poiIntents.map((row) => row.poi_id), (row) => `${row.poi_id}\u0000${row.intent_key}`);

  await upsert(config, "tg_explore_pois", "overture_poi_id", prepared.pois);
  await upsert(config, "tg_explore_destination_pois", "traveller_destination_id,poi_id", prepared.destinationPois);
  await upsert(config, "tg_explore_poi_intents", "poi_id,intent_key", prepared.poiIntents);

  const counts = (rows: unknown[], keys: string[], existing: Set<string>) => ({
    inserted: keys.filter((key) => !existing.has(key)).length,
    updated: rows.length - keys.filter((key) => !existing.has(key)).length,
  });
  return {
    skipped: prepared.skippedRows,
    pois: counts(prepared.pois, prepared.pois.map((row) => row.overture_poi_id), poiExisting),
    destination_pois: counts(prepared.destinationPois, prepared.destinationPois.map((row) => `${row.traveller_destination_id}\u0000${row.poi_id}`), destinationExisting),
    poi_intents: counts(prepared.poiIntents, prepared.poiIntents.map((row) => `${row.poi_id}\u0000${row.intent_key}`), intentExisting),
  };
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const csvPath = argument("--csv");
  const mappingPath = argument("--category-intent-map");
  const dryRun = process.argv.includes("--dry-run");
  if (!csvPath || !mappingPath) {
    throw new Error("Usage: --csv <file.csv> --category-intent-map <mapping.json> [--dry-run] [--batch-size 250]");
  }
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const mapping = validateCategoryIntentMap(JSON.parse(await readFile(mappingPath, "utf8")));
  const prepared = prepareIngestion(rows, mapping);
  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "ingest",
    input_rows: prepared.inputRows,
    valid_rows: prepared.validRows,
    skipped_rows: prepared.skippedRows,
    unique_pois: prepared.pois.length,
    destination_relationships: prepared.destinationPois.length,
    intent_mappings: prepared.poiIntents.length,
    validation_issues: prepared.issues,
  }, null, 2));
  if (dryRun) return;
  if (prepared.issues.length) throw new Error("Validation failed. Fix all reported issues or use a clean input file before ingestion.");

  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for ingestion.");
  const requestedBatchSize = Number(argument("--batch-size") ?? DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > 1000) {
    throw new Error("--batch-size must be an integer between 1 and 1000.");
  }
  const result = await ingestPrepared({ url, key, batchSize: requestedBatchSize }, prepared);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
