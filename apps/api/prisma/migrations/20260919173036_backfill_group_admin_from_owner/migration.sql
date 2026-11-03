-- Groups created before the "N admins" migration (20260917033502) never got
-- an admin backfilled onto them — ConversationParticipant.isAdmin defaulted
-- to false for everyone, including the original owner, so nobody could add
-- members, promote another admin, or change the group photo anymore. Fix:
-- for every group with zero current admins, promote whoever Conversation.
-- ownerId still points at (the original creator, kept purely informational
-- since that migration, but still accurate).
UPDATE "ConversationParticipant" cp
SET "isAdmin" = true
FROM "Conversation" c
WHERE cp."conversationId" = c.id
  AND c."isGroup" = true
  AND cp."userId" = c."ownerId"
  AND NOT EXISTS (
    SELECT 1 FROM "ConversationParticipant" cp2
    WHERE cp2."conversationId" = c.id AND cp2."isAdmin" = true
  );
