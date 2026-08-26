import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function nightsBetween(checkin: string, checkout: string) {
  const start = Date.parse(`${checkin}T00:00:00Z`);
  const end = Date.parse(`${checkout}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function searchRadius(destinationType: string | null) {
  switch ((destinationType ?? "").toLowerCase()) {
    case "region":
      return 40000;
    case "rural_area":
    case "rural area":
    case "park":
      return 30000;
    default:
      return 15000;
  }
}

type RateCandidate = {
  amount: number;
  currency: string;
};

function extractRateCandidates(payload: any): RateCandidate[] {
  const hotels = Array.isArray(payload?.data) ? payload.data : [];
  const candidates: RateCandidate[] = [];

  for (const hotel of hotels) {
    const roomTypes = Array.isArray(hotel?.roomTypes) ? hotel.roomTypes : [];

    for (const roomType of roomTypes) {
      const rates = Array.isArray(roomType?.rates) ? roomType.rates : [];

      for (const rate of rates) {
        const totals = Array.isArray(rate?.retailRate?.total)
          ? rate.retailRate.total
          : [];

        for (const total of totals) {
          const amount = Number(total?.amount);
          const currency = String(total?.currency ?? "").trim();

          if (Number.isFinite(amount) && amount > 0 && currency) {
            candidates.push({ amount, currency });
          }
        }
      }
    }
  }

  return candidates;
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.LITEAPI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, reason: "server_configuration" },
        { status: 500 }
      );
    }

    const params = request.nextUrl.searchParams;
    const latitude = Number(params.get("destination_lat"));
    const longitude = Number(params.get("destination_lon"));
    const destinationType = params.get("destination_type");
    const checkin = params.get("checkin");
    const checkout = params.get("checkout");

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !isIsoDate(checkin) ||
      !isIsoDate(checkout)
    ) {
      return NextResponse.json(
        { ok: false, reason: "invalid_input" },
        { status: 400 }
      );
    }

    const nights = nightsBetween(checkin!, checkout!);
    if (nights < 1) {
      return NextResponse.json(
        { ok: false, reason: "invalid_dates" },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://api.liteapi.travel/v3.0/hotels/rates",
      {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          occupancies: [{ adults: 1 }],
          currency: "EUR",
          // LiteAPI requires guest nationality for rate eligibility. For the
          // prototype we keep this server-configurable rather than asking the
          // traveller for another field during destination discovery.
          guestNationality:
            process.env.LITEAPI_GUEST_NATIONALITY?.trim().toUpperCase() || "DE",
          checkin,
          checkout,
          latitude,
          longitude,
          radius: searchRadius(destinationType),
          limit: 20,
          maxRatesPerHotel: 1,
          timeout: 8,
        }),
        cache: "no-store",
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "liteapi_error",
          upstream_status: response.status,
          upstream_error:
            payload?.error?.message ?? payload?.message ?? payload?.error ?? null,
        },
        { status: 502 }
      );
    }

    const rates = extractRateCandidates(payload).sort(
      (a, b) => a.amount - b.amount
    );

    const cheapest = rates[0];
    if (!cheapest) {
      return NextResponse.json({
        ok: false,
        reason: "no_rates",
        test_mode: Boolean(payload?.sandbox),
      });
    }

    const hotelsFound = Array.isArray(payload?.data) ? payload.data.length : 0;

    return NextResponse.json({
      ok: true,
      provider: "liteapi",
      test_mode: Boolean(payload?.sandbox),
      nights,
      hotels_found: hotelsFound,
      cheapest: {
        total_amount: Number(cheapest.amount.toFixed(2)),
        nightly_amount: Number((cheapest.amount / nights).toFixed(2)),
        currency: cheapest.currency,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unexpected_error" },
      { status: 500 }
    );
  }
}
