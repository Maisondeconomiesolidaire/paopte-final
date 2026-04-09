import { NextResponse } from "next/server";

const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
];

export async function GET(request) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const { searchParams, origin } = new URL(request.url);
  const state = searchParams.get("state") || "";
  const redirectUri = searchParams.get("redirectUri") || `${origin}/`;

  if (!clientId) {
    return NextResponse.json(
      { error: "SPOTIFY_CLIENT_ID est manquant dans l'environnement." },
      { status: 500 }
    );
  }

  const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(" "),
    state,
    show_dialog: "true",
  }).toString();

  return NextResponse.redirect(authorizeUrl);
}
