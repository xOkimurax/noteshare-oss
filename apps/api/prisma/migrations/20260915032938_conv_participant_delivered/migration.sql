-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN     "lastDeliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
