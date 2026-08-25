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
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function isIsoDate(value: string | null) {
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
        { ok: false, reason: "server_configuration" },
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
      !isIsoDate(departureDate) ||
      !isIsoDate(returnDate)
    ) {
      return NextResponse.json(
        { ok: false, reason: "invalid_input" },
        { status: 400 }
      );
    }

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
        { ok: false, reason: "airport_bridge_error" },
        { status: 502 }
      );
    }

    const pair: AirportPair | undefined = Array.isArray(bridgePayload)
      ? bridgePayload[0]
      : undefined;

    if (!pair) {
      return NextResponse.json(
        { ok: false, reason: "no_safe_airport_pair" },
        { status: 404 }
      );
    }

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

    const payload = await duffelResponse.json();

    if (!duffelResponse.ok) {
      return NextResponse.json(
        { ok: false, reason: "duffel_error" },
        { status: 502 }
      );
    }

    const requestData = payload?.data;
    const offers = Array.isArray(requestData?.offers) ? requestData.offers : [];

    if (!offers.length) {
      return NextResponse.json({
        ok: false,
        reason: "no_offers",
        airport_pair: pair,
      });
    }

    const normalized = offers
      .map((offer: any) => {
        const outbound = offer?.slices?.[0];
        const inbound = offer?.slices?.[1];

        const outboundSegments = Array.isArray(outbound?.segments)
          ? outbound.segments
          : [];
        const inboundSegments = Array.isArray(inbound?.segments)
          ? inbound.segments
          : [];

        const outboundMinutes = isoDurationToMinutes(outbound?.duration);
        const inboundMinutes = isoDurationToMinutes(inbound?.duration);

        return {
          offer_id: offer?.id ?? null,
          amount: Number(offer?.total_amount ?? Number.POSITIVE_INFINITY),
          amount_text: offer?.total_amount ?? null,
          currency: offer?.total_currency ?? null,
          outbound: {
            duration_minutes: outboundMinutes,
            duration_display: formatMinutes(outboundMinutes),
            stops: Math.max(0, outboundSegments.length - 1),
            direct: outboundSegments.length === 1,
            carrier:
              outboundSegments[0]?.operating_carrier?.name ??
              outboundSegments[0]?.marketing_carrier?.name ??
              null,
          },
          inbound: {
            duration_minutes: inboundMinutes,
            duration_display: formatMinutes(inboundMinutes),
            stops: Math.max(0, inboundSegments.length - 1),
            direct: inboundSegments.length === 1,
          },
        };
      })
      .filter((offer: any) => Number.isFinite(offer.amount))
      .sort((a: any, b: any) => a.amount - b.amount);

    const cheapest = normalized[0];

    if (!cheapest) {
      return NextResponse.json({
        ok: false,
        reason: "no_usable_offers",
        airport_pair: pair,
      });
    }

    return NextResponse.json({
      ok: true,
      live_mode: requestData?.live_mode ?? null,
      test_mode: requestData?.live_mode === false,
      airport_pair: pair,
      offers_found: normalized.length,
      cheapest: {
        amount: cheapest.amount_text,
        currency: cheapest.currency,
        outbound_duration: cheapest.outbound.duration_display,
        outbound_duration_minutes: cheapest.outbound.duration_minutes,
        outbound_stops: cheapest.outbound.stops,
        outbound_direct: cheapest.outbound.direct,
        inbound_duration: cheapest.inbound.duration_display,
        inbound_stops: cheapest.inbound.stops,
        carrier: cheapest.outbound.carrier,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unexpected_error" },
      { status: 500 }
    );
  }
}
