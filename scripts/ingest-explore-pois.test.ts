import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, prepareIngestion, validateCategoryIntentMap } from "./ingest-explore-pois.ts";

const mapping = validateCategoryIntentMap({
  museum: { culture_history: 0.9, arts_entertainment: 0.7 },
});

test("CSV parsing supports quoted provider metadata", () => {
  const rows = parseCsv('canonical_destination_id,poi_name,websites\nabc,"Named, POI","[""https://example.com""]"\n');
  assert.equal(rows[0].poi_name, "Named, POI");
  assert.equal(rows[0].websites, '["https://example.com"]');
});

test("preparation deduplicates Overture POIs and leaves absent semantic scores null", () => {
  const csv = `canonical_destination_id,canonical_name,overture_poi_id,poi_name,longitude,latitude,basic_category,taxonomy_primary,overture_confidence,websites,socials,addresses,distance_km,is_valid_for_destination,destination_significance,semantic_relevance
destination-1,Destination,overture-1,Named POI,13.4,52.5,museum,museum,0.9,https://example.com,,,2.5,true,0.8,
destination-2,Destination Two,overture-1,Named POI,13.4,52.5,museum,museum,0.8,,,,3.5,true,0.7,
`;
  const prepared = prepareIngestion(parseCsv(csv), mapping);
  assert.equal(prepared.skippedRows, 0);
  assert.equal(prepared.pois.length, 1);
  assert.equal(prepared.destinationPois.length, 2);
  assert.equal(prepared.poiIntents.length, 2);
  assert.ok(prepared.poiIntents.every(({ semantic_relevance }) => semantic_relevance === null));
});

test("semantic-only rescue is retained without fabricating structured relevance", () => {
  const csv = `canonical_destination_id,overture_poi_id,poi_name,longitude,latitude,basic_category,is_valid_for_destination,destination_significance,semantic_relevance
destination-1,overture-1,Named POI,13.4,52.5,government_office,true,0.8,"{""culture_history"":0.75}"
`;
  const prepared = prepareIngestion(parseCsv(csv), mapping);
  assert.equal(prepared.validRows, 1);
  assert.equal(prepared.skippedRows, 0);
  assert.deepEqual(prepared.issues, []);
  assert.deepEqual(prepared.poiIntents, [{
    poi_id: "overture-1",
    intent_key: "culture_history",
    structured_relevance: 0,
    semantic_relevance: 0.75,
  }]);
});

test("preparation rejects an unmapped category without semantic relevance", () => {
  const csv = `canonical_destination_id,overture_poi_id,poi_name,longitude,latitude,basic_category,is_valid_for_destination,destination_significance,semantic_relevance
destination-1,overture-1,Named POI,13.4,52.5,government_office,true,0.8,
`;
  const prepared = prepareIngestion(parseCsv(csv), mapping);
  assert.equal(prepared.validRows, 0);
  assert.equal(prepared.skippedRows, 1);
  assert.deepEqual(prepared.issues, [
    "row 2: no existing category-to-intent mapping for government_office",
  ]);
});

test("preparation rejects invalid coordinates, scores, intent keys, and required fields", () => {
  const badMapping = () => validateCategoryIntentMap({ museum: { made_up_intent: 0.5 } });
  assert.throws(badMapping, /Invalid intent key/);

  const csv = `canonical_destination_id,overture_poi_id,poi_name,longitude,latitude,basic_category,is_valid_for_destination,destination_significance,semantic_relevance
,overture-1,,181,91,museum,maybe,1.2,"{""fake_intent"":0.5}"
`;
  const prepared = prepareIngestion(parseCsv(csv), mapping);
  assert.equal(prepared.validRows, 0);
  assert.equal(prepared.skippedRows, 1);
  assert.ok(prepared.issues.length >= 7);
});
