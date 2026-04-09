import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import {
  calculateEstimatedCostCredits,
  normalizeCreditsOffered,
  normalizeCreditsUsed,
} from "./credits";
import { getCurrentProfile } from "./profiles";

export const recentForCurrent = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return [];
    }

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_profile_started", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(5);

    return conversations.map((conversation) => ({
      _id: conversation._id,
      externalId: conversation.externalId,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
      durationSeconds: getConversationDurationSeconds(conversation),
      status: conversation.status,
      messageCount: conversation.messageCount,
      estimatedCostCredits: getConversationEstimatedCostCredits(conversation),
      summary: conversation.summary ?? buildSummary(conversation.transcript),
      transcript: conversation.transcript.map((message) => ({
        ...message,
        text: sanitizeTranscriptText(message.text),
      })),
    }));
  },
});

export const start = mutation({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      throw new Error("Utilisateur non authentifié.");
    }

    if (profile.isTrialExhausted) {
      throw new Error("Vous avez utilisé tous vos crédits, merci pour votre essai.");
    }

    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        endedAt: undefined,
        durationSeconds: undefined,
        estimatedCostCredits: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      externalId: args.externalId,
      profileId: profile._id,
      startedAt: Date.now(),
      status: "active",
      messageCount: 0,
      transcript: [],
    });
  },
});

export const appendMessage = mutation({
  args: {
    externalId: v.string(),
    role: v.string(),
    text: v.string(),
    timestamp: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      throw new Error("Utilisateur non authentifié.");
    }

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!conversation || conversation.profileId !== profile._id) {
      throw new Error("Conversation introuvable.");
    }

    const transcript = [
      ...conversation.transcript,
      {
        role: args.role,
        text: sanitizeTranscriptText(args.text),
        timestamp: args.timestamp,
      },
    ];

    await ctx.db.patch(conversation._id, {
      transcript,
      messageCount: transcript.length,
      summary: buildSummary(transcript),
    });
  },
});

export const end = mutation({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      throw new Error("Utilisateur non authentifié.");
    }

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!conversation || conversation.profileId !== profile._id) {
      return null;
    }

    if (conversation.status === "completed") {
      return conversation._id;
    }

    const endedAt = Date.now();
    const durationSeconds = calculateDurationSeconds(conversation.startedAt, endedAt);
    const estimatedCostCredits = calculateEstimatedCostCredits(durationSeconds);
    const creditsOffered = normalizeCreditsOffered(profile.creditsOffered);
    const creditsUsed = normalizeCreditsUsed(profile.creditsUsed);
    const updatedCreditsUsed = normalizeCreditsUsed(creditsUsed + estimatedCostCredits);

    await ctx.db.patch(conversation._id, {
      endedAt: endedAt,
      durationSeconds,
      estimatedCostCredits,
      status: "completed",
      summary: buildSummary(conversation.transcript),
    });
    await ctx.db.patch(profile._id, {
      creditsOffered,
      creditsUsed: updatedCreditsUsed,
      updatedAt: Date.now(),
    });

    return conversation._id;
  },
});

function calculateDurationSeconds(startedAt, endedAt) {
  return Math.max(0, (endedAt - startedAt) / 1000);
}

function getConversationDurationSeconds(conversation) {
  if (typeof conversation.durationSeconds === "number") {
    return conversation.durationSeconds;
  }

  if (typeof conversation.endedAt === "number") {
    return calculateDurationSeconds(conversation.startedAt, conversation.endedAt);
  }

  return null;
}

function getConversationEstimatedCostCredits(conversation) {
  if (typeof conversation.estimatedCostCredits === "number") {
    return conversation.estimatedCostCredits;
  }

  const durationSeconds = getConversationDurationSeconds(conversation);
  if (typeof durationSeconds !== "number") {
    return null;
  }

  return calculateEstimatedCostCredits(durationSeconds);
}

function buildSummary(transcript) {
  if (!transcript.length) {
    return "Conversation démarrée sans message enregistré.";
  }

  return transcript
    .slice(0, 6)
    .map((message) => {
      const visibleText = sanitizeTranscriptText(message.text);
      return `${message.role === "agent" ? "Papote" : "Utilisateur"}: ${visibleText}`;
    })
    .join(" | ");
}

function sanitizeTranscriptText(text) {
  if (typeof text !== "string") {
    return "Message sans contenu visible.";
  }

  const visibleText = text
    .replace(/\[[^\]]*\]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return visibleText || "Message sans contenu visible.";
}
