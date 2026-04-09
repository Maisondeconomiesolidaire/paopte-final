import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("latitude"));
  const longitude = Number(searchParams.get("longitude"));
  const city = searchParams.get("city") || "Votre ville";

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json(
      { error: "Latitude ou longitude invalide." },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "1",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Impossible de récupérer la météo." },
        { status: response.status }
      );
    }

    const data = await response.json();
    const current = data.current ?? {};
    const daily = data.daily ?? {};
    const condition = getWeatherCondition(current.weather_code);

    return NextResponse.json({
      locationLabel: city,
      updatedAt: current.time ?? null,
      temperature: current.temperature_2m ?? null,
      apparentTemperature: current.apparent_temperature ?? null,
      windSpeed: current.wind_speed_10m ?? null,
      isDay: Boolean(current.is_day),
      weatherCode: current.weather_code ?? null,
      conditionLabel: condition.label,
      conditionKey: condition.key,
      temperatureMax: daily.temperature_2m_max?.[0] ?? null,
      temperatureMin: daily.temperature_2m_min?.[0] ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Service météo indisponible." },
      { status: 500 }
    );
  }
}

function getWeatherCondition(code) {
  if (code === 0) {
    return { key: "clear", label: "Ciel dégagé" };
  }

  if ([1, 2].includes(code)) {
    return { key: "partly-cloudy", label: "Éclaircies" };
  }

  if (code === 3) {
    return { key: "cloudy", label: "Ciel couvert" };
  }

  if ([45, 48].includes(code)) {
    return { key: "fog", label: "Brouillard" };
  }

  if ([51, 53, 55, 56, 57].includes(code)) {
    return { key: "drizzle", label: "Bruine" };
  }

  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { key: "rain", label: "Pluie" };
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { key: "snow", label: "Neige" };
  }

  if ([95, 96, 99].includes(code)) {
    return { key: "storm", label: "Orage" };
  }

  return { key: "cloudy", label: "Conditions variables" };
}
