-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "groupPhoto" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");
