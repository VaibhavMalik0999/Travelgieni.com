import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HARD_CASES = [
  "Lofoten",
  "La Gomera",
  "Menorca",
  "Mallorca",
  "Ibiza",
  "Lake Como",
  "Lake Bled",
  "Florence",
  "Prague",
  "Budva",
  "Jasmund National Park",
  "Plitvice Lakes National Park",
  "Cinque Terre",
  "Amalfi Coast",
  "Santorini",
  "Madeira",
  "Faroe Islands",
  "Corsica",
  "Sardinia",
  "Interlaken",
];

const CONCURRENCY = 4;

type Destination = {
  traveller_destination_id: string;
  display_name: string;
  destination_type: string | null;
  country_code: string | null;
};

type AirportPair = {
  origin_iata: string;
  origin_airport_name: string;
  origin_airport_distance_km: number;
  destination_iata: string;
  destination_airport_name: string;
  destination_airport_distance_km: number;
};

function isoDurationToMinutes(value?: string | null) {
  if (!value) return null;
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) return null;
  return (
    Number(match[1] ?? 0) * 1440 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0) +
    Math.round(Number(match[4] ?? 0) / 60)
  );
}

function formatMinutes(total: number | null) {
  if (total == null) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""}`;
}

function classify(
  pair: AirportPair,
  offersFound: number,
  bestStops: number | null
) {
  const distance = Number(pair.destination_airport_distance_km);

  if (!offersFound) return "NO_USEFUL_FLIGHT";
  if (distance > 100) return "GROUND_TRANSPORT_NEEDED";
  if (distance > 50 || (bestStops ?? 0) > 1) return "REVIEW_GATEWAY";
  return "GOOD";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export async function GET() {
  const startedAt = Date.now();

  try {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!token || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { ok: false, error: "Missing server configuration." },
        { status: 500 }
      );
    }

    // Fixed diagnostic scenario: Berlin, 15–20 Sep 2026.
    // This makes results directly comparable with our successful card experiment.
    const origin = {
      name: "Berlin",
      latitude: 52.52,
      longitude: 13.405,
    };
    const departureDate = "2026-09-15";
    const returnDate = "2026-09-20";

    // Fetch the live discovery universe once, then match the diagnostic names locally.
    const destinationResponse = await fetch(
      `${supabaseUrl}/rest/v1/tg_global_destinations_final?select=traveller_destination_id,display_name,destination_type,country_code`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!destinationResponse.ok) {
      return NextResponse.json(
        { ok: false, stage: "destinations", error: await destinationResponse.text() },
        { status: 502 }
      );
    }

    const universe: Destination[] = await destinationResponse.json();

    const selected = HARD_CASES.map((wanted) => {
      const exact = universe.find(
        (d) => d.display_name.toLowerCase() === wanted.toLowerCase()
      );
      if (exact) return { wanted, destination: exact };

      const fuzzy = universe.find(
        (d) =>
          d.display_name.toLowerCase().includes(wanted.toLowerCase()) ||
          wanted.toLowerCase().includes(d.display_name.toLowerCase())
      );
      return { wanted, destination: fuzzy ?? null };
    });

    const rows = await mapWithConcurrency(selected, CONCURRENCY, async (item) => {
      if (!item.destination) {
        return {
          requested_destination: item.wanted,
          resolved_destination: null,
          classification: "DESTINATION_NOT_FOUND",
        };
      }

      const destination = item.destination;

      const bridgeResponse = await fetch(
        `${supabaseUrl}/rest/v1/rpc/get_travelginni_flight_airport_pair`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_origin_latitude: origin.latitude,
            p_origin_longitude: origin.longitude,
            p_traveller_destination_id: destination.traveller_destination_id,
          }),
          cache: "no-store",
        }
      );

      if (!bridgeResponse.ok) {
        return {
          requested_destination: item.wanted,
          resolved_destination: destination.display_name,
          classification: "AIRPORT_BRIDGE_ERROR",
        };
      }

      const bridgePayload = await bridgeResponse.json();
      const pair: AirportPair | undefined = Array.isArray(bridgePayload)
        ? bridgePayload[0]
        : undefined;

      if (!pair) {
        return {
          requested_destination: item.wanted,
          resolved_destination: destination.display_name,
          destination_type: destination.destination_type,
          country_code: destination.country_code,
          classification: "NO_SAFE_AIRPORT",
        };
      }

      const duffelResponse = await fetch(
        "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=5000",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Duffel-Version": "v2",
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              cabin_class: "economy",
              slices: [
                {
                  origin: pair.origin_iata,
                  destination: pair.destination_iata,
                  departure_date: departureDate,
                },
                {
                  origin: pair.destination_iata,
                  destination: pair.origin_iata,
                  departure_date: returnDate,
                },
              ],
              passengers: [{ type: "adult" }],
            },
          }),
          cache: "no-store",
        }
      );

      if (!duffelResponse.ok) {
        return {
          requested_destination: item.wanted,
          resolved_destination: destination.display_name,
          destination_airport: pair.destination_iata,
          airport_distance_km: pair.destination_airport_distance_km,
          classification: "DUFFEL_ERROR",
          duffel_status: duffelResponse.status,
        };
      }

      const payload = await duffelResponse.json();
      const offers = Array.isArray(payload?.data?.offers)
        ? payload.data.offers
        : [];

      const normalized = offers
        .map((offer: any) => {
          const outbound = offer?.slices?.[0];
          const segments = Array.isArray(outbound?.segments)
            ? outbound.segments
            : [];
          const minutes = isoDurationToMinutes(outbound?.duration);
          return {
            amount: Number(offer?.total_amount ?? Number.POSITIVE_INFINITY),
            amount_text: offer?.total_amount ?? null,
            currency: offer?.total_currency ?? null,
            duration_minutes: minutes,
            duration_display: formatMinutes(minutes),
            stops: Math.max(0, segments.length - 1),
            direct: segments.length === 1,
          };
        })
        .filter((offer: any) => Number.isFinite(offer.amount))
        .sort((a: any, b: any) => a.amount - b.amount);

      const cheapest = normalized[0] ?? null;
      const fastest = [...normalized]
        .filter((o: any) => o.duration_minutes != null)
        .sort(
          (a: any, b: any) =>
            (a.duration_minutes ?? Infinity) -
            (b.duration_minutes ?? Infinity)
        )[0] ?? null;

      return {
        requested_destination: item.wanted,
        resolved_destination: destination.display_name,
        destination_type: destination.destination_type,
        country_code: destination.country_code,
        origin_airport: pair.origin_iata,
        destination_airport: pair.destination_iata,
        destination_airport_name: pair.destination_airport_name,
        airport_distance_km: pair.destination_airport_distance_km,
        offers_found: normalized.length,
        cheapest_test_fare: cheapest
          ? `${cheapest.amount_text} ${cheapest.currency}`
          : null,
        cheapest_duration: cheapest?.duration_display ?? null,
        cheapest_stops: cheapest?.stops ?? null,
        fastest_duration: fastest?.duration_display ?? null,
        fastest_stops: fastest?.stops ?? null,
        classification: classify(
          pair,
          normalized.length,
          fastest?.stops ?? null
        ),
      };
    });

    const counts = rows.reduce<Record<string, number>>((acc, row: any) => {
      acc[row.classification] = (acc[row.classification] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      diagnostic_only: true,
      live_mode_expected: false,
      scenario: {
        origin,
        departure_date: departureDate,
        return_date: returnDate,
        requested_cases: HARD_CASES.length,
        concurrency: CONCURRENCY,
      },
      elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      classification_counts: counts,
      interpretation: {
        GOOD: "Current primary-airport mapping looks usable for flight-card enrichment.",
        REVIEW_GATEWAY:
          "Flight exists, but airport distance or routing suggests we should inspect whether another gateway is better.",
        GROUND_TRANSPORT_NEEDED:
          "Mapped airport is over 100 km away; flight alone does not describe the practical journey.",
        NO_SAFE_AIRPORT:
          "No airport survived the current 200 km V1 safety rule.",
        NO_USEFUL_FLIGHT:
          "Airport mapping exists but Duffel returned no usable offer.",
        DESTINATION_NOT_FOUND:
          "The named hard case was not found in the live discovery universe.",
      },
      results: rows,
      note:
        "Duffel test-mode fares/schedules may be synthetic. Classification is diagnostic, not production logic.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Diagnostic failed.",
      },
      { status: 500 }
    );
  }
}
