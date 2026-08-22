import { supabase } from './supabase';

export interface ReachablePlace {
  sourcePlaceId: string;
  placeName: string;
  countryCode: string;
  arrivalAirport: string;
  airportName: string;
  flightMinutes: number;
  airportToPlaceDistanceKm: number;
  onwardDistanceBand: string;
  airportRank: number;
  population: number | null;
}

type ReachablePlaceRow = {
  source_place_id: string;
  place_name: string;
  country_code: string;
  arrival_airport: string;
  airport_name: string;
  flight_minutes: number;
  airport_to_place_distance_km: number;
  onward_distance_band: string;
  airport_rank: number;
  population: number | null;
};

export async function loadReachablePlaces(
  originAirport: string,
  maxFlightMinutes: number,
  maxOnwardDistanceKm: number,
): Promise<ReachablePlace[]> {
  const { data, error } = await supabase.rpc('get_reachable_places', {
    p_origin_airport: originAirport,
    p_max_flight_minutes: maxFlightMinutes,
    p_max_onward_distance_km: maxOnwardDistanceKm,
  });

  if (error) throw error;

  return ((data ?? []) as ReachablePlaceRow[]).map((row) => ({
    sourcePlaceId: row.source_place_id,
    placeName: row.place_name,
    countryCode: row.country_code,
    arrivalAirport: row.arrival_airport,
    airportName: row.airport_name,
    flightMinutes: row.flight_minutes,
    airportToPlaceDistanceKm: Number(row.airport_to_place_distance_km),
    onwardDistanceBand: row.onward_distance_band,
    airportRank: row.airport_rank,
    population: row.population,
  }));
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
