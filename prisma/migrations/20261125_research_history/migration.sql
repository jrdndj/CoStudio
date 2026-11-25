-- CreateTable
CREATE TABLE "ResearchConfigRevision" (
    "version" TEXT NOT NULL PRIMARY KEY,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "artefactId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ResearchEvent" ("artefactId", "createdAt", "data", "id", "participantId", "sessionId", "type") SELECT "artefactId", "createdAt", "data", "id", "participantId", "sessionId", "type" FROM "ResearchEvent" ORDER BY rowid;
DROP TABLE "ResearchEvent";
ALTER TABLE "new_ResearchEvent" RENAME TO "ResearchEvent";
CREATE UNIQUE INDEX "ResearchEvent_id_key" ON "ResearchEvent"("id");
CREATE INDEX "ResearchEvent_participantId_createdAt_idx" ON "ResearchEvent"("participantId", "createdAt");
CREATE INDEX "ResearchEvent_sessionId_createdAt_idx" ON "ResearchEvent"("sessionId", "createdAt");
CREATE INDEX "ResearchEvent_artefactId_createdAt_idx" ON "ResearchEvent"("artefactId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

