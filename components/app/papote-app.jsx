"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VoiceStudio } from "@/components/app/voice-studio";

export function PapoteApp() {
  const { isLoaded, isSignedIn, redirectToSignIn } = useAuth();
  const { isLoading: isConvexLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn === false) {
      void redirectToSignIn({ returnBackUrl: "/" });
    }
  }, [isLoaded, isSignedIn, redirectToSignIn]);

  if (!isLoaded) {
    return <CenteredState title="Chargement" description="Connexion a votre espace Papote..." />;
  }

  if (!isSignedIn) {
    return (
      <CenteredState
        title="Connexion requise"
        description="Redirection vers la page de connexion..."
        showSignIn
      />
    );
  }

  if (isConvexLoading) {
    return (
      <CenteredState
        title="Connexion en cours"
        description="Verification de votre session Convex..."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <CenteredState
        title="Convex non connecte"
        description="Votre session Clerk est active, mais Clerk ne fournit pas encore le jeton JWT 'convex'. Activez l'integration Convex ou creez le template JWT 'convex' dans le dashboard Clerk."
      />
    );
  }

  return <PapoteAuthenticated />;
}

function PapoteAuthenticated() {
  const profile = useQuery(api.profiles.current);
  const recentConversations = useQuery(api.conversations.recentForCurrent);

  if (profile === undefined || recentConversations === undefined) {
    return <CenteredState title="Chargement" description="Recuperation de votre profil..." />;
  }

  if (!profile || !profile.onboardingCompleted) {
    return <OnboardingForm existingProfile={profile ?? null} />;
  }

  return <VoiceStudio profile={profile} recentConversations={recentConversations} />;
}

function OnboardingForm({ existingProfile }) {
  const { user } = useUser();
  const saveProfile = useMutation(api.profiles.upsertCurrent);

  const [form, setForm] = useState(() => ({
    firstName: existingProfile?.firstName ?? user?.firstName ?? "",
    lastName: existingProfile?.lastName ?? user?.lastName ?? "",
    age: existingProfile?.age ? String(existingProfile.age) : "",
    city: existingProfile?.city ?? "",
    addressLabel: existingProfile?.addressLabel ?? "",
    postcode: existingProfile?.postcode ?? "",
    bio: existingProfile?.bio ?? "",
    latitude: existingProfile?.latitude ?? null,
    longitude: existingProfile?.longitude ?? null,
  }));
  const [query, setQuery] = useState(existingProfile?.addressLabel ?? existingProfile?.city ?? "");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function searchAddress() {
      if (query.trim().length < 3) {
        setSuggestions([]);
        return;
      }

      setLoadingSuggestions(true);
      try {
        const response = await fetch(`/api/address-search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (response.ok) {
          setSuggestions(data.features || []);
        }
      } catch (searchError) {
        if (searchError.name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        setLoadingSuggestions(false);
      }
    }

    const timeoutId = setTimeout(searchAddress, 220);
    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [query]);

  const selectedAddressPreview = useMemo(() => {
    if (form.addressLabel) return form.addressLabel;
    if (form.city) return form.city;
    return "";
  }, [form.addressLabel, form.city]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.firstName.trim() || !form.lastName.trim() || !form.age.trim() || !form.city.trim() || !form.bio.trim()) {
      setError("Merci de remplir tous les champs du profil.");
      return;
    }

    const age = Number(form.age);
    if (!Number.isFinite(age) || age < 1 || age > 120) {
      setError("Merci d'indiquer un age valide.");
      return;
    }

    setIsSaving(true);
    try {
      await saveProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        age,
        city: form.city.trim(),
        addressLabel: form.addressLabel.trim() || undefined,
        postcode: form.postcode.trim() || undefined,
        bio: form.bio.trim(),
        latitude: typeof form.latitude === "number" ? form.latitude : undefined,
        longitude: typeof form.longitude === "number" ? form.longitude : undefined,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Impossible d'enregistrer votre profil.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectSuggestion(feature) {
    const properties = feature.properties || {};
    updateField("city", properties.city || properties.name || query.trim());
    updateField("addressLabel", properties.label || query.trim());
    updateField("postcode", properties.postcode || "");
    updateField("latitude", feature.geometry?.coordinates?.[1] ?? null);
    updateField("longitude", feature.geometry?.coordinates?.[0] ?? null);
    setQuery(properties.label || properties.city || query);
    setSuggestions([]);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(184,126,177,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(0,127,112,0.16),transparent_24%),linear-gradient(180deg,#fffefd_0%,#f4fbf9_48%,#f7eef7_100%)] px-6 py-10 text-[#0d3d38]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <Card className="w-full border border-white/80 bg-white/80 shadow-[0_24px_80px_rgba(0,127,112,0.08)] backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-3xl">Bienvenue sur Papote</CardTitle>
            <CardDescription>
              Avant votre premiere conversation, nous avons besoin de quelques informations pour personnaliser votre experience.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Nom">
                  <Input value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} placeholder="Dupont" />
                </Field>
                <Field label="Prenom">
                  <Input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} placeholder="Camille" />
                </Field>
              </div>

              <Field label="Age">
                <Input type="number" min="1" max="120" value={form.age} onChange={(event) => updateField("age", event.target.value)} placeholder="29" />
              </Field>

              <Field label="Ville">
                <div className="relative">
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      updateField("city", event.target.value);
                      updateField("addressLabel", event.target.value);
                    }}
                    placeholder="Commencez a taper votre ville ou votre adresse..."
                  />
                  {(loadingSuggestions || suggestions.length > 0) && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-3xl border border-[#007f70]/12 bg-white p-2 shadow-[0_24px_80px_rgba(0,127,112,0.12)]">
                      {loadingSuggestions ? (
                        <div className="px-3 py-2 text-sm text-[#67807d]">Recherche d'adresses...</div>
                      ) : (
                        suggestions.map((feature) => (
                          <button
                            key={feature.properties.id}
                            type="button"
                            onClick={() => selectSuggestion(feature)}
                            className="flex w-full flex-col rounded-2xl px-3 py-2 text-left transition hover:bg-[#f4fbf9]"
                          >
                            <span className="text-sm font-medium text-[#173f3a]">{feature.properties.label}</span>
                            <span className="text-xs text-[#6a8480]">
                              {[feature.properties.postcode, feature.properties.city, feature.properties.context]
                                .filter(Boolean)
                                .join(" • ")}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedAddressPreview ? (
                  <p className="mt-2 text-xs text-[#6a8480]">Selection actuelle: {selectedAddressPreview}</p>
                ) : null}
              </Field>

              <Field label="Parlez-nous de vous">
                <textarea
                  value={form.bio}
                  onChange={(event) => updateField("bio", event.target.value)}
                  rows={5}
                  className="min-h-[130px] w-full rounded-3xl border border-[#007f70]/10 bg-white px-4 py-3 text-sm text-[#143c38] outline-none transition placeholder:text-[#89a5a0] focus-visible:border-[#007f70]/40 focus-visible:ring-2 focus-visible:ring-[#007f70]/10"
                  placeholder="Vos hobbies, votre personnalite, ce que vous aimez, ce qui vous aide a vous sentir bien..."
                />
              </Field>

              {error ? (
                <div className="rounded-2xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <Button type="submit" size="lg" className="rounded-full" disabled={isSaving}>
                {isSaving ? "Enregistrement..." : "Continuer vers Papote"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-2 text-left">
      <span className="text-sm font-medium text-[#173f3a]">{label}</span>
      {children}
    </label>
  );
}

function CenteredState({ title, description, showSignIn = false }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(184,126,177,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(0,127,112,0.16),transparent_24%),linear-gradient(180deg,#fffefd_0%,#f4fbf9_48%,#f7eef7_100%)] px-6 text-[#0d3d38]">
      <Card className="w-full max-w-lg border border-white/80 bg-white/80 text-center shadow-[0_24px_80px_rgba(0,127,112,0.08)]">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignIn ? (
          <CardContent>
            <SignInButton mode="modal">
              <Button>Se connecter</Button>
            </SignInButton>
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
