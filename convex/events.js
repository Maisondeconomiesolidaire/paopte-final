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
    const events = await ctx.db
      .query("events")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .order("asc")
      .take(50);

    const visibleEvents = events
      .filter((event) => isUpcomingOrRecentlyCreated(event))
      .slice(0, limit);

    return visibleEvents.map(formatEvent);
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
      throw new Error("Le titre de l'évènement est obligatoire.");
    }

    const startAt = parseDateValue(args.startAt, "date de début");
    const endAt = args.endAt ? parseDateValue(args.endAt, "date de fin") : undefined;

    if (typeof endAt === "number" && endAt < startAt) {
      throw new Error("La date de fin doit être postérieure à la date de début.");
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
      throw new Error("Impossible de récupérer l'évènement créé.");
    }

    return formatEvent(event);
  },
});

export const findForCurrent = query({
  args: {
    title: v.optional(v.string()),
    query: v.optional(v.string()),
    startAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!userId) {
      return null;
    }

    const queryText = (args.query?.trim() || args.title?.trim() || "").trim();
    const normalizedQuery = normalizeSearchText(queryText);
    const requestedTimestamp = args.startAt ? tryParseDateValue(args.startAt) : null;

    if (!normalizedQuery) {
      return null;
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .order("asc")
      .take(200);

    const match = findBestEventMatch(events, normalizedQuery, requestedTimestamp);
    return match ? formatEvent(match) : null;
  },
});

export const consumeTodayRemindersForCurrent = mutation({
  args: {
    dayStart: v.string(),
    dayEnd: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const dayStart = parseDateValue(args.dayStart, "début de journée");
    const dayEnd = parseDateValue(args.dayEnd, "fin de journée");

    if (dayEnd <= dayStart) {
      throw new Error("La fenêtre des rappels du jour est invalide.");
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .order("asc")
      .take(200);

    const reminderCandidates = events.filter(
      (event) =>
        event.startAt >= dayStart &&
        event.startAt < dayEnd &&
        typeof event.autoReminderSentAt !== "number"
    );

    if (reminderCandidates.length === 0) {
      return [];
    }

    const now = Date.now();
    for (const event of reminderCandidates) {
      await ctx.db.patch(event._id, {
        autoReminderSentAt: now,
        updatedAt: now,
      });
    }

    return reminderCandidates.map(formatEvent);
  },
});

export const deleteForCurrent = mutation({
  args: {
    eventId: v.optional(v.id("events")),
    title: v.optional(v.string()),
    query: v.optional(v.string()),
    startAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const directId = args.eventId;

    if (directId) {
      const directEvent = await ctx.db.get(directId);
      if (!directEvent || directEvent.userId !== userId) {
        throw new Error("Impossible de retrouver cet évènement.");
      }

      await ctx.db.delete(directId);
      return formatEvent(directEvent);
    }

    const queryText = (args.query?.trim() || args.title?.trim() || "").trim();
    const normalizedQuery = normalizeSearchText(queryText);
    const requestedTimestamp = args.startAt ? tryParseDateValue(args.startAt) : null;

    if (!normalizedQuery) {
      throw new Error("Le nom ou la description de l'évènement à supprimer est manquant.");
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .order("asc")
      .take(200);

    const match = findBestEventMatch(events, normalizedQuery, requestedTimestamp);
    if (!match) {
      throw new Error("Aucun évènement correspondant n'a été trouvé.");
    }

    await ctx.db.delete(match._id);
    return formatEvent(match);
  },
});

async function getCurrentUserId(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

async function requireCurrentUserId(ctx) {
  const userId = await getCurrentUserId(ctx);
  if (!userId) {
    throw new Error("Utilisateur non authentifié.");
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

function formatEvent(event) {
  return {
    _id: event._id,
    userId: event.userId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt ?? null,
    autoReminderSentAt: event.autoReminderSentAt ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function isUpcomingOrRecentlyCreated(event) {
  const now = Date.now();
  const recentWindowMs = 24 * 60 * 60 * 1000;
  const effectiveEndAt = typeof event.endAt === "number" ? event.endAt : event.startAt;

  return effectiveEndAt >= now - recentWindowMs;
}

function findBestEventMatch(events, normalizedQuery, requestedTimestamp) {
  const scoredEvents = events
    .map((event) => ({
      event,
      score: getEventMatchScore(event, normalizedQuery, requestedTimestamp),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Math.abs((left.event.startAt || 0) - (requestedTimestamp || Date.now())) -
        Math.abs((right.event.startAt || 0) - (requestedTimestamp || Date.now()));
    });

  return scoredEvents[0]?.event ?? null;
}

function getEventMatchScore(event, normalizedQuery, requestedTimestamp) {
  const normalizedTitle = normalizeSearchText(event.title);
  if (!normalizedTitle) {
    return 0;
  }

  let score = 0;
  if (normalizedTitle === normalizedQuery) {
    score += 120;
  } else if (
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle)
  ) {
    score += 80;
  } else {
    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const matchingWords = queryWords.filter((word) => normalizedTitle.includes(word));
    score += matchingWords.length * 15;
  }

  if (requestedTimestamp) {
    const distance = Math.abs(event.startAt - requestedTimestamp);
    if (distance <= 2 * 60 * 60 * 1000) {
      score += 40;
    } else if (distance <= 24 * 60 * 60 * 1000) {
      score += 20;
    }
  }

  return score;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tryParseDateValue(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
