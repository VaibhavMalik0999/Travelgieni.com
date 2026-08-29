import type { ExplorePoiCandidate } from "./explore-types";

export interface ExplorePoiSource {
  getCandidates(travellerDestinationId: string): Promise<ExplorePoiCandidate[]>;
}

/**
 * Supabase adapter for the future named-POI layer. The RPC must return only
 * precomputed data; request-time LLM or provider lookups are deliberately absent.
 */
export class SupabaseExplorePoiSource implements ExplorePoiSource {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string
  ) {}

  async getCandidates(travellerDestinationId: string) {
    const response = await fetch(
      `${this.url}/rest/v1/rpc/get_travelginni_explore_poi_candidates`,
      {
        method: "POST",
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_traveller_destination_id: travellerDestinationId,
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new ExplorePoiSourceError("poi_source_unavailable", response.status);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new ExplorePoiSourceError("invalid_poi_source_response", 502);
    }
    return payload as ExplorePoiCandidate[];
  }
}

export class ExplorePoiSourceError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number
  ) {
    super(message);
    this.name = "ExplorePoiSourceError";
  }
}

export function createExplorePoiSourceFromEnvironment(): ExplorePoiSource {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ExplorePoiSourceError("server_configuration", 500);
  }
  return new SupabaseExplorePoiSource(url, key);
}
