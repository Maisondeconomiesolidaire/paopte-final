const SPOTIFY_SESSION_STORAGE_KEY = "papote.spotify.session";
const SPOTIFY_STATE_STORAGE_KEY = "papote.spotify.state";

export function getSpotifyRedirectUri() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.origin}/`;
}

export function loadSpotifySession() {
  if (typeof window === "undefined") {
    return null;
  }

  const serialized = window.localStorage.getItem(SPOTIFY_SESSION_STORAGE_KEY);
  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

export function saveSpotifySession(session) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SPOTIFY_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSpotifySession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SPOTIFY_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(SPOTIFY_STATE_STORAGE_KEY);
}

export function hasSpotifySessionExpired(session) {
  if (!session?.expiresAt) {
    return true;
  }

  return Date.now() >= session.expiresAt - 60_000;
}

export function beginSpotifyAuthorization() {
  if (typeof window === "undefined") {
    return;
  }

  const state = generateRandomString(24);
  const redirectUri = getSpotifyRedirectUri();

  window.localStorage.setItem(SPOTIFY_STATE_STORAGE_KEY, state);

  const authorizeUrl = new URL("/api/spotify/authorize", window.location.origin);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirectUri", redirectUri);

  window.location.href = authorizeUrl.toString();
}

export async function exchangeSpotifyCodeForTokens({ code, state }) {
  if (typeof window === "undefined") {
    throw new Error("Spotify doit être connecté depuis le navigateur.");
  }

  const storedState = window.localStorage.getItem(SPOTIFY_STATE_STORAGE_KEY);
  if (!state || !storedState || state !== storedState) {
    throw new Error("La vérification Spotify a échoué. Merci de réessayer.");
  }

  const response = await fetch("/api/spotify/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "exchange",
      code,
      redirectUri: getSpotifyRedirectUri(),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Impossible de connecter Spotify.");
  }

  window.localStorage.removeItem(SPOTIFY_STATE_STORAGE_KEY);
  return data;
}

export async function refreshSpotifyAccessToken(refreshToken) {
  const response = await fetch("/api/spotify/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "refresh",
      refreshToken,
      redirectUri: getSpotifyRedirectUri(),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Impossible de rafraîchir Spotify.");
  }

  return data;
}

export async function spotifyApiFetch(path, accessToken, init = {}) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.error_description || "Spotify a refusé la requête."
    );
  }

  return data;
}

export async function loadSpotifySdk(spotifySdkPromiseRef) {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.Spotify) {
    return window.Spotify;
  }

  if (spotifySdkPromiseRef.current) {
    return spotifySdkPromiseRef.current;
  }

  spotifySdkPromiseRef.current = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]');

    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Impossible de charger le lecteur Spotify."));
    document.body.appendChild(script);
  });

  return spotifySdkPromiseRef.current;
}

function generateRandomString(length) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
