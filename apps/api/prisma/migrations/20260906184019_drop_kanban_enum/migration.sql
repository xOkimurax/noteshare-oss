/*
  Warnings:

  - The `kanbanStatus` column on the `Memo` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Memo" DROP COLUMN "kanbanStatus",
ADD COLUMN     "kanbanStatus" TEXT NOT NULL DEFAULT 'pending';

-- DropEnum
DROP TYPE "KanbanStatus";
