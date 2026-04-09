"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  LoaderCircle,
  Sun,
  Wind,
  Zap,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LocalWeatherPanel({ profile, compact = false }) {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!Number.isFinite(profile?.latitude) || !Number.isFinite(profile?.longitude)) {
      setWeather(null);
      setError("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadWeather() {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          latitude: String(profile.latitude),
          longitude: String(profile.longitude),
          city: profile.city || profile.addressLabel || "Votre ville",
        });
        const response = await fetch(`/api/weather?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Impossible de recuperer la meteo.");
        }

        setWeather(data);
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setWeather(null);
          setError(loadError instanceof Error ? loadError.message : "Impossible de recuperer la meteo.");
        }
      } finally {
        setIsLoading(false);
      }
    }

    void loadWeather();

    return () => {
      controller.abort();
    };
  }, [profile?.addressLabel, profile?.city, profile?.latitude, profile?.longitude]);

  const WeatherIcon = pickWeatherIcon(weather?.conditionKey, weather?.isDay);

  return (
    <Card className={`border border-white/80 bg-white/76 shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl ${compact ? "" : "h-full min-h-0"}`}>
      <CardHeader className="border-b border-[#007f70]/10">
        <CardTitle className="text-xl text-[#123d38]">Meteo locale</CardTitle>
        <CardDescription>
          {profile?.addressLabel || profile?.city || "Ajoutez votre adresse pour activer la meteo."}
        </CardDescription>
      </CardHeader>
      <CardContent className={`flex flex-col ${compact ? "gap-4 p-5" : "h-full justify-between p-6"}`}>
        {isLoading ? (
          <div className="flex min-h-40 items-center gap-3 rounded-3xl bg-[#f4fbf9] px-5 text-sm text-[#5a7d77]">
            <LoaderCircle className="size-5 animate-spin text-[#007f70]" />
            Recuperation des conditions actuelles...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200/70 bg-red-50 px-4 py-4 text-sm text-red-700">
            {error}
          </div>
        ) : !weather ? (
          <div className="rounded-3xl border border-dashed border-[#007f70]/15 bg-[#f4fbf9] px-5 py-6 text-sm leading-6 text-[#557872]">
            Papote affichera la meteo locale ici des que le profil contient une latitude et une longitude.
          </div>
        ) : (
          <>
            <div className="rounded-[2rem] bg-[linear-gradient(145deg,rgba(0,127,112,0.08),rgba(184,126,177,0.12))] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-[#5d7d77]">Aujourd&apos;hui</p>
                  <p className="mt-2 text-4xl font-semibold tracking-tight text-[#123d38]">
                    {formatNumber(weather.temperature)}°
                  </p>
                  <p className="mt-2 text-sm text-[#476863]">{weather.conditionLabel}</p>
                </div>
                <div className="rounded-3xl bg-white/70 p-4 text-[#007f70] shadow-[0_16px_40px_rgba(0,127,112,0.08)]">
                  <WeatherIcon className="size-9" />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-[#365a55]">
                <WeatherMetric label="Ressenti" value={`${formatNumber(weather.apparentTemperature)}°`} />
                <WeatherMetric label="Vent" value={`${formatNumber(weather.windSpeed)} km/h`} />
                <WeatherMetric label="Min" value={`${formatNumber(weather.temperatureMin)}°`} />
                <WeatherMetric label="Max" value={`${formatNumber(weather.temperatureMax)}°`} />
              </div>
            </div>

            {!compact ? (
              <div className="rounded-3xl border border-[#007f70]/10 bg-[#f7fbfa] px-4 py-4 text-sm leading-6 text-[#4d6c67]">
                Conditions pour <span className="font-medium text-[#183f3b]">{weather.locationLabel}</span>.
                Papote peut s&apos;appuyer sur votre ville pour personnaliser la conversation.
              </div>
            ) : null}
          </>
        )}

        {!compact ? (
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#7b908d]">
            <Wind className="size-3.5" />
            Source temps reel: Open-Meteo
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WeatherMetric({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/72 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7a8f8b]">{label}</p>
      <p className="mt-1 text-base font-medium text-[#183f3b]">{value}</p>
    </div>
  );
}

function pickWeatherIcon(conditionKey, isDay) {
  switch (conditionKey) {
    case "clear":
      return isDay ? Sun : Cloud;
    case "partly-cloudy":
      return CloudSun;
    case "fog":
      return CloudFog;
    case "drizzle":
      return CloudDrizzle;
    case "rain":
      return CloudRain;
    case "snow":
      return CloudSnow;
    case "storm":
      return Zap;
    default:
      return Cloud;
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return Math.round(value);
}
