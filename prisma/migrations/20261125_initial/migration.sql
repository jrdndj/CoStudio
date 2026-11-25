-- CreateTable
CREATE TABLE "StudyCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "consentAt" DATETIME,
    "consentVersion" TEXT,
    "role" TEXT,
    "roles" JSONB NOT NULL DEFAULT [],
    "experience" INTEGER,
    "genres" TEXT,
    "status" TEXT,
    "tools" TEXT,
    "aiExperience" TEXT,
    "activeRole" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Initiate',
    "mode" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Participant_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "StudyCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "StudySession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'study',
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL DEFAULT 'builtin-1',
    "allowedModes" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "questionnaires" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ResearchEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "artefactId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyMutation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resultId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudyMutation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudyMutation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artefact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentId" TEXT,
    "requestKey" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "systemPrompt" TEXT,
    "imagePrompt" TEXT,
    "prompt" TEXT NOT NULL,
    "promptSource" TEXT NOT NULL,
    "suggestionId" TEXT,
    "mode" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" TEXT,
    "reflection" TEXT,
    "imageUrl" TEXT,
    "workflow" JSONB,
    CONSTRAINT "Artefact_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artefact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artefact_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Artefact" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "artefactId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Annotation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_artefactId_fkey" FOREIGN KEY ("artefactId") REFERENCES "Artefact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "artefactId" TEXT,
    "attachmentId" TEXT,
    "answers" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiaryEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiaryEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Upload_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "svg" TEXT,
    "png" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowSnapshot_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FutureProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptable" TEXT NOT NULL,
    "unacceptable" TEXT NOT NULL,
    "sketchId" TEXT,
    "artefactId" TEXT,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FutureProposal_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FutureProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "activity" TEXT,
    "artefactId" TEXT,
    "responses" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionnaireResponse_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionnaireResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyCode_codeHash_key" ON "StudyCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_publicId_key" ON "Participant"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_codeId_key" ON "Participant"("codeId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySession_tokenHash_key" ON "StudySession"("tokenHash");

-- CreateIndex
CREATE INDEX "StudySession_participantId_createdAt_idx" ON "StudySession"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchEvent_participantId_createdAt_idx" ON "ResearchEvent"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchEvent_sessionId_createdAt_idx" ON "ResearchEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchEvent_artefactId_createdAt_idx" ON "ResearchEvent"("artefactId", "createdAt");

-- CreateIndex
CREATE INDEX "StudyMutation_participantId_action_idx" ON "StudyMutation"("participantId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Artefact_requestKey_key" ON "Artefact"("requestKey");

-- CreateIndex
CREATE INDEX "Artefact_participantId_createdAt_idx" ON "Artefact"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "Artefact_parentId_idx" ON "Artefact"("parentId");

-- CreateIndex
CREATE INDEX "Artefact_backend_status_idx" ON "Artefact"("backend", "status");

-- CreateIndex
CREATE INDEX "Annotation_artefactId_createdAt_idx" ON "Annotation"("artefactId", "createdAt");

-- CreateIndex
CREATE INDEX "DiaryEntry_participantId_createdAt_idx" ON "DiaryEntry"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "Upload_participantId_createdAt_idx" ON "Upload"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowSnapshot_participantId_createdAt_idx" ON "WorkflowSnapshot"("participantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FutureProposal_participantId_key" ON "FutureProposal"("participantId");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_participantId_createdAt_idx" ON "QuestionnaireResponse"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_instrumentId_version_idx" ON "QuestionnaireResponse"("instrumentId", "version");

