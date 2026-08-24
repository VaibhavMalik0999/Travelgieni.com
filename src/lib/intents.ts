export type IntentKey =
  | "arts_entertainment"
  | "bars_evening_drinks"
  | "beach_coast"
  | "cafe_culture"
  | "clubbing_nightlife"
  | "culture_history"
  | "family_attractions"
  | "food_dining"
  | "hiking_outdoors"
  | "nature_scenery"
  | "resort_experience"
  | "shopping_markets"
  | "sports_recreation"
  | "water_activities"
  | "wellness";

export type IntentDefinition = {
  key: IntentKey;
  label: string;
  shortLabel: string;
  prompt: string;
  emoji: string;
};

export const INTENTS: IntentDefinition[] = [
  {
    key: "beach_coast",
    label: "Beach & coast",
    shortLabel: "Beach",
    prompt: "Beaches, coastline and seaside atmosphere",
    emoji: "🏖️",
  },
  {
    key: "food_dining",
    label: "Food & dining",
    shortLabel: "Food",
    prompt: "Restaurants, local food and dining variety",
    emoji: "🍽️",
  },
  {
    key: "culture_history",
    label: "Culture & history",
    shortLabel: "Culture",
    prompt: "Historic places, museums and cultural heritage",
    emoji: "🏛️",
  },
  {
    key: "nature_scenery",
    label: "Nature & scenery",
    shortLabel: "Nature",
    prompt: "Natural landscapes and scenic surroundings",
    emoji: "🌿",
  },
  {
    key: "hiking_outdoors",
    label: "Hiking & outdoors",
    shortLabel: "Hiking",
    prompt: "Trails, walking and outdoor exploration",
    emoji: "🥾",
  },
  {
    key: "clubbing_nightlife",
    label: "Clubbing & nightlife",
    shortLabel: "Nightlife",
    prompt: "Clubs, music venues and late-night energy",
    emoji: "🪩",
  },
  {
    key: "bars_evening_drinks",
    label: "Bars & evening drinks",
    shortLabel: "Bars",
    prompt: "Bars, lounges and relaxed evening drinks",
    emoji: "🍸",
  },
  {
    key: "cafe_culture",
    label: "Café culture",
    shortLabel: "Cafés",
    prompt: "Cafés, coffee shops and café-going culture",
    emoji: "☕",
  },
  {
    key: "water_activities",
    label: "Water activities",
    shortLabel: "Water",
    prompt: "Marinas, boating and activities on the water",
    emoji: "⛵",
  },
  {
    key: "wellness",
    label: "Wellness",
    shortLabel: "Wellness",
    prompt: "Wellness services, spas and restorative experiences",
    emoji: "🧖",
  },
  {
    key: "resort_experience",
    label: "Resort experience",
    shortLabel: "Resorts",
    prompt: "Resorts, pools and holiday accommodation atmosphere",
    emoji: "🌴",
  },
  {
    key: "family_attractions",
    label: "Family attractions",
    shortLabel: "Family",
    prompt: "Attractions and experiences suited to families",
    emoji: "🎡",
  },
  {
    key: "arts_entertainment",
    label: "Arts & entertainment",
    shortLabel: "Arts",
    prompt: "Galleries, theatres, music and entertainment",
    emoji: "🎭",
  },
  {
    key: "shopping_markets",
    label: "Shopping & markets",
    shortLabel: "Shopping",
    prompt: "Markets, shops and retail variety",
    emoji: "🛍️",
  },
  {
    key: "sports_recreation",
    label: "Sports & recreation",
    shortLabel: "Sports",
    prompt: "Sports, fitness and recreational activity",
    emoji: "🎾",
  },
];

export function getIntent(key: string) {
  return INTENTS.find((intent) => intent.key === key);
}
