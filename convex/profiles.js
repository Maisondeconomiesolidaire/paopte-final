import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
      throw new Error("Utilisateur non authentifie.");
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

  return {
    ...profile,
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
