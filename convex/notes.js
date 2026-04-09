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
