import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const recentForCurrent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!userId) {
      return [];
    }

    const limit = clampLimit(args.limit);
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    return notes.map(formatNote);
  },
});

export const createForCurrent = mutation({
  args: {
    content: v.string(),
    noteType: v.optional(v.string()),
    noteDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const content = args.content.trim();
    const noteType = args.noteType?.trim() || "général";

    if (!content) {
      throw new Error("Le contenu de la note est obligatoire.");
    }

    const parsedNoteDate = parseOptionalDateValue(args.noteDate);
    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      userId,
      content,
      noteType,
      noteDate: parsedNoteDate.timestamp,
      noteDateLabel: parsedNoteDate.label,
      createdAt: now,
      updatedAt: now,
    });

    const note = await ctx.db.get(noteId);
    if (!note) {
      throw new Error("Impossible de récupérer la note créée.");
    }

    return formatNote(note);
  },
});

export const findForCurrent = query({
  args: {
    content: v.optional(v.string()),
    query: v.optional(v.string()),
    noteType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (!userId) {
      return null;
    }

    const queryText = (args.query?.trim() || args.content?.trim() || "").trim();
    const normalizedQuery = normalizeSearchText(queryText);
    const normalizedType = normalizeSearchText(args.noteType?.trim() || "");

    if (!normalizedQuery) {
      return null;
    }

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    const match = findBestNoteMatch(notes, normalizedQuery, normalizedType);
    return match ? formatNote(match) : null;
  },
});

export const deleteForCurrent = mutation({
  args: {
    noteId: v.optional(v.id("notes")),
    content: v.optional(v.string()),
    query: v.optional(v.string()),
    noteType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const directId = args.noteId;

    if (directId) {
      const directNote = await ctx.db.get(directId);
      if (!directNote || directNote.userId !== userId) {
        throw new Error("Impossible de retrouver cette note.");
      }

      await ctx.db.delete(directId);
      return formatNote(directNote);
    }

    const queryText = (args.query?.trim() || args.content?.trim() || "").trim();
    const normalizedQuery = normalizeSearchText(queryText);
    const normalizedType = normalizeSearchText(args.noteType?.trim() || "");

    if (!normalizedQuery) {
      throw new Error("Le contenu de la note à supprimer est manquant.");
    }

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    const match = findBestNoteMatch(notes, normalizedQuery, normalizedType);
    if (!match) {
      throw new Error("Aucune note correspondante n'a été trouvée.");
    }

    await ctx.db.delete(match._id);
    return formatNote(match);
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

function parseOptionalDateValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { timestamp: undefined, label: undefined };
  }

  const normalizedValue = value.trim();
  const timestamp = Date.parse(normalizedValue);
  if (!Number.isFinite(timestamp)) {
    return { timestamp: undefined, label: normalizedValue };
  }

  return {
    timestamp,
    label: normalizedValue,
  };
}

function clampLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 8;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 20);
}

function formatNote(note) {
  return {
    _id: note._id,
    userId: note.userId,
    content: note.content,
    noteType: note.noteType,
    noteDate: note.noteDate ?? null,
    noteDateLabel: note.noteDateLabel ?? "",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function findBestNoteMatch(notes, normalizedQuery, normalizedType) {
  const scoredNotes = notes
    .map((note) => ({
      note,
      score: getNoteMatchScore(note, normalizedQuery, normalizedType),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredNotes[0]?.note ?? null;
}

function getNoteMatchScore(note, normalizedQuery, normalizedType) {
  const normalizedContent = normalizeSearchText(note.content);
  if (!normalizedContent) {
    return 0;
  }

  let score = 0;
  if (normalizedContent === normalizedQuery) {
    score += 120;
  } else if (
    normalizedContent.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedContent)
  ) {
    score += 80;
  } else {
    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const matchingWords = queryWords.filter((word) => normalizedContent.includes(word));
    score += matchingWords.length * 15;
  }

  if (normalizedType) {
    const currentType = normalizeSearchText(note.noteType);
    if (currentType === normalizedType) {
      score += 30;
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
