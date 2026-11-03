-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
