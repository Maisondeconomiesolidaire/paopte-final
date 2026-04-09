import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import {
  CREDITS_PER_SECOND,
  FREE_TRIAL_MINUTES,
  FREE_TRIAL_SECONDS,
  getRemainingCredits,
  isTrialExhausted,
  normalizeCreditsOffered,
  normalizeCreditsUsed,
} from "./credits";

export const current = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentProfile(ctx);
  },
});

export const upsertCurrent = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    age: v.number(),
    city: v.string(),
    addressLabel: v.optional(v.string()),
    postcode: v.optional(v.string()),
    bio: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Utilisateur non authentifié.");
    }

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
      .unique();

    const payload = {
      externalId: identity.subject,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      age: args.age,
      city: args.city.trim(),
      addressLabel: args.addressLabel?.trim() || undefined,
      postcode: args.postcode?.trim() || undefined,
      bio: args.bio.trim(),
      latitude: args.latitude,
      longitude: args.longitude,
      creditsOffered: normalizeCreditsOffered(existing?.creditsOffered),
      creditsUsed: normalizeCreditsUsed(existing?.creditsUsed),
      onboardingCompleted: true,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("profiles", {
      ...payload,
      createdAt: Date.now(),
    });
  },
});

export async function getCurrentProfile(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
    .unique();

  return normalizeProfile(profile);
}

function normalizeProfile(profile) {
  if (!profile) {
    return null;
  }

  const creditsOffered = normalizeCreditsOffered(profile.creditsOffered);
  const creditsUsed = normalizeCreditsUsed(profile.creditsUsed);

  return {
    ...profile,
    creditsOffered,
    creditsUsed,
    creditsRemaining: getRemainingCredits(creditsOffered, creditsUsed),
    creditsPerSecond: CREDITS_PER_SECOND,
    trialDurationMinutes: FREE_TRIAL_MINUTES,
    trialDurationSeconds: FREE_TRIAL_SECONDS,
    isTrialExhausted: isTrialExhausted(creditsOffered, creditsUsed),
    onboardingCompleted: profile.onboardingCompleted || hasRequiredProfileFields(profile),
  };
}

function hasRequiredProfileFields(profile) {
  return Boolean(
    profile.firstName?.trim() &&
      profile.lastName?.trim() &&
      profile.city?.trim() &&
      profile.bio?.trim() &&
      Number.isFinite(profile.age) &&
      profile.age > 0
  );
}
