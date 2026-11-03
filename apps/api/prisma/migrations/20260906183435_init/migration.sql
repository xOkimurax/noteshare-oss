-- CreateEnum
CREATE TYPE "MemoType" AS ENUM ('note', 'list');

-- CreateEnum
CREATE TYPE "KanbanStatus" AS ENUM ('pending', 'in-progress', 'completed');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'accepted', 'rejected', 'blocked');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firebaseId" TEXT,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "photoURL" TEXT NOT NULL DEFAULT '',
    "frequentCollaborators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "firebaseId" TEXT,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memo" (
    "id" TEXT NOT NULL,
    "firebaseId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "type" "MemoType" NOT NULL DEFAULT 'note',
    "color" TEXT NOT NULL DEFAULT '#ffffff',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kanbanStatus" "KanbanStatus" NOT NULL DEFAULT 'pending',
    "kanbanTimeLogs" JSONB NOT NULL DEFAULT '{}',
    "dueDate" TIMESTAMP(3),
    "location" JSONB,
    "folderId" TEXT,
    "ownerId" TEXT NOT NULL,
    "shareCode" TEXT,
    "shareName" TEXT,
    "allowAnyone" BOOLEAN NOT NULL DEFAULT false,
    "allowedEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoImage" (
    "id" TEXT NOT NULL,
    "memoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoCollaborator" (
    "id" TEXT NOT NULL,
    "memoId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaborationRequest" (
    "id" TEXT NOT NULL,
    "firebaseId" TEXT,
    "memoId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaborationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseId_key" ON "User"("firebaseId");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_firebaseId_key" ON "Folder"("firebaseId");

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Memo_firebaseId_key" ON "Memo"("firebaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Memo_shareCode_key" ON "Memo"("shareCode");

-- CreateIndex
CREATE UNIQUE INDEX "Memo_publicSlug_key" ON "Memo"("publicSlug");

-- CreateIndex
CREATE INDEX "Memo_ownerId_idx" ON "Memo"("ownerId");

-- CreateIndex
CREATE INDEX "Memo_folderId_idx" ON "Memo"("folderId");

-- CreateIndex
CREATE INDEX "Memo_isPublic_idx" ON "Memo"("isPublic");

-- CreateIndex
CREATE INDEX "MemoImage_memoId_idx" ON "MemoImage"("memoId");

-- CreateIndex
CREATE INDEX "MemoCollaborator_memoId_idx" ON "MemoCollaborator"("memoId");

-- CreateIndex
CREATE INDEX "MemoCollaborator_userId_idx" ON "MemoCollaborator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoCollaborator_memoId_userId_key" ON "MemoCollaborator"("memoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoCollaborator_memoId_email_key" ON "MemoCollaborator"("memoId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationRequest_firebaseId_key" ON "CollaborationRequest"("firebaseId");

-- CreateIndex
CREATE INDEX "CollaborationRequest_toEmail_idx" ON "CollaborationRequest"("toEmail");

-- CreateIndex
CREATE INDEX "CollaborationRequest_memoId_idx" ON "CollaborationRequest"("memoId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memo" ADD CONSTRAINT "Memo_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memo" ADD CONSTRAINT "Memo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoImage" ADD CONSTRAINT "MemoImage_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "Memo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoCollaborator" ADD CONSTRAINT "MemoCollaborator_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "Memo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoCollaborator" ADD CONSTRAINT "MemoCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
