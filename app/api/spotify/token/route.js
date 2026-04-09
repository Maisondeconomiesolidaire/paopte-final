import { NextResponse } from "next/server";

export async function POST(request) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "SPOTIFY_CLIENT_ID ou SPOTIFY_CLIENT_SECRET est manquant." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const params = new URLSearchParams();

  if (body?.action === "exchange") {
    if (!body.code || !body.redirectUri) {
      return NextResponse.json(
        { error: "Le code Spotify ou le redirectUri est manquant." },
        { status: 400 }
      );
    }

    params.set("grant_type", "authorization_code");
    params.set("code", body.code);
    params.set("redirect_uri", body.redirectUri);
  } else if (body?.action === "refresh") {
    if (!body.refreshToken) {
      return NextResponse.json(
        { error: "Le refresh token Spotify est manquant." },
        { status: 400 }
      );
    }

    params.set("grant_type", "refresh_token");
    params.set("refresh_token", body.refreshToken);
  } else {
    return NextResponse.json({ error: "Action Spotify inconnue." }, { status: 400 });
  }

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            data.error_description || data.error || "Spotify a refusé la demande d'autorisation.",
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      accessToken: data.access_token || "",
      refreshToken: data.refresh_token || body.refreshToken || "",
      expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
      scope: data.scope || "",
      tokenType: data.token_type || "Bearer",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Impossible de contacter Spotify pour le token.",
      },
      { status: 500 }
    );
  }
}
