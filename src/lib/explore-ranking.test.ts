import assert from "node:assert/strict";
import test from "node:test";
import type { IntentKey } from "./intents.ts";
import type { ExplorePoiCandidate, ExplorePreferences } from "./explore-types.ts";
import {
  fuseRelevance,
  geometricUtility,
  noisyOr,
  rankExplorePois,
} from "./explore-ranking.ts";

const DESTINATION = "destination-1";

function preferences(...intents: IntentKey[]): ExplorePreferences {
  return Object.fromEntries(
    intents.map((intent) => [
      intent,
      { target: 100, importance: 1, match_type: "minimum" as const },
    ])
  );
}

function poi(
  id: string,
  category: string,
  relevance: Partial<Record<IntentKey, number>>,
  overrides: Partial<ExplorePoiCandidate> = {}
): ExplorePoiCandidate {
  return {
    poi_id: id,
    traveller_destination_id: DESTINATION,
    poi_name: `POI ${id}`,
    category,
    latitude: 50,
    longitude: 10,
    is_valid_for_destination: true,
    destination_significance: 0.8,
    intent_relevance: relevance,
    ...overrides,
  };
}

test("noisy-OR and semantic rescue use the locked fusion formula", () => {
  assert.ok(Math.abs(noisyOr([0.5, 0.4]) - 0.7) < 1e-12);
  assert.ok(Math.abs(fuseRelevance(0.4, 0.5) - 0.655) < 1e-12);
  assert.equal(fuseRelevance(1, 1), 1);
});

test("validity and destination identity are hard gates", () => {
  const result = rankExplorePois(
    DESTINATION,
    [
      poi("valid", "museum", { culture_history: 0.5 }),
      poi("invalid", "museum", { culture_history: 1 }, { is_valid_for_destination: false }),
      poi("wrong-destination", "museum", { culture_history: 1 }, { traveller_destination_id: "other" }),
    ],
    preferences("culture_history")
  );
  assert.deepEqual(result.top_picks.map(({ poi_id }) => poi_id), ["valid"]);
  assert.equal(result.top_picks[0].ranking.validity, 1);
});

test("individual utility is the required weighted geometric utility", () => {
  const expected = Math.pow(0.64, 0.65) * Math.pow(0.81, 0.35);
  assert.ok(Math.abs(geometricUtility(true, 0.64, 0.81) - expected) < 1e-12);
  assert.equal(geometricUtility(false, 1, 1), 0);
});

test("coverage reward selects a different requested intent", () => {
  const result = rankExplorePois(
    DESTINATION,
    [
      poi("culture-best", "museum", { culture_history: 0.95 }),
      poi("culture-second", "landmark", { culture_history: 0.9 }),
      poi("nature", "park", { nature_scenery: 0.72 }),
    ],
    preferences("culture_history", "nature_scenery"),
    { limit: 2, coverageWeight: 1, redundancyWeight: 0 }
  );
  assert.deepEqual(result.top_picks.map(({ poi_id }) => poi_id), ["culture-best", "nature"]);
  assert.ok(result.top_picks[1].ranking.coverage_reward > 0);
});

test("redundancy penalizes repeated categories and similar profiles", () => {
  const result = rankExplorePois(
    DESTINATION,
    [
      poi("museum-best", "museum", { culture_history: 0.95 }),
      poi("museum-repeat", "museum", { culture_history: 0.93 }),
      poi("gallery", "gallery", { culture_history: 0.82, arts_entertainment: 0.5 }),
    ],
    preferences("culture_history", "arts_entertainment"),
    { limit: 2, coverageWeight: 0, redundancyWeight: 0.5 }
  );
  assert.deepEqual(result.top_picks.map(({ poi_id }) => poi_id), ["museum-best", "gallery"]);
  assert.ok(result.top_picks[1].ranking.redundancy_penalty > 0);
});

test("the same algorithm handles unrelated city and nature intent mixes", () => {
  const candidates = [
    poi("club", "nightclub", { clubbing_nightlife: 0.9 }),
    poi("museum", "museum", { culture_history: 0.9 }),
    poi("trail", "trail", { hiking_outdoors: 0.9 }),
    poi("spa", "spa", { wellness: 0.9 }),
  ];

  const city = rankExplorePois(
    DESTINATION,
    candidates,
    preferences("culture_history", "clubbing_nightlife"),
    { limit: 2, coverageWeight: 1 }
  );
  const nature = rankExplorePois(
    DESTINATION,
    candidates,
    preferences("hiking_outdoors", "wellness"),
    { limit: 2, coverageWeight: 1 }
  );

  assert.deepEqual(new Set(city.top_picks.map(({ poi_id }) => poi_id)), new Set(["club", "museum"]));
  assert.deepEqual(new Set(nature.top_picks.map(({ poi_id }) => poi_id)), new Set(["trail", "spa"]));
  assert.ok(city.by_interest.culture_history?.length);
  assert.ok(nature.by_interest.hiking_outdoors?.length);
});
