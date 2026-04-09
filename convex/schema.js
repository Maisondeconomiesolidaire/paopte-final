import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    externalId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    age: v.number(),
    city: v.string(),
    addressLabel: v.optional(v.string()),
    postcode: v.optional(v.string()),
    bio: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    creditsOffered: v.optional(v.number()),
    creditsUsed: v.optional(v.number()),
    onboardingCompleted: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_external_id", ["externalId"]),
  conversations: defineTable({
    externalId: v.string(),
    profileId: v.id("profiles"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    status: v.string(),
    messageCount: v.number(),
    estimatedCostCredits: v.optional(v.number()),
    summary: v.optional(v.string()),
    transcript: v.array(
      v.object({
        role: v.string(),
        text: v.string(),
        timestamp: v.string(),
      })
    ),
  })
    .index("by_external_id", ["externalId"])
    .index("by_profile_started", ["profileId", "startedAt"]),
  events: defineTable({
    userId: v.string(),
    title: v.string(),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_startAt", ["userId", "startAt"]),
  notes: defineTable({
    userId: v.string(),
    content: v.string(),
    noteType: v.string(),
    noteDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_createdAt", ["userId", "createdAt"]),
});
