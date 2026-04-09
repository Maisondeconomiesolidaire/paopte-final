import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upcomingForCurrent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!userId) {
      return [];
    }

    const limit = clampLimit(args.limit);
    const startAtFloor = getStartOfTodayUtc();
    const events = await ctx.db
      .query("events")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId).gte("startAt", startAtFloor))
      .order("asc")
      .take(limit);

    return events.map(formatEvent);
  },
});

export const createForCurrent = mutation({
  args: {
    title: v.string(),
    startAt: v.string(),
    endAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const title = args.title.trim();

    if (!title) {
      throw new Error("Le motif de l'evenement est obligatoire.");
    }

    const startAt = parseDateValue(args.startAt, "date de debut");
    const endAt = args.endAt ? parseDateValue(args.endAt, "date de fin") : undefined;

    if (typeof endAt === "number" && endAt < startAt) {
      throw new Error("La date de fin doit etre posterieure a la date de debut.");
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      userId,
      title,
      startAt,
      endAt,
      createdAt: now,
      updatedAt: now,
    });

    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new Error("Impossible de recuperer l'evenement cree.");
    }

    return formatEvent(event);
  },
});

async function getCurrentUserId(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

async function requireCurrentUserId(ctx) {
  const userId = await getCurrentUserId(ctx);
  if (!userId) {
    throw new Error("Utilisateur non authentifie.");
  }

  return userId;
}

function parseDateValue(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`La ${label} fournie est invalide.`);
  }

  return timestamp;
}

function clampLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 8;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 20);
}

function getStartOfTodayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function formatEvent(event) {
  return {
    _id: event._id,
    userId: event.userId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
