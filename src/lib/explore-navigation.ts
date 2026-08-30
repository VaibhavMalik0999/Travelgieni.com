import type { ExplorePreferences } from "./explore-types";

export type ExploreDestinationContext = {
  traveller_destination_id: string;
  display_name: string;
  destination_type: string;
  country_code: string | null;
  image: {
    image_url: string;
    alt: string;
    photo_url: string;
    photographer: string;
    photographer_url: string;
  } | null;
};

export type ExploreNavigationContext = {
  destination: ExploreDestinationContext;
  preferences: ExplorePreferences;
};

const STORAGE_PREFIX = "travelginni:explore:";

export function saveExploreNavigation(context: ExploreNavigationContext) {
  sessionStorage.setItem(
    `${STORAGE_PREFIX}${context.destination.traveller_destination_id}`,
    JSON.stringify(context)
  );
}

export function loadExploreNavigation(destinationId: string): ExploreNavigationContext | null {
  const value = sessionStorage.getItem(`${STORAGE_PREFIX}${destinationId}`);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<ExploreNavigationContext>;
    if (
      parsed.destination?.traveller_destination_id !== destinationId ||
      !parsed.destination.display_name ||
      !parsed.preferences ||
      typeof parsed.preferences !== "object" ||
      !Object.keys(parsed.preferences).length
    ) {
      return null;
    }
    return parsed as ExploreNavigationContext;
  } catch {
    return null;
  }
}
