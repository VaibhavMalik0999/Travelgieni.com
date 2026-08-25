import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours ? `${hours}h` : ""}${hours && minutes ? " " : ""}${
    minutes ? `${minutes}m` : ""
  }`;
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: NextRequest) {
  try {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!token || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing DUFFEL_ACCESS_TOKEN, Supabase URL, or SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    const params = request.nextUrl.searchParams;
    const originLat = Number(params.get("origin_lat"));
    const originLon = Number(params.get("origin_lon"));
    const destinationId = params.get("destination_id");
    const departureDate = params.get("departure_date");
    const returnDate = params.get("return_date");

    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLon) ||
      !destinationId ||
      !validDate(departureDate)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Required: origin_lat, origin_lon, destination_id, departure_date=YYYY-MM-DD. return_date is optional.",
        },
        { status: 400 }
      );
    }

    if (returnDate && !validDate(returnDate)) {
      return NextResponse.json(
        { ok: false, error: "return_date must be YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // 1) Resolve the real TravelGinni origin + destination to IATA airports.
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
          p_origin_latitude: originLat,
          p_origin_longitude: originLon,
          p_traveller_destination_id: destinationId,
        }),
        cache: "no-store",
      }
    );

    const bridgePayload = await bridgeResponse.json();

    if (!bridgeResponse.ok) {
      return NextResponse.json(
        { ok: false, stage: "airport_bridge", error: bridgePayload },
        { status: 502 }
      );
    }

    const pair: AirportPair | undefined = Array.isArray(bridgePayload)
      ? bridgePayload[0]
      : undefined;

    if (!pair) {
      return NextResponse.json(
        {
          ok: false,
          stage: "airport_bridge",
          reason: "no_safe_airport_pair",
          message:
            "This destination/origin does not currently have a safe airport mapping within the V1 200 km rule.",
        },
        { status: 404 }
      );
    }

    const slices = [
      {
        origin: pair.origin_iata,
        destination: pair.destination_iata,
        departure_date: departureDate,
      },
    ];

    if (returnDate) {
      slices.push({
        origin: pair.destination_iata,
        destination: pair.origin_iata,
        departure_date: returnDate,
      });
    }

    // 2) Ask Duffel for offers for the resolved airport pair.
    const duffelResponse = await fetch(
      "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000",
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
            slices,
            passengers: [{ type: "adult" }],
          },
        }),
        cache: "no-store",
      }
    );

    const duffelPayload = await duffelResponse.json();

    if (!duffelResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "duffel",
          airport_pair: pair,
          duffel_status: duffelResponse.status,
          error: duffelPayload,
        },
        { status: 502 }
      );
    }

    const requestData = duffelPayload?.data;
    const offers = Array.isArray(requestData?.offers) ? requestData.offers : [];

    const normalized = offers
      .map((offer: any) => {
        const journeys = (offer?.slices ?? []).map((slice: any) => {
          const segments = Array.isArray(slice?.segments) ? slice.segments : [];
          const durationMinutes = isoDurationToMinutes(slice?.duration);

          return {
            origin:
              segments[0]?.origin?.iata_code ?? pair.origin_iata,
            destination:
              segments[segments.length - 1]?.destination?.iata_code ??
              pair.destination_iata,
            duration: slice?.duration ?? null,
            duration_minutes: durationMinutes,
            duration_display: formatMinutes(durationMinutes),
            stops: Math.max(0, segments.length - 1),
            direct: segments.length === 1,
            segments: segments.map((segment: any) => ({
              origin: segment?.origin?.iata_code ?? null,
              destination: segment?.destination?.iata_code ?? null,
              departing_at: segment?.departing_at ?? null,
              arriving_at: segment?.arriving_at ?? null,
              carrier:
                segment?.operating_carrier?.name ??
                segment?.marketing_carrier?.name ??
                null,
              flight_number:
                segment?.marketing_carrier_flight_number ?? null,
            })),
          };
        });

        return {
          offer_id: offer?.id ?? null,
          price: {
            amount: offer?.total_amount ?? null,
            currency: offer?.total_currency ?? null,
          },
          journeys,
        };
      })
      .sort(
        (a: any, b: any) =>
          Number(a.price.amount ?? Infinity) -
          Number(b.price.amount ?? Infinity)
      );

    return NextResponse.json({
      ok: true,
      live_mode: requestData?.live_mode ?? null,
      input: {
        origin: { latitude: originLat, longitude: originLon },
        traveller_destination_id: destinationId,
        departure_date: departureDate,
        return_date: returnDate ?? null,
      },
      airport_pair: pair,
      offers_found: normalized.length,
      cheapest_offers: normalized.slice(0, 5),
      note:
        "Duffel test-mode schedules and prices may be synthetic. This validates the full TravelGinni origin → airport → destination → airport → Duffel chain.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Flight test failed.",
      },
      { status: 500 }
    );
  }
}
