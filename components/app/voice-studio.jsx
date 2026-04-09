"use client";

import { UserButton } from "@clerk/nextjs";
import { useConversation } from "@elevenlabs/react";
import { AudioLines, CalendarDays, Clock3, MessageSquare, Mic, ShieldAlert } from "lucide-react";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Orb } from "@/components/ui/orb";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "";
const TRIAL_EXHAUSTED_MESSAGE = "Vous avez utilise tous vos credits, merci pour votre essai.";

const formatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

export function VoiceStudio({ profile, recentConversations, upcomingEvents = [] }) {
  const [messages, setMessages] = useState([]);
  const [requestError, setRequestError] = useState("");
  const [disconnectReason, setDisconnectReason] = useState("");
  const [toolNotice, setToolNotice] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const activeConversationRef = useRef(null);
  const createConversation = useMutation(api.conversations.start);
  const appendConversationMessage = useMutation(api.conversations.appendMessage);
  const finishConversation = useMutation(api.conversations.end);
  const createCalendarEvent = useMutation(api.events.createForCurrent);

  async function handleCreateCalendarEvent(parameters) {
    const normalizedEvent = normalizeCalendarToolParameters(parameters);
    const createdEvent = await createCalendarEvent(normalizedEvent);
    const confirmationMessage = `Rendez-vous ajoute: ${createdEvent.title} le ${formatEventDate(
      createdEvent.startAt
    )}.`;

    setToolNotice(confirmationMessage);
    setRequestError("");

    return confirmationMessage;
  }

  const conversation = useConversation({
    clientTools: {
      createCalendarEvent: handleCreateCalendarEvent,
      create_calendar_event: handleCreateCalendarEvent,
      addCalendarEvent: handleCreateCalendarEvent,
      add_calendar_event: handleCreateCalendarEvent,
      createEvent: handleCreateCalendarEvent,
      addEventToCalendar: handleCreateCalendarEvent,
    },
    onConnect: () => {
      setRequestError("");
      setDisconnectReason("");
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

      setIsConnecting(false);
      setDisconnectReason(describeDisconnect(details));
    },
    onError: (error) => {
      setIsConnecting(false);
      setRequestError(describeError(error));
    },
    onUnhandledClientToolCall: (toolCall) => {
      setRequestError(
        `Outil client ElevenLabs introuvable: ${toolCall?.tool_name || "nom inconnu"}.`
      );
    },
    onMessage: (message) => {
      const text = sanitizeVisibleText(extractText(message));
      const role = extractRole(message);
      const timestamp = formatter.format(new Date());

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
  const remainingSeconds = profile.creditsPerSecond
    ? Math.max(0, Math.floor(profile.creditsRemaining / profile.creditsPerSecond))
    : 0;

  const statusLabel = useMemo(() => {
    if (trialIsExhausted) {
      return "Essai termine";
    }

    switch (status) {
      case "connected":
        return "En ligne";
      case "connecting":
        return "Connexion";
      case "disconnecting":
        return "Fin";
      default:
        return "Pret";
    }
  }, [status, trialIsExhausted]);

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
    setDisconnectReason("");
    setToolNotice("");

    let startedConversationId = "";

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const dateContext = buildConversationDateContext(profile);

      const response = await fetch("/api/signed-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: AGENT_ID.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.signedUrl) {
        throw new Error(data.error || "Impossible de recuperer une session de conversation.");
      }

      setMessages([]);

      startedConversationId = await conversation.startSession({
        signedUrl: data.signedUrl,
        connectionType: "websocket",
        dynamicVariables: buildDynamicVariables(
          profile,
          recentConversations,
          upcomingEvents,
          dateContext
        ),
        workletPaths: {
          rawAudioProcessor: "/elevenlabs/rawAudioProcessor.worklet.js",
          audioConcatProcessor: "/elevenlabs/audioConcatProcessor.worklet.js",
        },
      });

      activeConversationRef.current = startedConversationId;
      await createConversation({ externalId: startedConversationId });

      conversation.sendContextualUpdate(
        buildProfileContext(profile, recentConversations, upcomingEvents, dateContext)
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

  return (
    <main className="relative h-[100svh] overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(184,126,177,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(0,127,112,0.16),transparent_24%),linear-gradient(180deg,#fffefd_0%,#f4fbf9_48%,#f7eef7_100%)] text-[#0d3d38]">
      <div className="mx-auto grid h-full w-full max-w-7xl gap-6 px-6 py-4 sm:px-8 sm:py-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-10 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="hidden h-full min-h-0 lg:flex lg:flex-col">
          <Card className="flex h-full min-h-0 flex-col border border-white/80 bg-white/76 shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl">
            <CardHeader className="border-b border-[#007f70]/10">
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarDays className="size-5 text-[#007f70]" />
                Agenda
              </CardTitle>
              <CardDescription>
                Les prochains evenements a garder en tete pendant la conversation.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col overflow-hidden p-4">
              <div className="grid flex-1 gap-3 overflow-y-auto pr-1">
                {upcomingEvents.length === 0 ? (
                  <div className="flex min-h-48 flex-col justify-center rounded-3xl border border-dashed border-[#007f70]/15 bg-[#f5fbfa] px-5 text-center">
                    <p className="text-sm font-medium text-[#244f49]">
                      Aucun evenement a venir.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#72908b]">
                      Demandez a Papote d&apos;en ajouter un pour commencer votre agenda.
                    </p>
                  </div>
                ) : (
                  upcomingEvents.map((event) => (
                    <article
                      key={event._id}
                      className="rounded-3xl border border-[#007f70]/10 bg-[#f4fbf9] px-4 py-4 text-left"
                    >
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#7a8f8b]">
                        {formatEventDate(event.startAt)}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[#173f3a]">{event.title}</p>
                      {Number.isFinite(event.endAt) ? (
                        <p className="mt-2 text-sm leading-6 text-[#5f7b76]">
                          Jusqu&apos;a {formatEventTime(event.endAt)}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
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
              width={168}
              height={168}
              className="h-24 w-24 object-contain sm:h-28 sm:w-28 lg:h-32 lg:w-32"
              priority
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
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
                ? "Essai beta termine"
                : `${formatDuration(remainingSeconds)} restantes`}
            </Badge>
          </div>

          <div className="mt-5 aspect-square w-[min(38vh,19rem)] shrink-0 rounded-full border border-white/80 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.92),rgba(246,250,249,0.85)_46%,rgba(244,234,244,0.86)_100%)] shadow-[0_30px_120px_rgba(0,127,112,0.15)] backdrop-blur-xl sm:mt-6 sm:w-[min(40vh,22rem)] lg:w-[min(42vh,24rem)]">
            <Orb
              state={status === "connected" ? (isSpeaking ? "talking" : "listening") : "idle"}
              className="mx-auto my-[12%] size-[76%]"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={status === "connected" ? endConversation : startConversation}
              disabled={trialIsExhausted || isConnecting || status === "disconnecting"}
              className="min-w-44 rounded-full px-8"
            >
              <Mic className="size-4" />
              {status === "connected" ? "Terminer" : "Discuter"}
            </Button>
          </div>

          <div className="mt-4 max-w-xl rounded-[28px] border border-white/80 bg-white/78 px-5 py-4 text-left shadow-[0_20px_60px_rgba(0,127,112,0.08)]">
            <p className="text-xs uppercase tracking-[0.24em] text-[#7a8f8b]">Essai beta</p>
            <p className="mt-2 text-sm font-medium text-[#173f3a]">
              {profile.trialDurationMinutes} minutes offertes a l&apos;inscription.
            </p>
            <p className="mt-2 text-sm leading-6 text-[#5a7772]">
              Credits utilises: {formatCredits(profile.creditsUsed)} /{" "}
              {formatCredits(profile.creditsOffered)}.
            </p>
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

          {!requestError && disconnectReason ? (
            <div className="mt-4 max-w-xl rounded-2xl border border-[#b87eb1]/25 bg-white/80 px-4 py-3 text-sm text-[#6d4e69] shadow-[0_12px_30px_rgba(184,126,177,0.08)]">
              {disconnectReason}
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
                La conversation s&apos;affiche ici en temps reel.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden p-4">
              <div className="rounded-3xl border border-[#007f70]/10 bg-[#f4fbf9] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#78908b]">
                  Solde d&apos;essai
                </p>
                <p className="mt-2 text-lg font-semibold text-[#173f3a]">
                  {trialIsExhausted
                    ? "Essai termine"
                    : `${formatDuration(remainingSeconds)} encore disponibles`}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#5f7b76]">
                  Cout de reference: {formatCredits(profile.creditsPerSecond)} credits par seconde.
                </p>
              </div>

              <div className="grid flex-1 gap-3 overflow-y-auto pr-1">
                {messages.length === 0 ? (
                  <div className="flex min-h-48 flex-col items-center justify-center rounded-3xl border border-dashed border-[#007f70]/15 bg-[#f5fbfa] px-5 text-center">
                    <MessageSquare className="size-7 text-[#84a7a1]" />
                    <p className="mt-4 text-sm font-medium text-[#244f49]">
                      Aucun message pour le moment
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#72908b]">
                      Lancez la conversation pour voir apparaitre le fil de transcription.
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
                              : "Systeme"}
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

      {trialIsExhausted ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#143c38]/35 px-6 backdrop-blur-sm">
          <Card className="w-full max-w-xl border border-white/80 bg-white/92 shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl text-[#173f3a]">
                <ShieldAlert className="size-7 text-[#b6505f]" />
                Essai termine
              </CardTitle>
              <CardDescription className="text-base leading-7 text-[#5f7470]">
                {TRIAL_EXHAUSTED_MESSAGE}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-[#4b6661]">
              <p>
                Vous avez consomme {formatCredits(profile.creditsUsed)} credits sur{" "}
                {formatCredits(profile.creditsOffered)} credits offerts.
              </p>
              <p>
                Cette version est encore en beta, il n&apos;y a donc pas encore d&apos;abonnement
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
  if (!message) return "Message vide recu.";
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
    return error.message || "Erreur inconnue au demarrage";
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
    return `Erreur navigateur: ${error.type || "evenement inconnu"}`;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  const serialized = safeSerialize(error);
  return serialized === "{}" ? "Erreur inconnue au demarrage" : serialized;
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
    return "La session a ete fermee.";
  }

  const parts = [];

  if (typeof details.reason === "string" && details.reason.trim()) {
    parts.push(`Raison: ${details.reason}`);
  }

  if (typeof details.code !== "undefined") {
    parts.push(`Code: ${details.code}`);
  }

  if (typeof details.wasClean === "boolean") {
    parts.push(details.wasClean ? "Fermeture propre." : "Fermeture inattendue.");
  }

  return parts.length > 0 ? parts.join(" ") : safeSerialize(details);
}

function buildDynamicVariables(profile, recentConversations, upcomingEvents, dateContext) {
  return {
    userName: profile.firstName,
    user_first_name: profile.firstName,
    user_last_name: profile.lastName,
    user_full_name: `${profile.firstName} ${profile.lastName}`.trim(),
    user_age: profile.age,
    user_city: profile.city,
    user_address: profile.addressLabel || profile.city,
    user_bio: profile.bio,
    date: dateContext.label,
    current_time_zone: dateContext.timeZone,
    current_location_label: dateContext.locationLabel,
    previous_conversations_summary: buildConversationSummary(recentConversations),
    upcoming_events_summary: buildUpcomingEventsSummary(upcomingEvents),
  };
}

function buildProfileContext(profile, recentConversations, upcomingEvents, dateContext) {
  return [
    "Contexte utilisateur pour cette conversation :",
    `Date et heure actuelles : ${dateContext.label}`,
    `Fuseau horaire utilisateur : ${dateContext.timeZone}`,
    `Prenom : ${profile.firstName}`,
    `Nom : ${profile.lastName}`,
    `Age : ${profile.age}`,
    `Ville : ${profile.city}`,
    profile.addressLabel ? `Adresse selectionnee : ${profile.addressLabel}` : null,
    `Description personnelle : ${profile.bio}`,
    recentConversations.length
      ? `Historique recent : ${buildConversationSummary(recentConversations)}`
      : "Historique recent : aucune conversation precedente enregistree.",
    `Evenements a venir : ${buildUpcomingEventsSummary(upcomingEvents)}`,
    "Si l'utilisateur demande d'ajouter un rendez-vous ou un evenement a son calendrier, utilise l'outil client createCalendarEvent avec un titre et une date de debut precise.",
    "Utilise ce contexte pour personnaliser tes reponses des le debut de l'appel.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationSummary(recentConversations) {
  if (!recentConversations?.length) {
    return "Aucune conversation precedente.";
  }

  return recentConversations
    .slice(0, 3)
    .map((conversation, index) => {
      const summary = conversation.summary || "Conversation sans resume.";
      return `Conversation ${index + 1}: ${summary}`;
    })
    .join(" || ");
}

function buildUpcomingEventsSummary(upcomingEvents) {
  if (!upcomingEvents?.length) {
    return "Aucun evenement a venir, demandez a Papote d'en ajouter un.";
  }

  return upcomingEvents
    .slice(0, 5)
    .map((event) => `${event.title} le ${formatEventDate(event.startAt)}`)
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

function buildConversationDateContext(profile) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  const locationLabel = profile.addressLabel || profile.city || "localisation inconnue";
  const localizedDate = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(now);

  return {
    label: `${localizedDate} - ${locationLabel}`,
    timeZone,
    locationLabel,
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

function normalizeCalendarToolParameters(parameters) {
  const title = firstNonEmptyString(
    parameters?.title,
    parameters?.eventTitle,
    parameters?.name,
    parameters?.summary
  );
  const startAt =
    buildDateTimeFromParts(parameters) ||
    firstNonEmptyString(
      parameters?.startAt,
      parameters?.startsAt,
      parameters?.dueDate,
      parameters?.date,
      parameters?.datetime
    );
  const endAt =
    buildEndDateTimeFromParts(parameters) ||
    firstNonEmptyString(parameters?.endAt, parameters?.endsAt, parameters?.endDate);

  if (!title) {
    throw new Error("Le titre de l'evenement est manquant dans l'appel outil.");
  }

  if (!startAt) {
    throw new Error("La date de l'evenement est manquante dans l'appel outil.");
  }

  return {
    title,
    startAt,
    endAt: endAt || undefined,
  };
}

function buildDateTimeFromParts(parameters) {
  const date = firstNonEmptyString(parameters?.date, parameters?.dueDate);
  const time = firstNonEmptyString(parameters?.time, parameters?.startTime);

  if (!date) {
    return "";
  }

  return time ? `${date}T${time}` : date;
}

function buildEndDateTimeFromParts(parameters) {
  const endDate = firstNonEmptyString(parameters?.endDate);
  const endTime = firstNonEmptyString(parameters?.endTime);

  if (!endDate) {
    return "";
  }

  return endTime ? `${endDate}T${endTime}` : endDate;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}
