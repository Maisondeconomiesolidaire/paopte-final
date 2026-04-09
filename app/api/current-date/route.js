import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("latitude"));
  const longitude = Number(searchParams.get("longitude"));

  let timeZone = "UTC";

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    try {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "temperature_2m",
        timezone: "auto",
        forecast_days: "1",
      });

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
        { cache: "no-store" }
      );

      if (response.ok) {
        const data = await response.json();
        if (typeof data.timezone === "string" && data.timezone.trim()) {
          timeZone = data.timezone;
        }
      }
    } catch {
      // Fallback to UTC when timezone lookup fails.
    }
  }

  const now = new Date();

  return NextResponse.json({
    timeZone,
    iso: now.toISOString(),
    promptValue: formatPromptDate(now, timeZone),
    displayValue: formatDisplayDate(now, timeZone),
  });
}

function formatPromptDate(date, timeZone) {
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(date);

  return `${formatted} (${timeZone})`;
}

function formatDisplayDate(date, timeZone) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
