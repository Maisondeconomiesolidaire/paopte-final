"use client";

import { UserButton } from "@clerk/nextjs";
import { useConversation } from "@elevenlabs/react";
import {
  AudioLines,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  MessageSquare,
  Mic,
  Music4,
  PauseCircle,
  Phone,
  PhoneOff,
  ShieldAlert,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Orb } from "@/components/ui/orb";
import {
  beginSpotifyAuthorization,
  clearSpotifySession,
  exchangeSpotifyCodeForTokens,
  hasSpotifySessionExpired,
  loadSpotifySdk,
  loadSpotifySession,
  refreshSpotifyAccessToken,
  saveSpotifySession,
  spotifyApiFetch,
} from "@/lib/spotify";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "";
const TRIAL_EXHAUSTED_MESSAGE = "Vous avez utilisé tous vos crédits, merci pour votre essai.";
const SPOTIFY_NORMAL_VOLUME = 0.9;
const SPOTIFY_AGENT_DUCKED_VOLUME = 0.18;
const SPOTIFY_USER_DUCKED_VOLUME = 0.06;
const USER_VAD_ACTIVE_THRESHOLD = 0.34;
const USER_VAD_RELEASE_THRESHOLD = 0.14;
const USER_INPUT_VOLUME_ACTIVE_THRESHOLD = 0.22;
const USER_INPUT_VOLUME_RELEASE_THRESHOLD = 0.09;
const USER_INPUT_VOLUME_POLL_MS = 120;
const USER_VAD_RELEASE_DELAY_MS = 320;
const USER_INPUT_LOW_STREAK_TO_RELEASE = 3;

const formatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

export function VoiceStudio({
  profile,
  recentConversations,
  upcomingEvents = [],
  recentNotes = [],
}) {
  const [messages, setMessages] = useState([]);
  const [requestError, setRequestError] = useState("");
  const [toolNotice, setToolNotice] = useState("");
  const [localCreatedEvents, setLocalCreatedEvents] = useState([]);
  const [localCreatedNotes, setLocalCreatedNotes] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [sessionTimeZone, setSessionTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [spotifySession, setSpotifySession] = useState(null);
  const [spotifyAccount, setSpotifyAccount] = useState(null);
  const [spotifyStatusMessage, setSpotifyStatusMessage] = useState("");
  const [spotifyError, setSpotifyError] = useState("");
  const [spotifyNowPlaying, setSpotifyNowPlaying] = useState(null);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState("");
  const [spotifyPlaybackPositionMs, setSpotifyPlaybackPositionMs] = useState(0);
  const [spotifyPlaybackDurationMs, setSpotifyPlaybackDurationMs] = useState(0);
  const [isSpotifyPlaying, setIsSpotifyPlaying] = useState(false);
  const [isSpotifyBusy, setIsSpotifyBusy] = useState(false);
  const [isSpotifyReady, setIsSpotifyReady] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState(null);
  const [revealedSidebarPanels, setRevealedSidebarPanels] = useState({
    agenda: false,
    music: false,
    notes: false,
  });
  const [focusedSurface, setFocusedSurface] = useState(null);
  const convex = useConvex();
  const activeConversationRef = useRef(null);
  const spotifyPlayerRef = useRef(null);
  const spotifySdkPromiseRef = useRef(null);
  const sidebarScrollContainerRef = useRef(null);
  const agendaCardRef = useRef(null);
  const musicCardRef = useRef(null);
  const notesCardRef = useRef(null);
  const sidebarPanelRatiosRef = useRef({
    agenda: 0,
    music: 0,
    notes: 0,
  });
  const sidebarScrollFrameRef = useRef(null);
  const userInputLevelStateRef = useRef({
    lowStreak: 0,
  });
  const transcriptContainerRef = useRef(null);
  const userSpeechReleaseTimeoutRef = useRef(null);
  const createConversation = useMutation(api.conversations.start);
  const appendConversationMessage = useMutation(api.conversations.appendMessage);
  const finishConversation = useMutation(api.conversations.end);
  const createCalendarEvent = useMutation(api.events.createForCurrent);
  const consumeTodayReminders = useMutation(api.events.consumeTodayRemindersForCurrent);
  const deleteCalendarEvent = useMutation(api.events.deleteForCurrent);
  const createNote = useMutation(api.notes.createForCurrent);
  const deleteNote = useMutation(api.notes.deleteForCurrent);

  function applySpotifySession(nextSession) {
    setSpotifySession(nextSession);
    if (nextSession) {
      saveSpotifySession(nextSession);
    } else {
      clearSpotifySession();
    }
  }

  async function ensureFreshSpotifyAccessToken() {
    if (!spotifySession?.refreshToken) {
      throw new Error("Spotify n'est pas connecté. Cliquez sur Connecter Spotify.");
    }

    if (!hasSpotifySessionExpired(spotifySession) && spotifySession.accessToken) {
      return spotifySession.accessToken;
    }

    const refreshedSession = await refreshSpotifyAccessToken(spotifySession.refreshToken);
    applySpotifySession(refreshedSession);
    return refreshedSession.accessToken;
  }

  async function loadSpotifyAccount(accessToken) {
    const me = await spotifyApiFetch("/me", accessToken);

    if (me?.product !== "premium") {
      throw new Error("Spotify Premium est requis pour la lecture depuis Papote.");
    }

    setSpotifyAccount({
      displayName: me.display_name || "Compte Spotify",
      email: me.email || "",
      product: me.product || "",
    });
  }

  async function ensureSpotifyDevice(accessToken) {
    const resolveDevice = async () => {
      const devicesResponse = await spotifyApiFetch("/me/player/devices", accessToken);
      const devices = Array.isArray(devicesResponse?.devices) ? devicesResponse.devices : [];
      const matchingCachedDevice = spotifyDeviceId
        ? devices.find((device) => device.id === spotifyDeviceId)
        : null;
      const browserDevice = devices.find((device) => device.name === "Papote");
      const activeDevice = devices.find((device) => device.is_active);
      const device = matchingCachedDevice || browserDevice || activeDevice || devices[0];

      return device
        ? {
            id: device.id,
            isActive: Boolean(device.is_active),
          }
        : null;
    };

    let device = await resolveDevice();

    if (!device?.id && spotifyPlayerRef.current?.activateElement) {
      try {
        await spotifyPlayerRef.current.activateElement();
      } catch {
        // Best effort only.
      }

      await wait(450);
      device = await resolveDevice();
    }

    if (!device?.id) {
      setSpotifyDeviceId("");
      throw new Error(
        "Le lecteur Spotify n'est pas encore prêt. Rechargez la page puis cliquez sur Discuter."
      );
    }

    setSpotifyDeviceId(device.id);
    return {
      id: device.id,
      isActive: Boolean(device.is_active),
    };
  }

  async function setSpotifyPlaybackVolume(targetVolume) {
    if (!spotifyPlayerRef.current?.setVolume) {
      return;
    }

    try {
      await spotifyPlayerRef.current.setVolume(targetVolume);
    } catch {
      // Ignore volume sync failures; next voice state change will retry.
    }
  }

  async function startSpotifyTrackPlayback(accessToken, device, trackUri) {
    const transferToDevice = async (targetDevice) => {
      if (!targetDevice?.id || targetDevice.isActive) {
        return;
      }

      await spotifyApiFetch("/me/player", accessToken, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_ids: [targetDevice.id],
          play: false,
        }),
      });
    };

    const playOnDevice = async (targetDevice) => {
      const suffix = targetDevice?.id
        ? `?device_id=${encodeURIComponent(targetDevice.id)}`
        : "";

      await spotifyApiFetch(`/me/player/play${suffix}`, accessToken, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: [trackUri],
        }),
      });
    };

    try {
      await transferToDevice(device);
      await playOnDevice(device);
    } catch (error) {
      if (!isSpotifyDeviceNotFoundError(error)) {
        await wait(350);
        await playOnDevice(device);
        return;
      }

      setSpotifyDeviceId("");
      await wait(450);
      const refreshedDevice = await ensureSpotifyDevice(accessToken);
      await transferToDevice(refreshedDevice);
      await wait(250);
      await playOnDevice(refreshedDevice);
    }
  }

  function handleVadScore(score) {
    if (typeof score !== "number") {
      return;
    }

    if (score >= USER_VAD_ACTIVE_THRESHOLD) {
      activateUserSpeaking();
      return;
    }

    if (score <= USER_VAD_RELEASE_THRESHOLD) {
      scheduleUserSpeakingRelease();
    }
  }

  function markUserSpeaking() {
    activateUserSpeaking();
    scheduleUserSpeakingRelease();
  }

  function activateUserSpeaking() {
    if (userSpeechReleaseTimeoutRef.current) {
      clearTimeout(userSpeechReleaseTimeoutRef.current);
    }

    setIsUserSpeaking(true);
  }

  function scheduleUserSpeakingRelease(delayMs = USER_VAD_RELEASE_DELAY_MS) {
    if (userSpeechReleaseTimeoutRef.current) {
      clearTimeout(userSpeechReleaseTimeoutRef.current);
    }

    userSpeechReleaseTimeoutRef.current = setTimeout(() => {
      setIsUserSpeaking(false);
    }, delayMs);
  }

  async function playSpotifySong(parameters) {
    const searchRequest = buildSpotifySearchQuery(parameters);
    if (!searchRequest.query) {
      throw new Error("Le titre du morceau Spotify est manquant.");
    }

    setIsSpotifyBusy(true);
    setSpotifyError("");

    try {
      const accessToken = await ensureFreshSpotifyAccessToken();
      const [searchResponses, device] = await Promise.all([
        Promise.all(
          searchRequest.queries.map((query) => {
            const searchParams = new URLSearchParams({
              q: query,
              type: "track",
              limit: "10",
              market: "from_token",
            });

            return spotifyApiFetch(`/search?${searchParams.toString()}`, accessToken);
          })
        ),
        ensureSpotifyDevice(accessToken),
      ]);
      const track = selectBestSpotifyTrackMatch(searchResponses, searchRequest);

      if (!track?.uri) {
        throw new Error(
          `Je n'ai pas trouvé de morceau Spotify suffisamment précis pour "${searchRequest.query}".`
        );
      }

      await startSpotifyTrackPlayback(accessToken, device, track.uri);

      const artists = (track.artists || []).map((artist) => artist.name).join(", ");
      const confirmationMessage = `Lecture lancée : ${track.name}${artists ? ` de ${artists}` : ""}.`;

      setSpotifyNowPlaying({
        title: track.name,
        artists,
        album: track.album?.name || "",
        coverUrl: track.album?.images?.[0]?.url || "",
      });
      setActiveSidebarPanel("music");
      setSpotifyPlaybackDurationMs(track.duration_ms || 0);
      setSpotifyPlaybackPositionMs(0);
      setIsSpotifyPlaying(true);
      setSpotifyStatusMessage(confirmationMessage);
      setToolNotice(confirmationMessage);

      return confirmationMessage;
    } finally {
      setIsSpotifyBusy(false);
    }
  }

  async function pauseSpotifyPlayback() {
    setIsSpotifyBusy(true);
    setSpotifyError("");

    try {
      const accessToken = await ensureFreshSpotifyAccessToken();
      const device = await ensureSpotifyDevice(accessToken);
      try {
        await spotifyApiFetch(
          `/me/player/pause?device_id=${encodeURIComponent(device.id)}`,
          accessToken,
          {
            method: "PUT",
          }
        );
      } catch (error) {
        if (!isSpotifyDeviceNotFoundError(error)) {
          throw error;
        }

        setSpotifyDeviceId("");
        await wait(300);
        await spotifyApiFetch("/me/player/pause", accessToken, {
          method: "PUT",
        });
      }

      const confirmationMessage = "Lecture Spotify mise en pause.";
      setActiveSidebarPanel("music");
      setIsSpotifyPlaying(false);
      setSpotifyStatusMessage(confirmationMessage);
      setToolNotice(confirmationMessage);
      return confirmationMessage;
    } finally {
      setIsSpotifyBusy(false);
    }
  }

  async function resumeSpotifyPlayback() {
    setIsSpotifyBusy(true);
    setSpotifyError("");

    try {
      const accessToken = await ensureFreshSpotifyAccessToken();
      const device = await ensureSpotifyDevice(accessToken);
      try {
        await spotifyApiFetch(
          `/me/player/play?device_id=${encodeURIComponent(device.id)}`,
          accessToken,
          {
            method: "PUT",
          }
        );
      } catch (error) {
        if (!isSpotifyDeviceNotFoundError(error)) {
          throw error;
        }

        setSpotifyDeviceId("");
        await wait(300);
        await spotifyApiFetch("/me/player/play", accessToken, {
          method: "PUT",
        });
      }

      const confirmationMessage = "Lecture Spotify reprise.";
      setActiveSidebarPanel("music");
      setIsSpotifyPlaying(true);
      setSpotifyStatusMessage(confirmationMessage);
      setToolNotice(confirmationMessage);
      return confirmationMessage;
    } finally {
      setIsSpotifyBusy(false);
    }
  }

  async function handleCreateNote(parameters) {
    const normalizedNote = normalizeNoteToolParameters(parameters, sessionTimeZone);
    const createdNote = await createNote(normalizedNote);
    const confirmationMessage = `Note enregistrée : ${formatNoteTypeLabel(
      createdNote.noteType
    )} ${buildNoteDateConfirmation(createdNote)}.`;

    setLocalCreatedNotes((current) => mergeNotes(current, [createdNote]));
    setActiveSidebarPanel("notes");
    scrollSidebarPanelIntoView("notes");
    setToolNotice(confirmationMessage);
    setRequestError("");

    return confirmationMessage;
  }

  function openEventFocus(event) {
    setFocusedSurface({ type: "event", item: event });
    setActiveSidebarPanel("agenda");
    scrollSidebarPanelIntoView("agenda");
  }

  function openNoteFocus(note) {
    setFocusedSurface({ type: "note", item: note });
    setActiveSidebarPanel("notes");
    scrollSidebarPanelIntoView("notes");
  }

  async function handleOpenCalendarEvent(parameters) {
    const normalizedEvent = normalizeDeleteCalendarToolParameters(parameters, sessionTimeZone);
    const openedEvent = await convex.query(api.events.findForCurrent, normalizedEvent);

    if (!openedEvent) {
      throw new Error("Aucun évènement correspondant n'a été trouvé à ouvrir.");
    }

    openEventFocus(openedEvent);
    const confirmationMessage = `Évènement ouvert : ${openedEvent.title}.`;
    setToolNotice(confirmationMessage);
    setRequestError("");
    return confirmationMessage;
  }

  async function handleOpenNote(parameters) {
    const normalizedNote = normalizeDeleteNoteToolParameters(parameters);
    const openedNote = await convex.query(api.notes.findForCurrent, normalizedNote);

    if (!openedNote) {
      throw new Error("Aucune note correspondante n'a été trouvée à ouvrir.");
    }

    openNoteFocus(openedNote);
    const confirmationMessage = `Note ouverte : ${truncateText(openedNote.content, 72)}.`;
    setToolNotice(confirmationMessage);
    setRequestError("");
    return confirmationMessage;
  }

  async function handleCloseFocusedSurface() {
    if (!focusedSurface) {
      return "Aucun élément n'est actuellement ouvert.";
    }

    const closedLabel = focusedSurface.type === "note" ? "Note refermée." : "Évènement refermé.";
    setFocusedSurface(null);
    setToolNotice(closedLabel);
    setRequestError("");
    return closedLabel;
  }

  async function handleDeleteCalendarEvent(parameters) {
    const normalizedEvent = normalizeDeleteCalendarToolParameters(parameters, sessionTimeZone);
    const deletedEvent = await deleteCalendarEvent(normalizedEvent);
    const confirmationMessage = `Évènement supprimé : ${deletedEvent.title}.`;

    setLocalCreatedEvents((current) =>
      current.filter((event) => String(event._id) !== String(deletedEvent._id))
    );
    setActiveSidebarPanel("agenda");
    scrollSidebarPanelIntoView("agenda");
    setToolNotice(confirmationMessage);
    setRequestError("");

    return confirmationMessage;
  }

  async function handleDeleteNote(parameters) {
    const normalizedNote = normalizeDeleteNoteToolParameters(parameters);
    const deletedNote = await deleteNote(normalizedNote);
    const confirmationMessage = `Note supprimée : ${truncateText(deletedNote.content, 72)}.`;

    setLocalCreatedNotes((current) =>
      current.filter((note) => String(note._id) !== String(deletedNote._id))
    );
    setActiveSidebarPanel("notes");
    scrollSidebarPanelIntoView("notes");
    setToolNotice(confirmationMessage);
    setRequestError("");

    return confirmationMessage;
  }

  const calendarToolHandlers = {
    createCalendarEvent: handleCreateCalendarEvent,
    create_calendar_event: handleCreateCalendarEvent,
    addCalendarEvent: handleCreateCalendarEvent,
    add_calendar_event: handleCreateCalendarEvent,
    createEvent: handleCreateCalendarEvent,
    addEventToCalendar: handleCreateCalendarEvent,
    ajouterEvenement: handleCreateCalendarEvent,
    ajouter_evenement: handleCreateCalendarEvent,
    ajouterEvenementCalendrier: handleCreateCalendarEvent,
    ajouter_evenement_calendrier: handleCreateCalendarEvent,
    ajouterRendezVous: handleCreateCalendarEvent,
    ajouter_rendez_vous: handleCreateCalendarEvent,
    ajouterRendezvous: handleCreateCalendarEvent,
    ajouter_rendezvous: handleCreateCalendarEvent,
    openCalendarEvent: handleOpenCalendarEvent,
    open_calendar_event: handleOpenCalendarEvent,
    focusCalendarEvent: handleOpenCalendarEvent,
    focus_calendar_event: handleOpenCalendarEvent,
    ouvrirEvenement: handleOpenCalendarEvent,
    ouvrir_evenement: handleOpenCalendarEvent,
    closeFocusedSurface: handleCloseFocusedSurface,
    close_focused_surface: handleCloseFocusedSurface,
    closeNote: handleCloseFocusedSurface,
    close_note: handleCloseFocusedSurface,
    closeCalendarEvent: handleCloseFocusedSurface,
    close_calendar_event: handleCloseFocusedSurface,
    fermerNote: handleCloseFocusedSurface,
    fermer_note: handleCloseFocusedSurface,
    fermerEvenement: handleCloseFocusedSurface,
    fermer_evenement: handleCloseFocusedSurface,
    deleteCalendarEvent: handleDeleteCalendarEvent,
    delete_calendar_event: handleDeleteCalendarEvent,
    removeCalendarEvent: handleDeleteCalendarEvent,
    remove_calendar_event: handleDeleteCalendarEvent,
    supprimerEvenement: handleDeleteCalendarEvent,
    supprimer_evenement: handleDeleteCalendarEvent,
    supprimerRendezVous: handleDeleteCalendarEvent,
    supprimer_rendez_vous: handleDeleteCalendarEvent,
    playSpotifySong: playSpotifySong,
    play_spotify_song: playSpotifySong,
    playSongOnSpotify: playSpotifySong,
    play_song_on_spotify: playSpotifySong,
    playMusicOnSpotify: playSpotifySong,
    play_music_on_spotify: playSpotifySong,
    jouerMusiqueSpotify: playSpotifySong,
    jouer_musique_spotify: playSpotifySong,
    pauseSpotify: pauseSpotifyPlayback,
    pause_spotify: pauseSpotifyPlayback,
    pauseMusic: pauseSpotifyPlayback,
    pause_music: pauseSpotifyPlayback,
    pausePlayback: pauseSpotifyPlayback,
    pause_playback: pauseSpotifyPlayback,
    stopMusic: pauseSpotifyPlayback,
    stop_music: pauseSpotifyPlayback,
    resumeSpotify: resumeSpotifyPlayback,
    resume_spotify: resumeSpotifyPlayback,
    createNote: handleCreateNote,
    create_note: handleCreateNote,
    addNote: handleCreateNote,
    add_note: handleCreateNote,
    saveNote: handleCreateNote,
    save_note: handleCreateNote,
    noterQuelqueChose: handleCreateNote,
    noter_quelque_chose: handleCreateNote,
    openNote: handleOpenNote,
    open_note: handleOpenNote,
    focusNote: handleOpenNote,
    focus_note: handleOpenNote,
    ouvrirNote: handleOpenNote,
    ouvrir_note: handleOpenNote,
    deleteNote: handleDeleteNote,
    delete_note: handleDeleteNote,
    removeNote: handleDeleteNote,
    remove_note: handleDeleteNote,
    supprimerNote: handleDeleteNote,
    supprimer_note: handleDeleteNote,
  };

  async function handleCreateCalendarEvent(parameters) {
    const normalizedEvent = normalizeCalendarToolParameters(parameters, sessionTimeZone);
    const createdEvent = await createCalendarEvent(normalizedEvent);
    const confirmationMessage = `Rendez-vous ajouté : ${createdEvent.title} le ${formatEventDate(
      createdEvent.startAt
    )}.`;

    setLocalCreatedEvents((current) => mergeEvents(current, [createdEvent]));
    setActiveSidebarPanel("agenda");
    scrollSidebarPanelIntoView("agenda");
    setToolNotice(confirmationMessage);
    setRequestError("");

    return confirmationMessage;
  }

  async function connectSpotify() {
    setSpotifyError("");
    setSpotifyStatusMessage("");
    beginSpotifyAuthorization();
  }

  function disconnectSpotify() {
    spotifyPlayerRef.current?.disconnect?.();
    spotifyPlayerRef.current = null;
    setSpotifyAccount(null);
    setSpotifyDeviceId("");
    setSpotifyNowPlaying(null);
    setSpotifyStatusMessage("");
    setSpotifyError("");
    setIsSpotifyReady(false);
    applySpotifySession(null);
  }

  useEffect(() => {
    const existingSession = loadSpotifySession();
    if (existingSession) {
      setSpotifySession(existingSession);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (!code && !error) {
      return;
    }

    window.history.replaceState({}, document.title, `${url.origin}${url.pathname}`);

    if (error) {
      setSpotifyError("La connexion Spotify a été refusée.");
      return;
    }

    let isMounted = true;

    async function finalizeSpotifyLogin() {
      setIsSpotifyBusy(true);
      setSpotifyError("");

      try {
        const session = await exchangeSpotifyCodeForTokens({ code, state });
        if (!isMounted) {
          return;
        }

        applySpotifySession(session);
        await loadSpotifyAccount(session.accessToken);
        if (isMounted) {
          setSpotifyStatusMessage("Spotify est connecté. Papote peut maintenant lancer la lecture.");
        }
      } catch (loginError) {
        if (isMounted) {
          setSpotifyError(describeError(loginError));
        }
      } finally {
        if (isMounted) {
          setIsSpotifyBusy(false);
        }
      }
    }

    void finalizeSpotifyLogin();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!spotifySession?.accessToken) {
      return;
    }

    let isMounted = true;

    async function hydrateSpotifyAccount() {
      try {
        const accessToken = await ensureFreshSpotifyAccessToken();
        await loadSpotifyAccount(accessToken);
      } catch (accountError) {
        if (isMounted) {
          setSpotifyError(describeError(accountError));
        }
      }
    }

    void hydrateSpotifyAccount();

    return () => {
      isMounted = false;
    };
  }, [spotifySession?.accessToken]);

  useEffect(() => {
    if (!spotifySession?.accessToken || typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    async function initializeSpotifyPlayer() {
      if (spotifyPlayerRef.current) {
        return;
      }

      try {
        const SpotifySdk = await loadSpotifySdk(spotifySdkPromiseRef);
        if (cancelled || !SpotifySdk) {
          return;
        }

        const player = new SpotifySdk.Player({
          name: "Papote",
          volume: 0.9,
          getOAuthToken: (callback) => {
            void ensureFreshSpotifyAccessToken()
              .then((token) => callback(token))
              .catch((playerError) => {
                setSpotifyError(describeError(playerError));
              });
          },
        });

        player.addListener("ready", ({ device_id: deviceId }) => {
          setSpotifyDeviceId(deviceId);
          setIsSpotifyReady(true);
          setSpotifyStatusMessage((current) => current || "Le lecteur Spotify de Papote est prêt.");
        });

        player.addListener("not_ready", () => {
          setIsSpotifyReady(false);
          setSpotifyDeviceId("");
        });

        player.addListener("player_state_changed", (state) => {
          const currentTrack = state?.track_window?.current_track;
          setSpotifyPlaybackPositionMs(state?.position || 0);
          setSpotifyPlaybackDurationMs(state?.duration || 0);
          setIsSpotifyPlaying(!state?.paused);

          if (!currentTrack) {
            return;
          }

          setSpotifyNowPlaying({
            title: currentTrack.name,
            artists: (currentTrack.artists || []).map((artist) => artist.name).join(", "),
            album: currentTrack.album?.name || "",
            coverUrl: currentTrack.album?.images?.[0]?.url || "",
          });
        });

        player.addListener("authentication_error", ({ message }) => {
          setSpotifyError(message || "Spotify a refusé l'authentification du lecteur.");
        });

        player.addListener("account_error", ({ message }) => {
          setSpotifyError(message || "Spotify Premium est requis pour la lecture.");
        });

        player.addListener("playback_error", ({ message }) => {
          setSpotifyError(message || "La lecture Spotify a échoué.");
        });

        await player.connect();
        spotifyPlayerRef.current = player;
      } catch (playerError) {
        if (!cancelled) {
          setSpotifyError(describeError(playerError));
        }
      }
    }

    void initializeSpotifyPlayer();

    return () => {
      cancelled = true;
    };
  }, [spotifySession?.accessToken]);

  useEffect(() => {
    if (!spotifyPlayerRef.current || !spotifySession?.accessToken || !spotifyAccount) {
      return;
    }

    const intervalId = setInterval(() => {
      spotifyPlayerRef.current
        .getCurrentState()
        .then((state) => {
          if (!state) {
            return;
          }

          setSpotifyPlaybackPositionMs(state.position || 0);
          setSpotifyPlaybackDurationMs(state.duration || 0);
          setIsSpotifyPlaying(!state.paused);
        })
        .catch(() => {
          // Silent polling failure; the next cycle will retry.
        });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [spotifySession?.accessToken, spotifyAccount, isSpotifyReady]);

  const conversation = useConversation({
    clientTools: calendarToolHandlers,
    onConnect: () => {
      setRequestError("");
      setToolNotice("");
    },
    onDisconnect: (details) => {
      const activeConversationId = activeConversationRef.current;
      if (activeConversationId) {
        void finishConversation({ externalId: activeConversationId }).catch((error) => {
          setRequestError(describeError(error));
        });
        activeConversationRef.current = null;
      }

      if (userSpeechReleaseTimeoutRef.current) {
        clearTimeout(userSpeechReleaseTimeoutRef.current);
      }

      setIsUserSpeaking(false);
      setIsConnecting(false);
    },
    onError: (error) => {
      if (userSpeechReleaseTimeoutRef.current) {
        clearTimeout(userSpeechReleaseTimeoutRef.current);
      }

      setIsUserSpeaking(false);
      setIsConnecting(false);
      setRequestError(describeError(error));
    },
    onVadScore: handleVadScore,
    onInterruption: () => {
      markUserSpeaking();
    },
    onModeChange: (mode) => {
      if (mode === "speaking") {
        setIsUserSpeaking(false);
      }
    },
    onUnhandledClientToolCall: async (toolCall) => {
      const toolName = extractToolName(toolCall);
      const parameters = extractToolParameters(toolCall);

      if (looksLikeCloseTool(toolName)) {
        return await handleCloseFocusedSurface();
      }

      if (looksLikeOpenTool(toolName)) {
        if (looksLikeNoteTool(toolName)) {
          return await handleOpenNote(parameters);
        }

        if (looksLikeCalendarTool(toolName)) {
          return await handleOpenCalendarEvent(parameters);
        }
      }

      if (looksLikeDeleteTool(toolName)) {
        if (looksLikeNoteTool(toolName)) {
          return await handleDeleteNote(parameters);
        }

        if (looksLikeCalendarTool(toolName)) {
          return await handleDeleteCalendarEvent(parameters);
        }
      }

      if (looksLikeCalendarTool(toolName)) {
        return await handleCreateCalendarEvent(parameters);
      }

      if (looksLikeSpotifyTool(toolName)) {
        const normalizedToolName = normalizeToolIdentifier(toolName);
        if (normalizedToolName.includes("pause")) {
          return await pauseSpotifyPlayback();
        }

        if (normalizedToolName.includes("resume")) {
          return await resumeSpotifyPlayback();
        }

        return await playSpotifySong(parameters);
      }

      if (looksLikeNoteTool(toolName)) {
        return await handleCreateNote(parameters);
      }

      setRequestError(`Outil client ElevenLabs introuvable : ${toolName || "nom inconnu"}.`);
      return undefined;
    },
    onMessage: (message) => {
      const text = sanitizeVisibleText(extractText(message));
      const role = extractRole(message);
      const timestamp = formatter.format(new Date());
      const sidebarPanel = inferSidebarPanelFromText(text);

      if (role === "user" && sidebarPanel) {
        setActiveSidebarPanel(sidebarPanel);
      }

      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-${current.length}`,
          role,
          text,
          timestamp,
        },
      ]);

      if (activeConversationRef.current && (role === "agent" || role === "user")) {
        void appendConversationMessage({
          externalId: activeConversationRef.current,
          role,
          text,
          timestamp,
        }).catch((error) => {
          setRequestError(describeError(error));
        });
      }
    },
  });

  const { status, isSpeaking } = conversation;
  const trialIsExhausted = profile.isTrialExhausted;
  const mergedUpcomingEvents = useMemo(
    () => mergeEvents(localCreatedEvents, upcomingEvents),
    [localCreatedEvents, upcomingEvents]
  );
  const mergedRecentNotes = useMemo(
    () => mergeNotes(localCreatedNotes, recentNotes),
    [localCreatedNotes, recentNotes]
  );
  const sidebarPanelRefs = useMemo(
    () => ({
      agenda: agendaCardRef,
      music: musicCardRef,
      notes: notesCardRef,
    }),
    []
  );
  const spotifyConnected = Boolean(spotifySession?.accessToken && spotifyAccount);
  const remainingCredits = Math.max(0, profile.creditsRemaining || 0);
  const targetSpotifyVolume = isUserSpeaking
    ? SPOTIFY_USER_DUCKED_VOLUME
    : isSpeaking
      ? SPOTIFY_AGENT_DUCKED_VOLUME
      : SPOTIFY_NORMAL_VOLUME;

  const statusLabel = useMemo(() => {
    if (trialIsExhausted) {
      return "Essai terminé";
    }

    switch (status) {
      case "connected":
        return "En ligne";
      case "connecting":
        return "Connexion";
      case "disconnecting":
        return "Fin";
      default:
        return "Prêt";
    }
  }, [status, trialIsExhausted]);

  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (!spotifySession?.accessToken || !spotifyPlayerRef.current || !isSpotifyReady) {
      return;
    }

    void setSpotifyPlaybackVolume(targetSpotifyVolume);
  }, [spotifySession?.accessToken, isSpotifyReady, targetSpotifyVolume]);

  useEffect(() => {
    const root = sidebarScrollContainerRef.current;
    if (!root) {
      return;
    }
    const measurePanels = () => {
      const rootRect = root.getBoundingClientRect();
      const rootCenter = rootRect.top + rootRect.height / 2;
      let bestPanel = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const [panel, ref] of Object.entries(sidebarPanelRefs)) {
        const element = ref.current;
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const visibleHeight =
          Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top);
        const ratio = Math.max(0, Math.min(1, visibleHeight / Math.max(rect.height, 1)));
        sidebarPanelRatiosRef.current[panel] = ratio;

        const panelCenter = rect.top + rect.height / 2;
        const distance = Math.abs(panelCenter - rootCenter);
        if (ratio > 0.1 && distance < bestDistance) {
          bestDistance = distance;
          bestPanel = panel;
        }
      }

      setRevealedSidebarPanels((current) => {
        const nextPanels = { ...current };
        let hasChanged = false;

        for (const [panel, ratio] of Object.entries(sidebarPanelRatiosRef.current)) {
          if (!current[panel] && ratio > 0.08) {
            nextPanels[panel] = true;
            hasChanged = true;
          }
        }

        return hasChanged ? nextPanels : current;
      });

      if (bestPanel) {
        setActiveSidebarPanel((current) => (current === bestPanel ? current : bestPanel));
      }
    };

    const handleScroll = () => {
      if (sidebarScrollFrameRef.current) {
        cancelAnimationFrame(sidebarScrollFrameRef.current);
      }

      sidebarScrollFrameRef.current = requestAnimationFrame(measurePanels);
    };

    measurePanels();
    root.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      if (sidebarScrollFrameRef.current) {
        cancelAnimationFrame(sidebarScrollFrameRef.current);
        sidebarScrollFrameRef.current = null;
      }

      root.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [sidebarPanelRefs]);

  useEffect(() => {
    if (status !== "connected") {
      userInputLevelStateRef.current.lowStreak = 0;
      return;
    }

    let cancelled = false;
    const intervalId = setInterval(() => {
      const getInputVolume = conversation?.getInputVolume;
      if (typeof getInputVolume !== "function") {
        return;
      }

      Promise.resolve(getInputVolume.call(conversation))
        .then((inputVolume) => {
          if (cancelled || typeof inputVolume !== "number") {
            return;
          }

          if (inputVolume >= USER_INPUT_VOLUME_ACTIVE_THRESHOLD) {
            userInputLevelStateRef.current.lowStreak = 0;
            activateUserSpeaking();
            return;
          }

          if (inputVolume <= USER_INPUT_VOLUME_RELEASE_THRESHOLD) {
            userInputLevelStateRef.current.lowStreak += 1;
            if (userInputLevelStateRef.current.lowStreak >= USER_INPUT_LOW_STREAK_TO_RELEASE) {
              scheduleUserSpeakingRelease(180);
            }
            return;
          }

          userInputLevelStateRef.current.lowStreak = 0;
        })
        .catch(() => {
          // Ignore transient meter failures; the next poll will retry.
        });
    }, USER_INPUT_VOLUME_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [conversation, status]);

  useEffect(() => {
    return () => {
      if (userSpeechReleaseTimeoutRef.current) {
        clearTimeout(userSpeechReleaseTimeoutRef.current);
      }
    };
  }, []);

  async function startConversation() {
    if (trialIsExhausted) {
      setRequestError(TRIAL_EXHAUSTED_MESSAGE);
      return;
    }

    if (!AGENT_ID.trim()) {
      setRequestError("L'identifiant de l'agent est introuvable dans la configuration.");
      return;
    }

    if (status === "connected" || status === "connecting" || isConnecting) {
      return;
    }

    setIsConnecting(true);
    setRequestError("");
    setToolNotice("");

    let startedConversationId = "";

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const dateContext = await buildConversationDateContext(profile);
      const todayBounds = buildDayBounds(dateContext.iso, dateContext.timeZone);
      setSessionTimeZone(dateContext.timeZone || "UTC");

      if (spotifyConnected && spotifyPlayerRef.current?.activateElement) {
        try {
          await spotifyPlayerRef.current.activateElement();
        } catch {
          // Best effort only. The browser may still allow playback on another active device.
        }
      }

      const response = await fetch("/api/signed-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: AGENT_ID.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.signedUrl) {
        throw new Error(data.error || "Impossible de récupérer une session de conversation.");
      }

      setMessages([]);

      startedConversationId = await conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        dynamicVariables: buildDynamicVariables(
          profile,
          recentConversations,
          mergedUpcomingEvents,
          mergedRecentNotes,
          dateContext,
          [],
          {
            connected: spotifyConnected,
            ready: isSpotifyReady,
            nowPlaying: spotifyNowPlaying,
          }
        ),
        workletPaths: {
          rawAudioProcessor: "/elevenlabs/rawAudioProcessor.worklet.js",
          audioConcatProcessor: "/elevenlabs/audioConcatProcessor.worklet.js",
        },
      });

      activeConversationRef.current = startedConversationId;
      await createConversation({ externalId: startedConversationId });
      const todayReminderEvents = await consumeTodayReminders(todayBounds);
      setLocalCreatedEvents([]);
      setLocalCreatedNotes([]);

      if (todayReminderEvents.length > 0) {
        setActiveSidebarPanel("agenda");
      }

      conversation.sendContextualUpdate(
        buildProfileContext(
          profile,
          recentConversations,
          mergedUpcomingEvents,
          mergedRecentNotes,
          todayReminderEvents,
          dateContext,
          {
            connected: spotifyConnected,
            ready: isSpotifyReady,
            nowPlaying: spotifyNowPlaying,
          }
        )
      );
    } catch (error) {
      if (startedConversationId) {
        activeConversationRef.current = null;
        try {
          await conversation.endSession();
        } catch {
          // Best effort shutdown when server-side gating refuses the call.
        }
      }

      setRequestError(describeError(error));
    } finally {
      setIsConnecting(false);
    }
  }

  async function endConversation() {
    if (status !== "connected") {
      return;
    }

    await conversation.endSession();
  }

  function scrollSidebarPanelIntoView(panel) {
    const element = sidebarPanelRefs[panel]?.current;
    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }

  function toggleSidebarPanel(panel) {
    setActiveSidebarPanel((current) => {
      const nextPanel = current === panel ? null : panel;
      if (nextPanel) {
        scrollSidebarPanelIntoView(nextPanel);
      }
      return nextPanel;
    });
  }

  const isAgendaPanelActive = activeSidebarPanel === "agenda";
  const isMusicPanelActive = activeSidebarPanel === "music";
  const isNotesPanelActive = activeSidebarPanel === "notes";
  const canToggleConversation = !(trialIsExhausted || isConnecting || status === "disconnecting");
  const orbCallLabel = status === "connected" ? "Terminer l'appel" : "Démarrer l'appel";
  const orbAgentState =
    status === "connected" ? (isSpeaking ? "talking" : "listening") : null;

  return (
    <main className="relative h-[100svh] overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(184,126,177,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(0,127,112,0.16),transparent_24%),linear-gradient(180deg,#fffefd_0%,#f4fbf9_48%,#f7eef7_100%)] text-[#0d3d38]">
      <div className="mx-auto grid h-full w-full max-w-7xl gap-6 px-6 py-4 sm:px-8 sm:py-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-10 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="hidden h-full min-h-0 lg:flex">
          <div
            ref={sidebarScrollContainerRef}
            className="flex min-h-0 flex-1 snap-y snap-mandatory flex-col gap-4 overflow-y-auto pr-2 [scrollbar-width:none]"
          >
            <section
              ref={agendaCardRef}
              data-panel="agenda"
              className={`snap-start rounded-[32px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,251,249,0.84))] shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl transition-all duration-700 ${
                revealedSidebarPanels.agenda
                  ? "translate-y-0 opacity-100"
                  : "translate-y-8 opacity-0"
              } ${isAgendaPanelActive ? "scale-[1.01] shadow-[0_30px_90px_rgba(0,127,112,0.14)]" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleSidebarPanel("agenda")}
                className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#e8f7f4] text-[#007f70] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <CalendarDays className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-[1.1rem] text-[#143d38]">Agenda</CardTitle>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-[#7a8f8b]">
                      {mergedUpcomingEvents.length} à venir
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`size-5 text-[#64807b] transition-transform duration-500 ${
                    isAgendaPanelActive ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-500 ${
                  isAgendaPanelActive ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-70"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="grid max-h-[26rem] gap-3 overflow-y-auto px-5 pb-5 pr-4">
                    {mergedUpcomingEvents.length === 0 ? (
                      <div className="flex min-h-44 flex-col justify-center rounded-[28px] border border-dashed border-[#007f70]/12 bg-white/66 px-5 text-center">
                        <p className="text-sm font-medium text-[#244f49]">
                          Aucun évènement à venir.
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#72908b]">
                          Demandez à Papote d&apos;en ajouter un pour lancer votre journée.
                        </p>
                      </div>
                    ) : (
                      mergedUpcomingEvents.map((event) => (
                        <button
                          key={event._id}
                          type="button"
                          onClick={() => openEventFocus(event)}
                          className="group rounded-[28px] border border-[#007f70]/10 bg-white/84 px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[#007f70]/22 hover:shadow-[0_16px_32px_rgba(0,127,112,0.08)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7a8f8b]">
                              {formatEventDate(event.startAt)}
                            </p>
                            <span className="rounded-full bg-[#eef8f6] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#5e827b] transition-colors group-hover:bg-[#e4f5f1]">
                              Ouvrir
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-[#173f3a]">
                            {event.title}
                          </p>
                          {Number.isFinite(event.endAt) ? (
                            <p className="mt-2 text-sm leading-6 text-[#5f7b76]">
                              Jusqu&apos;à {formatEventTime(event.endAt)}
                            </p>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section
              ref={musicCardRef}
              data-panel="music"
              className={`snap-start rounded-[32px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(243,251,246,0.86))] shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl transition-all duration-700 ${
                revealedSidebarPanels.music
                  ? "translate-y-0 opacity-100"
                  : "translate-y-8 opacity-0"
              } ${isMusicPanelActive ? "scale-[1.01] shadow-[0_30px_90px_rgba(18,185,89,0.12)]" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleSidebarPanel("music")}
                className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#e7f9ee] text-[#1db954] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <Music4 className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-[1.1rem] text-[#143d38]">Musique</CardTitle>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-[#7a8f8b]">
                      {spotifyConnected ? "Session active" : "Spotify"}
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`size-5 text-[#64807b] transition-transform duration-500 ${
                    isMusicPanelActive ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-500 ${
                  isMusicPanelActive ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-70"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="space-y-4 px-5 pb-5">
              <div className="rounded-[28px] border border-[#1db954]/12 bg-white/74 px-4 py-4 text-left">
                <p className="text-xs uppercase tracking-[0.22em] text-[#6f8d83]">
                  {spotifyConnected ? "Connecté" : "Non connecté"}
                </p>
                <p className="mt-2 text-sm font-semibold text-[#173f3a]">
                  {spotifyConnected
                    ? spotifyAccount?.displayName || "Compte Spotify connecté"
                    : "Connectez Spotify pour laisser Papote lancer vos morceaux."}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#5f7b76]">
                  {spotifyNowPlaying
                    ? `En cours : ${spotifyNowPlaying.title}${
                        spotifyNowPlaying.artists ? `, ${spotifyNowPlaying.artists}` : ""
                      }.`
                    : spotifyStatusMessage ||
                      "Demandez une chanson, puis laissez Papote piloter la lecture."}
                </p>
              </div>

              {spotifyError ? (
                <div className="rounded-2xl border border-red-300/40 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {spotifyError}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={spotifyConnected ? disconnectSpotify : connectSpotify}
                  disabled={isSpotifyBusy}
                  className="rounded-full"
                >
                  <Music4 className="size-4" />
                  {spotifyConnected ? "Déconnecter Spotify" : "Connecter Spotify"}
                </Button>

                {spotifyConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void pauseSpotifyPlayback().catch((error) =>
                        setSpotifyError(describeError(error))
                      )
                    }
                    disabled={isSpotifyBusy}
                    className="rounded-full"
                  >
                    <PauseCircle className="size-4" />
                    Pause
                  </Button>
                ) : null}
              </div>

              {spotifyNowPlaying ? (
                <div className="rounded-[28px] border border-[#007f70]/10 bg-white/80 p-4 text-left shadow-[0_16px_40px_rgba(0,127,112,0.06)]">
                  <div className="flex items-center gap-4">
                    {spotifyNowPlaying.coverUrl ? (
                      <img
                        src={spotifyNowPlaying.coverUrl}
                        alt={`Pochette de ${spotifyNowPlaying.title}`}
                        className="h-20 w-20 rounded-2xl object-cover shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#eef8f3] text-[#1db954]">
                        <Music4 className="size-8" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#173f3a]">
                        {spotifyNowPlaying.title}
                      </p>
                      <p className="mt-1 truncate text-sm text-[#5f7b76]">
                        {spotifyNowPlaying.artists || "Artiste inconnu"}
                      </p>
                      <p className="mt-1 truncate text-xs text-[#7a8f8b]">
                        {spotifyNowPlaying.album || "Album inconnu"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-[#dceee7]">
                      <div
                        className="h-full rounded-full bg-[#1db954] transition-[width] duration-500"
                        style={{
                          width: `${
                            spotifyPlaybackDurationMs > 0
                              ? Math.min(
                                  100,
                                  (spotifyPlaybackPositionMs / spotifyPlaybackDurationMs) * 100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#72908b]">
                      <span>{formatPlaybackTime(spotifyPlaybackPositionMs)}</span>
                      <span>{formatPlaybackTime(spotifyPlaybackDurationMs)}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void (isSpotifyPlaying ? pauseSpotifyPlayback() : resumeSpotifyPlayback()).catch(
                          (error) => setSpotifyError(describeError(error))
                        )
                      }
                      disabled={isSpotifyBusy}
                      className="rounded-full"
                    >
                      {isSpotifyPlaying ? "Pause" : "Lecture"}
                    </Button>
                    <p className="text-xs text-[#64807b]">
                      {isSpotifyPlaying ? "Lecture en cours" : "Lecture en pause"}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex items-start gap-3 rounded-[24px] border border-[#007f70]/10 bg-white/70 px-4 py-3 text-left">
                <CheckCircle2 className="mt-0.5 size-4 text-[#007f70]" />
                <p className="text-xs leading-5 text-[#64807b]">
                  {isSpotifyReady
                    ? "Le lecteur de Papote est prêt. Le scroll et la voix gardent ce panneau vivant."
                    : "Laissez la page ouverte après connexion pendant que le lecteur se prépare."}
                </p>
              </div>
                  </div>
                </div>
              </div>
            </section>

            <section
              ref={notesCardRef}
              data-panel="notes"
              className={`snap-start rounded-[32px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(247,244,250,0.86))] shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl transition-all duration-700 ${
                revealedSidebarPanels.notes
                  ? "translate-y-0 opacity-100"
                  : "translate-y-8 opacity-0"
              } ${isNotesPanelActive ? "scale-[1.01] shadow-[0_30px_90px_rgba(184,126,177,0.12)]" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleSidebarPanel("notes")}
                className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#f5eef7] text-[#8d5d91] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <FileText className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-[1.1rem] text-[#143d38]">Notes</CardTitle>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-[#7a8f8b]">
                      {mergedRecentNotes.length} enregistrées
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`size-5 text-[#64807b] transition-transform duration-500 ${
                    isNotesPanelActive ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-500 ${
                  isNotesPanelActive ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-70"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="grid max-h-[24rem] gap-3 overflow-y-auto px-5 pb-5 pr-4">
                    {mergedRecentNotes.length === 0 ? (
                      <div className="flex min-h-40 flex-col justify-center rounded-[28px] border border-dashed border-[#007f70]/12 bg-white/68 px-5 text-center">
                        <p className="text-sm font-medium text-[#244f49]">
                          Aucune note enregistrée.
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#72908b]">
                          Demandez à Papote de noter une info, un contact ou une idée.
                        </p>
                      </div>
                    ) : (
                      mergedRecentNotes.map((note) => (
                        <button
                          key={note._id}
                          type="button"
                          onClick={() => openNoteFocus(note)}
                          className="group rounded-[28px] border border-[#b87eb1]/12 bg-white/84 px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b87eb1]/24 hover:shadow-[0_16px_32px_rgba(184,126,177,0.08)]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-[#7a8f8b]">
                              {formatNoteTypeLabel(note.noteType)}
                            </p>
                            <span className="rounded-full bg-[#f7eff8] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#8b6a90] transition-colors group-hover:bg-[#f3e7f5]">
                              Ouvrir
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.15em] text-[#91a09d]">
                            {formatStoredNoteDate(note)}
                          </p>
                          <p className="mt-3 text-sm leading-6 text-[#173f3a]">{note.content}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>

        <section className="flex h-full min-h-0 flex-col items-center justify-center py-3 text-center">
          <div className="absolute right-6 top-4 z-10 sm:right-8 sm:top-6 lg:right-10">
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  userButtonAvatarBox:
                    "h-11 w-11 rounded-full border border-[#007f70]/12 shadow-[0_12px_30px_rgba(0,127,112,0.08)]",
                },
              }}
            />
          </div>

          <div className="mb-5 flex items-center justify-center">
            <Image
              src="/L7SEVrpysBPlGP9kfcdn6L0MOR0.avif"
              alt="Logo Papote"
              width={196}
              height={196}
              className="h-28 w-28 object-contain sm:h-32 sm:w-32 lg:h-36 lg:w-36"
              priority
            />
          </div>
          <button
            type="button"
            onClick={status === "connected" ? endConversation : startConversation}
            disabled={!canToggleConversation}
            aria-label={orbCallLabel}
            className={`group relative mt-5 flex aspect-square w-[min(38vh,19rem)] shrink-0 items-center justify-center rounded-full sm:mt-6 sm:w-[min(40vh,22rem)] lg:w-[min(42vh,24rem)] ${
              canToggleConversation ? "cursor-pointer" : "cursor-not-allowed opacity-70"
            }`}
          >
            <div className="absolute inset-0 rounded-full border border-white/80 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.92),rgba(246,250,249,0.85)_46%,rgba(244,234,244,0.86)_100%)] shadow-[0_30px_120px_rgba(0,127,112,0.15)] backdrop-blur-xl transition-transform duration-500 group-hover:scale-[1.015]" />
            <Orb
              agentState={orbAgentState}
              colors={["#5ed1c1", "#c38fbc"]}
              getInputVolume={() =>
                typeof conversation.getInputVolume === "function"
                  ? conversation.getInputVolume()
                  : 0
              }
              getOutputVolume={() =>
                typeof conversation.getOutputVolume === "function"
                  ? conversation.getOutputVolume()
                  : isSpeaking
                    ? 0.82
                    : 0
              }
              seed={371}
              className="relative z-10 mx-auto my-[12%] size-[76%]"
            />
            <div className="absolute inset-x-0 bottom-[14%] z-20 flex justify-center">
              <div
                className={`flex size-16 items-center justify-center rounded-full border shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition-all duration-300 sm:size-18 ${
                  status === "connected"
                    ? "border-[#ffb8be]/60 bg-[#b6505f] text-white"
                    : "border-[#cfe7e2] bg-white/95 text-[#0d3d38]"
                } ${canToggleConversation ? "group-hover:-translate-y-1" : ""}`}
              >
                {status === "connected" ? (
                  <PhoneOff className="size-6 sm:size-7" />
                ) : (
                  <Phone className="size-6 sm:size-7" />
                )}
              </div>
            </div>
          </button>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Badge
              variant="secondary"
              className="rounded-full border border-[#007f70]/10 bg-white/85 px-4 py-2 text-[#0d3d38] shadow-[0_12px_30px_rgba(0,127,112,0.08)]"
            >
              <span className="inline-flex size-2.5 rounded-full bg-[#007f70] shadow-[0_0_14px_rgba(0,127,112,0.35)]" />
              {statusLabel}
            </Badge>
            <Badge
              variant="secondary"
              className="rounded-full border border-[#b87eb1]/15 bg-white/85 px-4 py-2 text-[#5d4460] shadow-[0_12px_30px_rgba(184,126,177,0.08)]"
            >
              <Clock3 className="size-4" />
              {trialIsExhausted
                ? "Essai bêta terminé"
                : `${formatCredits(remainingCredits)} crédits restants`}
            </Badge>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={spotifyConnected ? disconnectSpotify : connectSpotify}
              disabled={isSpotifyBusy}
              className="rounded-full lg:hidden"
            >
              <Music4 className="size-4" />
              {spotifyConnected ? "Musique connectée" : "Connecter Musique"}
            </Button>
          </div>

          {requestError ? (
            <div className="mt-4 max-w-xl rounded-2xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[0_12px_30px_rgba(239,68,68,0.08)]">
              {requestError}
            </div>
          ) : null}

          {!requestError && toolNotice ? (
            <div className="mt-4 max-w-xl rounded-2xl border border-[#007f70]/15 bg-[#f2fbf9] px-4 py-3 text-sm text-[#19514a] shadow-[0_12px_30px_rgba(0,127,112,0.08)]">
              {toolNotice}
            </div>
          ) : null}

        </section>

        <aside className="hidden h-full min-h-0 xl:flex xl:flex-col">
          <Card className="flex h-full min-h-0 flex-col border border-white/80 bg-white/76 shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl">
            <CardHeader className="border-b border-[#007f70]/10">
              <CardTitle className="flex items-center gap-2 text-xl">
                <AudioLines className="size-5 text-[#007f70]" />
                Fil en direct
              </CardTitle>
              <CardDescription>
                La conversation s&apos;affiche ici en temps réel.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden p-4">
              <div ref={transcriptContainerRef} className="grid flex-1 gap-3 overflow-y-auto pr-1">
                {messages.length === 0 ? (
                  <div className="flex min-h-48 flex-col items-center justify-center rounded-3xl border border-dashed border-[#007f70]/15 bg-[#f5fbfa] px-5 text-center">
                    <MessageSquare className="size-7 text-[#84a7a1]" />
                    <p className="mt-4 text-sm font-medium text-[#244f49]">
                      Aucun message pour le moment
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#72908b]">
                      Lancez la conversation pour voir apparaître le fil de transcription.
                    </p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article
                      key={message.id}
                      className={`rounded-3xl border px-4 py-4 text-left ${
                        message.role === "agent"
                          ? "border-[#007f70]/10 bg-[#f2fbf9]"
                          : message.role === "user"
                            ? "border-[#b87eb1]/15 bg-[#faf4fa]"
                            : "border-[#007f70]/8 bg-white/70"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-[#7a8f8b]">
                        <span>
                          {message.role === "agent"
                            ? "Papote"
                            : message.role === "user"
                              ? "Vous"
                              : "Système"}
                        </span>
                        <span>{message.timestamp}</span>
                      </div>
                      <p className="text-sm leading-6 text-[#234743]">{message.text}</p>
                    </article>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {focusedSurface ? (
        <div className="absolute inset-0 z-30 bg-[linear-gradient(180deg,rgba(10,34,31,0.24),rgba(10,34,31,0.42))] backdrop-blur-md">
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-4 sm:px-8 lg:px-10">
              <div className="rounded-full border border-white/20 bg-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-white/82">
                {focusedSurface.type === "note" ? "Note ouverte" : "Évènement ouvert"}
              </div>
              <button
                type="button"
                onClick={() => setFocusedSurface(null)}
                className="flex size-12 items-center justify-center rounded-full border border-white/20 bg-white/12 text-white transition-colors hover:bg-white/20"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-stretch justify-center px-4 pb-4 sm:px-8 sm:pb-8 lg:px-12">
              <div className="flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.2),rgba(255,255,255,0.08))] text-left shadow-[0_40px_120px_rgba(0,0,0,0.25)] backdrop-blur-2xl sm:rounded-[34px]">
                <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-10 lg:p-14">
                {focusedSurface.type === "note" ? (
                  <>
                    <p className="text-[11px] uppercase tracking-[0.32em] text-white/68">
                      {formatNoteTypeLabel(focusedSurface.item.noteType)}
                    </p>
                    <p className="mt-3 text-sm uppercase tracking-[0.22em] text-white/52">
                      {formatStoredNoteDate(focusedSurface.item)}
                    </p>
                    <p className="mt-8 max-w-4xl text-2xl font-semibold leading-[1.2] tracking-[-0.04em] text-white sm:text-4xl lg:text-6xl">
                      {focusedSurface.item.content}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] uppercase tracking-[0.32em] text-white/68">
                      Agenda
                    </p>
                    <p className="mt-3 text-sm uppercase tracking-[0.22em] text-white/52">
                      {formatEventDate(focusedSurface.item.startAt)}
                    </p>
                    <p className="mt-8 max-w-4xl text-2xl font-semibold leading-[1.2] tracking-[-0.04em] text-white sm:text-4xl lg:text-6xl">
                      {focusedSurface.item.title}
                    </p>
                    <div className="mt-10 flex flex-wrap gap-3">
                      <div className="rounded-full border border-white/18 bg-white/10 px-4 py-2 text-sm text-white/82">
                        Début : {formatEventTime(focusedSurface.item.startAt)}
                      </div>
                      {Number.isFinite(focusedSurface.item.endAt) ? (
                        <div className="rounded-full border border-white/18 bg-white/10 px-4 py-2 text-sm text-white/82">
                          Fin : {formatEventTime(focusedSurface.item.endAt)}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {trialIsExhausted ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#143c38]/35 px-6 backdrop-blur-sm">
          <Card className="w-full max-w-xl border border-white/80 bg-white/92 shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl text-[#173f3a]">
                <ShieldAlert className="size-7 text-[#b6505f]" />
                Essai terminé
              </CardTitle>
              <CardDescription className="text-base leading-7 text-[#5f7470]">
                {TRIAL_EXHAUSTED_MESSAGE}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-[#4b6661]">
              <p>
                Vous avez consommé {formatCredits(profile.creditsUsed)} crédits sur{" "}
                {formatCredits(profile.creditsOffered)} crédits offerts.
              </p>
              <p>
                Cette version est encore en bêta, il n&apos;y a donc pas encore d&apos;abonnement
                disponible pour continuer.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

function extractText(message) {
  if (!message) return "Message vide reçu.";
  if (typeof message === "string") return message;

  if (typeof message.message === "string" && message.message.trim()) {
    return message.message;
  }

  if (typeof message.text === "string" && message.text.trim()) {
    return message.text;
  }

  if (typeof message.transcript === "string" && message.transcript.trim()) {
    return message.transcript;
  }

  return safeSerialize(message);
}

function extractRole(message) {
  if (!message || typeof message !== "object") return "system";

  const source = String(
    message.source || message.role || message.type || message.message_source || ""
  ).toLowerCase();

  if (source.includes("agent") || source.includes("assistant") || source.includes("ai")) {
    return "agent";
  }

  if (source.includes("user") || source.includes("human")) {
    return "user";
  }

  return "system";
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message || "Erreur inconnue au démarrage";
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (typeof Event !== "undefined" && error instanceof Event) {
    return `Erreur navigateur : ${error.type || "évènement inconnu"}`;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  const serialized = safeSerialize(error);
  return serialized === "{}" ? "Erreur inconnue au démarrage" : serialized;
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeDisconnect(details) {
  if (!details || typeof details !== "object") {
    return "";
  }

  if (typeof details.wasClean === "boolean" && !details.wasClean) {
    return "La session s'est interrompue de façon inattendue.";
  }

  return "";
}

function buildDynamicVariables(
  profile,
  recentConversations,
  upcomingEvents,
  recentNotes,
  dateContext,
  todayReminderEvents = [],
  spotifyContext = {}
) {
  return {
    userName: profile.firstName,
    user_first_name: profile.firstName,
    user_last_name: profile.lastName,
    user_full_name: `${profile.firstName} ${profile.lastName}`.trim(),
    user_age: profile.age,
    user_city: profile.city,
    user_address: profile.addressLabel || profile.city,
    user_bio: profile.bio,
    date: dateContext.promptValue,
    date_iso: dateContext.iso,
    current_time_zone: dateContext.timeZone,
    current_location_label: dateContext.locationLabel,
    spotify_connected: spotifyContext.connected ? "true" : "false",
    spotify_ready: spotifyContext.ready ? "true" : "false",
    spotify_now_playing: spotifyContext.nowPlaying
      ? `${spotifyContext.nowPlaying.title}${
          spotifyContext.nowPlaying.artists ? ` - ${spotifyContext.nowPlaying.artists}` : ""
        }`
      : "",
    previous_conversations_summary: buildConversationSummary(recentConversations),
    upcoming_events_summary: buildUpcomingEventsSummary(upcomingEvents),
    recent_notes_summary: buildNotesSummary(recentNotes),
    today_reminders_summary: buildTodayRemindersSummary(todayReminderEvents),
  };
}

function buildProfileContext(
  profile,
  recentConversations,
  upcomingEvents,
  recentNotes,
  todayReminderEvents,
  dateContext,
  spotifyContext = {}
) {
  return [
    "Contexte utilisateur pour cette conversation :",
    `Date et heure actuelles : ${dateContext.promptValue}`,
    `Date ISO actuelle : ${dateContext.iso}`,
    `Fuseau horaire utilisateur : ${dateContext.timeZone}`,
    `Prénom : ${profile.firstName}`,
    `Nom : ${profile.lastName}`,
    `Age : ${profile.age}`,
    `Ville : ${profile.city}`,
    profile.addressLabel ? `Adresse sélectionnée : ${profile.addressLabel}` : null,
    `Description personnelle : ${profile.bio}`,
    recentConversations.length
      ? `Historique récent : ${buildConversationSummary(recentConversations)}`
      : "Historique récent : aucune conversation précédente enregistrée.",
    `Évènements à venir : ${buildUpcomingEventsSummary(upcomingEvents)}`,
    `Notes utiles : ${buildNotesSummary(recentNotes)}`,
    todayReminderEvents.length
      ? `Rappels à annoncer maintenant : ${buildTodayRemindersSummary(todayReminderEvents)}`
      : "Rappels du jour à annoncer maintenant : aucun.",
    todayReminderEvents.length
      ? "Commence cet appel en rappelant naturellement ces rendez-vous du jour une seule fois, puis poursuis la conversation normalement."
      : null,
    "Si l'utilisateur demande d'ajouter un rendez-vous ou un évènement à son calendrier, utilise l'outil client createCalendarEvent avec un titre et une date de début précise.",
    "Si l'utilisateur demande d'ouvrir, afficher ou mettre en focus un rendez-vous ou un évènement, utilise l'outil client openCalendarEvent.",
    "Si l'utilisateur demande de fermer l'élément actuellement ouvert, utilise l'outil client closeFocusedSurface.",
    "Si l'utilisateur demande de supprimer un rendez-vous ou un évènement de son calendrier, utilise l'outil client deleteCalendarEvent avec le titre ou un extrait suffisant pour l'identifier.",
    "Si l'utilisateur demande de noter, mémoriser ou enregistrer une information, utilise l'outil client createNote avec le contenu, le type de note et la date si elle est connue.",
    "Si l'utilisateur demande d'ouvrir, afficher ou mettre en focus une note, utilise l'outil client openNote.",
    "Si l'utilisateur demande de supprimer une note, utilise l'outil client deleteNote avec le contenu ou un extrait suffisamment distinctif.",
    spotifyContext.connected
      ? `Spotify est connecté${spotifyContext.ready ? " et le lecteur est prêt." : "."}`
      : "Spotify n'est pas encore connecté.",
    spotifyContext.connected
      ? "Si l'utilisateur demande de jouer une chanson, utilise l'outil client playSpotifySong avec le titre du morceau et éventuellement l'artiste."
      : "Si l'utilisateur demande de jouer une chanson et que Spotify n'est pas connecté, invite-le à cliquer sur le bouton Connecter Spotify.",
    spotifyContext.connected
      ? "Si l'utilisateur demande pause, stop ou de mettre la musique en pause, utilise l'outil client pauseSpotify."
      : null,
    "Utilise ce contexte pour personnaliser tes réponses dès le début de l'appel.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationSummary(recentConversations) {
  if (!recentConversations?.length) {
    return "Aucune conversation précédente.";
  }

  return recentConversations
    .slice(0, 3)
    .map((conversation, index) => {
      const summary = conversation.summary || "Conversation sans résumé.";
      return `Conversation ${index + 1}: ${summary}`;
    })
    .join(" || ");
}

function buildUpcomingEventsSummary(upcomingEvents) {
  if (!upcomingEvents?.length) {
    return "Aucun évènement à venir, demandez à Papote d'en ajouter un.";
  }

  return upcomingEvents
    .slice(0, 5)
    .map((event) => `${event.title} le ${formatEventDate(event.startAt)}`)
    .join(" || ");
}

function buildNotesSummary(recentNotes) {
  if (!recentNotes?.length) {
    return "Aucune note enregistrée pour le moment.";
  }

  return recentNotes
    .slice(0, 5)
    .map((note) => {
      const noteDateLabel = buildStoredNoteDateLabel(note);
      return `${formatNoteTypeLabel(note.noteType)} : ${note.content}${
        noteDateLabel ? ` (${noteDateLabel})` : ""
      }`;
    })
    .join(" || ");
}

function buildTodayRemindersSummary(todayReminderEvents) {
  if (!todayReminderEvents?.length) {
    return "Aucun rendez-vous à rappeler aujourd'hui.";
  }

  return todayReminderEvents
    .slice(0, 5)
    .map((event) => `${event.title} à ${formatEventTime(event.startAt)}`)
    .join(" || ");
}

function formatEventDate(value) {
  if (!Number.isFinite(value)) {
    return "date inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEventTime(value) {
  if (!Number.isFinite(value)) {
    return "heure inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNoteDate(value) {
  if (!Number.isFinite(value)) {
    return "date inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNoteTypeLabel(value) {
  const noteType = String(value || "").trim();
  if (!noteType) {
    return "Général";
  }

  return noteType.charAt(0).toUpperCase() + noteType.slice(1);
}

function formatStoredNoteDate(note) {
  return buildStoredNoteDateLabel(note) || "sans date";
}

function buildNoteDateConfirmation(note) {
  const noteDateLabel = buildStoredNoteDateLabel(note);
  return noteDateLabel ? `pour ${noteDateLabel}.` : "sans date précise.";
}

function buildStoredNoteDateLabel(note) {
  if (Number.isFinite(note?.noteDate)) {
    return formatNoteDate(note.noteDate);
  }

  if (typeof note?.noteDateLabel === "string" && note.noteDateLabel.trim()) {
    return note.noteDateLabel.trim();
  }

  return "";
}

function formatCredits(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  }

  return `${seconds} s`;
}

function formatPlaybackTime(totalMilliseconds) {
  if (!Number.isFinite(totalMilliseconds) || totalMilliseconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function buildConversationDateContext(profile) {
  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  const fallbackLocationLabel = profile.addressLabel || profile.city || "localisation inconnue";
  const fallbackDisplayValue = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: fallbackTimeZone,
  }).format(now);
  const fallbackPromptValue = `${fallbackDisplayValue} (${fallbackTimeZone})`;

  if (!Number.isFinite(profile.latitude) || !Number.isFinite(profile.longitude)) {
    return {
      promptValue: fallbackPromptValue,
      displayValue: fallbackDisplayValue,
      iso: now.toISOString(),
      timeZone: fallbackTimeZone,
      locationLabel: fallbackLocationLabel,
    };
  }

  try {
    const params = new URLSearchParams({
      latitude: String(profile.latitude),
      longitude: String(profile.longitude),
    });
    const response = await fetch(`/api/current-date?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Impossible de récupérer la date actuelle.");
    }

    const data = await response.json();
    return {
      promptValue:
        typeof data.promptValue === "string" && data.promptValue.trim()
          ? data.promptValue
          : fallbackPromptValue,
      displayValue:
        typeof data.displayValue === "string" && data.displayValue.trim()
          ? data.displayValue
          : fallbackDisplayValue,
      iso:
        typeof data.iso === "string" && data.iso.trim() ? data.iso : now.toISOString(),
      timeZone:
        typeof data.timeZone === "string" && data.timeZone.trim()
          ? data.timeZone
          : fallbackTimeZone,
      locationLabel: fallbackLocationLabel,
    };
  } catch {
    return {
      promptValue: fallbackPromptValue,
      displayValue: fallbackDisplayValue,
      iso: now.toISOString(),
      timeZone: fallbackTimeZone,
      locationLabel: fallbackLocationLabel,
    };
  }
}

function buildDayBounds(referenceIso, timeZone) {
  const referenceDate = referenceIso ? new Date(referenceIso) : new Date();
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(referenceDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1));

  return {
    dayStart: zonedDateTimeToIso(
      { year, month, day, hour: 0, minute: 0, second: 0 },
      timeZone
    ),
    dayEnd: zonedDateTimeToIso(
      {
        year: nextDayDate.getUTCFullYear(),
        month: nextDayDate.getUTCMonth() + 1,
        day: nextDayDate.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone
    ),
  };
}

function sanitizeVisibleText(text) {
  if (typeof text !== "string") {
    return "Message sans contenu visible.";
  }

  const cleanedText = text
    .replace(/\[[^\]]*\]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleanedText || "Message sans contenu visible.";
}

function normalizeCalendarToolParameters(parameters, timeZone) {
  const normalizedParameters = normalizeToolParameters(parameters);
  const title = firstNonEmptyString(
    normalizedParameters?.title,
    normalizedParameters?.eventTitle,
    normalizedParameters?.event_name,
    normalizedParameters?.name,
    normalizedParameters?.summary,
    normalizedParameters?.label
  );
  const startAt =
    buildDateTimeFromParts(normalizedParameters) ||
    firstNonEmptyString(
      normalizedParameters?.startAt,
      normalizedParameters?.startsAt,
      normalizedParameters?.start_date,
      normalizedParameters?.dueDate,
      normalizedParameters?.date,
      normalizedParameters?.datetime,
      normalizedParameters?.scheduledFor,
      normalizedParameters?.scheduled_for,
      normalizedParameters?.when
    );
  const endAt =
    buildEndDateTimeFromParts(normalizedParameters) ||
    firstNonEmptyString(
      normalizedParameters?.endAt,
      normalizedParameters?.endsAt,
      normalizedParameters?.endDate,
      normalizedParameters?.end_date
    );

  if (!title) {
    throw new Error("Le titre de l'évènement est manquant dans l'appel outil.");
  }

  if (!startAt) {
    throw new Error("La date de l'évènement est manquante dans l'appel outil.");
  }

  return {
    title,
    startAt: normalizeToolDateValue(startAt, timeZone),
    endAt: endAt ? normalizeToolDateValue(endAt, timeZone) : undefined,
  };
}

function normalizeNoteToolParameters(parameters, timeZone) {
  const normalizedParameters = normalizeToolParameters(parameters);
  const content = firstNonEmptyString(
    normalizedParameters?.content,
    normalizedParameters?.note,
    normalizedParameters?.title,
    normalizedParameters?.text,
    normalizedParameters?.body,
    normalizedParameters?.description,
    normalizedParameters?.value,
    normalizedParameters?.message,
    normalizedParameters?.summary,
    normalizedParameters?.details,
    normalizedParameters?.raw
  );
  const noteType = firstNonEmptyString(
    normalizedParameters?.noteType,
    normalizedParameters?.type,
    normalizedParameters?.category,
    normalizedParameters?.kind,
    normalizedParameters?.label
  );
  const noteDate =
    buildDateTimeFromParts(normalizedParameters) ||
    firstNonEmptyString(
      normalizedParameters?.noteDate,
      normalizedParameters?.date,
      normalizedParameters?.datetime,
      normalizedParameters?.scheduledFor,
      normalizedParameters?.scheduled_for,
      normalizedParameters?.when
    );

  if (!content) {
    throw new Error("Le contenu de la note est manquant dans l'appel outil.");
  }

  return {
    content,
    noteType: noteType || "général",
    noteDate: noteDate ? normalizeToolDateValue(noteDate, timeZone) : undefined,
  };
}

function normalizeDeleteCalendarToolParameters(parameters, timeZone) {
  const normalizedParameters = normalizeToolParameters(parameters);
  const title = firstNonEmptyString(
    normalizedParameters?.title,
    normalizedParameters?.query,
    normalizedParameters?.eventTitle,
    normalizedParameters?.name,
    normalizedParameters?.summary,
    normalizedParameters?.label,
    normalizedParameters?.content,
    normalizedParameters?.text
  );
  const startAt =
    buildDateTimeFromParts(normalizedParameters) ||
    firstNonEmptyString(
      normalizedParameters?.startAt,
      normalizedParameters?.date,
      normalizedParameters?.datetime,
      normalizedParameters?.when
    );

  if (!title) {
    throw new Error("Le rendez-vous à supprimer doit être identifié par son titre.");
  }

  return {
    title,
    query: title,
    startAt: startAt ? normalizeToolDateValue(startAt, timeZone) : undefined,
  };
}

function normalizeDeleteNoteToolParameters(parameters) {
  const normalizedParameters = normalizeToolParameters(parameters);
  const content = firstNonEmptyString(
    normalizedParameters?.content,
    normalizedParameters?.query,
    normalizedParameters?.note,
    normalizedParameters?.text,
    normalizedParameters?.title,
    normalizedParameters?.summary,
    normalizedParameters?.description
  );
  const noteType = firstNonEmptyString(
    normalizedParameters?.noteType,
    normalizedParameters?.type,
    normalizedParameters?.category
  );

  if (!content) {
    throw new Error("La note à supprimer doit être identifiée par son contenu.");
  }

  return {
    content,
    query: content,
    noteType: noteType || undefined,
  };
}

function buildDateTimeFromParts(parameters) {
  const date = firstNonEmptyString(
    parameters?.date,
    parameters?.dueDate,
    parameters?.startDate,
    parameters?.start_date
  );
  const time = firstNonEmptyString(
    parameters?.time,
    parameters?.startTime,
    parameters?.start_time
  );

  if (!date) {
    return "";
  }

  const rawValue = time ? `${date}T${time}` : `${date}T12:00:00`;
  return rawValue;
}

function buildEndDateTimeFromParts(parameters) {
  const endDate = firstNonEmptyString(parameters?.endDate, parameters?.end_date);
  const endTime = firstNonEmptyString(parameters?.endTime, parameters?.end_time);

  if (!endDate) {
    return "";
  }

  return endTime ? `${endDate}T${endTime}` : endDate;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeToolDateValue(value, timeZone = "UTC") {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 1e12 ? value : value * 1000;
    return new Date(timestamp).toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmedValue = value.trim();
  const normalizedFrenchDate = normalizeFrenchDateString(trimmedValue);
  const unixValue = Number(trimmedValue);

  if (Number.isFinite(unixValue)) {
    const timestamp = unixValue > 1e12 ? unixValue : unixValue * 1000;
    return new Date(timestamp).toISOString();
  }

  const zonedDateTime = parseCalendarDateParts(normalizedFrenchDate);
  if (zonedDateTime) {
    return zonedDateTimeToIso(zonedDateTime, timeZone);
  }

  return trimmedValue;
}

function parseCalendarDateParts(value) {
  const yearFirstDateTimeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  );

  if (yearFirstDateTimeMatch) {
    const [, year, month, day, hour = "12", minute = "00", second = "00"] =
      yearFirstDateTimeMatch;
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    };
  }

  const slashDateMatch = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (slashDateMatch) {
    const [, day, month, year, hour = "12", minute = "00", second = "00"] = slashDateMatch;
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    };
  }

  const dayFirstDateMatch = value.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (dayFirstDateMatch) {
    const [, day, month, year, hour = "12", minute = "00", second = "00"] =
      dayFirstDateMatch;
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    };
  }

  return null;
}

function zonedDateTimeToIso(parts, timeZone) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const offset = getTimeZoneOffsetMilliseconds(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset).toISOString();
}

function getTimeZoneOffsetMilliseconds(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function mergeEvents(localEvents, remoteEvents) {
  const byId = new Map();

  [...remoteEvents, ...localEvents].forEach((event) => {
    byId.set(event._id, event);
  });

  return Array.from(byId.values()).sort((left, right) => left.startAt - right.startAt);
}

function mergeNotes(localNotes, remoteNotes) {
  const byId = new Map();

  [...remoteNotes, ...localNotes].forEach((note) => {
    byId.set(note._id, note);
  });

  return Array.from(byId.values()).sort((left, right) => {
    const leftTimestamp = left.noteDate || left.createdAt || 0;
    const rightTimestamp = right.noteDate || right.createdAt || 0;
    return rightTimestamp - leftTimestamp;
  });
}

function extractToolName(toolCall) {
  return String(
    toolCall?.tool_name ||
      toolCall?.toolName ||
      toolCall?.client_tool_call?.tool_name ||
      toolCall?.clientToolCall?.toolName ||
      ""
  ).trim();
}

function extractToolParameters(toolCall) {
  return normalizeToolParameters(
    toolCall?.parameters ||
    toolCall?.params ||
    toolCall?.client_tool_call?.parameters ||
    toolCall?.clientToolCall?.parameters ||
    {}
  );
}

function looksLikeCalendarTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("calendar") ||
    normalized.includes("event") ||
    normalized.includes("evenement") ||
    normalized.includes("rendezvous") ||
    normalized.includes("agenda") ||
    normalized.includes("rdv")
  );
}

function looksLikeSpotifyTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("spotify") ||
    normalized.includes("playsong") ||
    normalized.includes("playmusic") ||
    normalized.includes("jouermusique") ||
    normalized.includes("pausemusic") ||
    normalized.includes("pauseplayback") ||
    normalized.includes("stopmusic")
  );
}

function looksLikeDeleteTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("supprimer")
  );
}

function looksLikeOpenTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("open") ||
    normalized.includes("focus") ||
    normalized.includes("show") ||
    normalized.includes("display") ||
    normalized.includes("ouvrir") ||
    normalized.includes("afficher")
  );
}

function looksLikeCloseTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("close") ||
    normalized.includes("dismiss") ||
    normalized.includes("hide") ||
    normalized.includes("fermer")
  );
}

function looksLikeNoteTool(toolName) {
  const normalized = normalizeToolIdentifier(toolName);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("note") ||
    normalized.includes("memo") ||
    normalized.includes("remember") ||
    normalized.includes("save") ||
    normalized.includes("write") ||
    normalized.includes("contact") ||
    normalized.includes("recette")
  );
}

function isSpotifyDeviceNotFoundError(error) {
  const normalizedMessage = normalizeToolIdentifier(
    error instanceof Error ? error.message : String(error || "")
  );

  return normalizedMessage.includes("devicenotfound");
}

function inferSidebarPanelFromText(text) {
  const normalized = normalizeToolIdentifier(text);

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("agenda") ||
    normalized.includes("calendrier") ||
    normalized.includes("rendezvous") ||
    normalized.includes("evenement") ||
    normalized.includes("rdv")
  ) {
    return "agenda";
  }

  if (
    normalized.includes("musique") ||
    normalized.includes("spotify") ||
    normalized.includes("chanson") ||
    normalized.includes("morceau") ||
    normalized.includes("album") ||
    normalized.includes("playlist")
  ) {
    return "music";
  }

  if (
    normalized.includes("note") ||
    normalized.includes("noter") ||
    normalized.includes("memo") ||
    normalized.includes("souviens") ||
    normalized.includes("retenir") ||
    normalized.includes("contact") ||
    normalized.includes("recette") ||
    normalized.includes("liste")
  ) {
    return "notes";
  }

  return null;
}

function buildSpotifySearchQuery(parameters) {
  const normalizedParameters = normalizeToolParameters(parameters);
  const rawTitle = sanitizeSpotifySearchField(
    firstNonEmptyString(
    normalizedParameters?.query,
    normalizedParameters?.track,
    normalizedParameters?.song,
    normalizedParameters?.title,
    normalizedParameters?.music,
    normalizedParameters?.prompt
    )
  );
  const rawArtist = sanitizeSpotifySearchField(
    firstNonEmptyString(
    normalizedParameters?.artist,
    normalizedParameters?.artistName,
    normalizedParameters?.singer
    )
  );
  const parsedRequest = parseSpotifyQueryParts(rawTitle, rawArtist);
  const title = parsedRequest.title;
  const artist = parsedRequest.artist;
  const query = title ? (artist ? `${title} ${artist}` : title) : artist;
  const inferredPairs = buildSpotifySearchPairs(title, artist, rawTitle);

  if (!query) {
    return {
      rawQuery: "",
      title: "",
      artist: "",
      query: "",
      queries: [],
      pairs: [],
    };
  }

  const exactQueries = inferredPairs.flatMap((pair) => buildSpotifyQueriesForPair(pair));
  const exactLooseQuery = artist ? `"${title}" "${artist}"` : `"${title}"`;
  const queries = Array.from(
    new Set(
      [...exactQueries, exactLooseQuery, query, title, rawTitle]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  return {
    rawQuery: stripWrappingQuotes(rawTitle),
    title,
    artist,
    query,
    queries,
    pairs: inferredPairs,
  };
}

function parseSpotifyQueryParts(rawTitle, rawArtist) {
  let title = sanitizeSpotifySearchField(rawTitle);
  let artist = sanitizeSpotifySearchField(rawArtist);

  if (!title) {
    return { title, artist };
  }

  const quotedPatternMatch = title.match(/^["'`](.+?)["'`]\s+(?:by|from|de|par)\s+(.+)$/i);
  if (!artist && quotedPatternMatch) {
    title = quotedPatternMatch[1].trim();
    artist = quotedPatternMatch[2].trim();
  }

  if (!artist) {
    const separatorMatch = title.match(
      /^(.+?)\s+(?:by|from|de|par)\s+(.+)$/i
    );

    if (separatorMatch) {
      title = separatorMatch[1].trim();
      artist = separatorMatch[2].trim();
    }
  }

  if (!artist) {
    const dashMatch = title.match(/^(.+?)\s*[-–—]\s+(.+)$/);
    if (dashMatch) {
      title = dashMatch[1].trim();
      artist = dashMatch[2].trim();
    }
  }

  if (!artist) {
    const featuringMatch = title.match(/^(.+?)\s+(?:feat\.?|ft\.?)\s+(.+)$/i);
    if (featuringMatch) {
      title = featuringMatch[1].trim();
      artist = featuringMatch[2].trim();
    }
  }

  return {
    title: stripWrappingQuotes(title),
    artist: stripWrappingQuotes(artist),
  };
}

function sanitizeSpotifySearchField(value) {
  return stripWrappingQuotes(
    String(value || "")
      .replace(
        /^(?:joue(?:\s+moi)?|mets?|mettez|lance|lancer|play|start|put on)\s+/i,
        ""
      )
      .replace(
        /^(?:la|le|les|un|une|the)\s+(?:chanson|musique|morceau|titre|song|track)\s+/i,
        ""
      )
      .replace(/\s+(?:sur|on)\s+spotify$/i, "")
      .replace(/\s+(?:s'il te plait|stp|please)$/i, "")
      .trim()
  );
}

function stripWrappingQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function selectBestSpotifyTrackMatch(searchResponses, request) {
  const candidates = dedupeSpotifyTracks(
    (searchResponses || []).flatMap((response) => response?.tracks?.items || [])
  );

  if (candidates.length === 0) {
    return null;
  }

  const scoredCandidates = candidates
    .map((track) => ({
      track,
      score: scoreSpotifyTrackMatch(track, request),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredCandidates[0];
  if (!bestMatch) {
    return null;
  }

  const titleMatched = isStrongSpotifyTitleMatch(bestMatch.track, request.title);
  const artistMatched = request.artist
    ? isStrongSpotifyArtistMatch(bestMatch.track, request.artist)
    : true;

  if (!titleMatched || !artistMatched) {
    return null;
  }

  return bestMatch.track;
}

function dedupeSpotifyTracks(tracks) {
  const byUri = new Map();

  for (const track of tracks || []) {
    if (!track?.uri) {
      continue;
    }

    if (!byUri.has(track.uri)) {
      byUri.set(track.uri, track);
    }
  }

  return Array.from(byUri.values());
}

function scoreSpotifyTrackMatch(track, request) {
  const expectedTitle = normalizeSpotifyMatchText(request.title);
  const expectedArtist = normalizeSpotifyMatchText(request.artist);
  const actualTitle = normalizeSpotifyTrackTitle(track?.name);
  const actualArtists = (track?.artists || []).map((artist) =>
    normalizeSpotifyMatchText(artist?.name)
  );
  const actualCombined = normalizeSpotifyMatchText(
    `${track?.name || ""} ${(track?.artists || []).map((artist) => artist?.name || "").join(" ")}`
  );
  const rawQuery = normalizeSpotifyMatchText(request.rawQuery);

  if (!expectedTitle) {
    return 0;
  }

  let score = 0;

  if (actualTitle === expectedTitle) {
    score += 300;
  } else if (
    actualTitle.startsWith(expectedTitle) ||
    expectedTitle.startsWith(actualTitle)
  ) {
    score += 180;
  } else if (actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle)) {
    score += 120;
  } else {
    return 0;
  }

  if (expectedArtist) {
    if (actualArtists.includes(expectedArtist)) {
      score += 250;
    } else if (actualArtists.some((artist) => artist.includes(expectedArtist))) {
      score += 80;
    } else {
      return 0;
    }
  }

  if (!expectedArtist && request.pairs?.length) {
    const pairScores = request.pairs
      .map((pair) => scoreSpotifyPairCandidate(track, pair))
      .sort((left, right) => right - left);
    score += pairScores[0] || 0;
  }

  if (rawQuery) {
    score += scoreSpotifyTokenOverlap(actualCombined, rawQuery);
  }

  const popularity = Number.isFinite(track?.popularity) ? track.popularity : 0;
  score += popularity / 10;

  return score;
}

function isStrongSpotifyTitleMatch(track, requestedTitle) {
  const expectedTitle = normalizeSpotifyMatchText(requestedTitle);
  const actualTitle = normalizeSpotifyTrackTitle(track?.name);

  if (!expectedTitle || !actualTitle) {
    return false;
  }

  return (
    actualTitle === expectedTitle ||
    actualTitle.startsWith(expectedTitle) ||
    expectedTitle.startsWith(actualTitle)
  );
}

function isStrongSpotifyArtistMatch(track, requestedArtist) {
  const expectedArtist = normalizeSpotifyMatchText(requestedArtist);
  const actualArtists = (track?.artists || []).map((artist) =>
    normalizeSpotifyMatchText(artist?.name)
  );

  if (!expectedArtist) {
    return true;
  }

  return actualArtists.includes(expectedArtist);
}

function normalizeSpotifyTrackTitle(value) {
  return normalizeSpotifyMatchText(
    String(value || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\s+-\s+(remaster(ed)?|live|radio edit|edit|version|mono|stereo).*$/i, " ")
  );
}

function normalizeSpotifyMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(feat|featuring|ft)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSpotifySearchPairs(title, artist, rawTitle) {
  const pairs = [];
  const safeTitle = stripWrappingQuotes(title);
  const safeArtist = stripWrappingQuotes(artist);
  const rawQuery = stripWrappingQuotes(rawTitle);

  if (safeTitle && safeArtist) {
    pairs.push({ title: safeTitle, artist: safeArtist, confidence: "explicit" });
    return pairs;
  }

  if (!safeTitle) {
    return pairs;
  }

  pairs.push({ title: safeTitle, artist: "", confidence: "title-only" });

  const rawWords = rawQuery.split(/\s+/).filter(Boolean);
  if (rawWords.length < 2) {
    return pairs;
  }

  const maxArtistWords = Math.min(4, rawWords.length - 1);
  for (let artistWords = 1; artistWords <= maxArtistWords; artistWords += 1) {
    const splitIndex = rawWords.length - artistWords;
    const titleCandidate = rawWords.slice(0, splitIndex).join(" ");
    const artistCandidate = rawWords.slice(splitIndex).join(" ");

    if (!titleCandidate || !artistCandidate) {
      continue;
    }

    pairs.push({
      title: titleCandidate,
      artist: artistCandidate,
      confidence: artistWords <= 2 ? "inferred-strong" : "inferred-soft",
    });
  }

  return dedupeSpotifyPairs(pairs);
}

function buildSpotifyQueriesForPair(pair) {
  const title = stripWrappingQuotes(pair?.title);
  const artist = stripWrappingQuotes(pair?.artist);

  if (!title) {
    return [];
  }

  if (!artist) {
    return [`track:"${title}"`, `"${title}"`];
  }

  return [
    `track:"${title}" artist:"${artist}"`,
    `"${title}" "${artist}"`,
    `${title} ${artist}`,
  ];
}

function dedupeSpotifyPairs(pairs) {
  const byKey = new Map();

  for (const pair of pairs || []) {
    const title = normalizeSpotifyMatchText(pair?.title);
    const artist = normalizeSpotifyMatchText(pair?.artist);
    const key = `${title}::${artist}`;

    if (!title || byKey.has(key)) {
      continue;
    }

    byKey.set(key, {
      title: stripWrappingQuotes(pair.title),
      artist: stripWrappingQuotes(pair.artist),
      confidence: pair.confidence || "inferred-soft",
    });
  }

  return Array.from(byKey.values());
}

function scoreSpotifyPairCandidate(track, pair) {
  const expectedTitle = normalizeSpotifyMatchText(pair?.title);
  const expectedArtist = normalizeSpotifyMatchText(pair?.artist);
  const actualTitle = normalizeSpotifyTrackTitle(track?.name);
  const actualArtists = (track?.artists || []).map((artist) =>
    normalizeSpotifyMatchText(artist?.name)
  );

  if (!expectedTitle || !expectedArtist) {
    return 0;
  }

  if (actualTitle !== expectedTitle || !actualArtists.includes(expectedArtist)) {
    return 0;
  }

  switch (pair?.confidence) {
    case "explicit":
      return 260;
    case "inferred-strong":
      return 220;
    case "inferred-soft":
      return 150;
    default:
      return 0;
  }
}

function scoreSpotifyTokenOverlap(actualValue, expectedValue) {
  const actualTokens = new Set(actualValue.split(" ").filter(Boolean));
  const expectedTokens = expectedValue.split(" ").filter(Boolean);

  if (expectedTokens.length === 0) {
    return 0;
  }

  let score = 0;
  let missingCount = 0;

  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      score += token.length >= 4 ? 22 : 14;
    } else {
      missingCount += 1;
    }
  }

  score -= missingCount * 26;
  return score;
}

function normalizeToolIdentifier(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function normalizeToolParameters(parameters) {
  if (!parameters) {
    return {};
  }

  if (typeof parameters === "string") {
    try {
      return normalizeToolParameters(JSON.parse(parameters));
    } catch {
      return { raw: parameters };
    }
  }

  if (Array.isArray(parameters)) {
    return {};
  }

  if (typeof parameters !== "object") {
    return {};
  }

  const nestedParameters =
    parameters.parameters ||
    parameters.args ||
    parameters.arguments ||
    parameters.input ||
    parameters.payload;

  if (nestedParameters && nestedParameters !== parameters) {
    return {
      ...normalizeToolParameters(nestedParameters),
      ...parameters,
    };
  }

  return parameters;
}

function normalizeFrenchDateString(value) {
  return value
    .replace(/\s+a\s+/gi, " ")
    .replace(/\s+à\s+/gi, " ")
    .replace(/\b(\d{1,2})h(\d{2})\b/gi, "$1:$2")
    .replace(/\b(\d{1,2})h\b/gi, "$1:00");
}
