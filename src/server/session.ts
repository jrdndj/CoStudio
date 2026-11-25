import { createHmac, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { type NextRequest, type NextResponse } from "next/server";
import { backendMode, integerEnv } from "./config";
import { db } from "./db";
import { hashStudyCode, newToken, stableHash, StudyError } from "./security";

export const participantCookie = "costudio_participant";
const sessionInclude = { participant: true } as const;
export type ParticipantSession = NonNullable<Awaited<ReturnType<typeof findSession>>>;

function findSession(tokenHash: string) {
  return db.studySession.findUnique({ where: { tokenHash }, include: sessionInclude });
}

export function recordEvent(
  tx: Prisma.TransactionClient,
  session: { id: string; participantId: string },
  id: string,
  type: string,
  data: Prisma.InputJsonObject = {},
  artefactId?: string,
) {
  return tx.researchEvent.create({
    data: { id, participantId: session.participantId, sessionId: session.id, type, data, artefactId, createdAt: new Date() },
  });
}

export function researchEventId(key: string, type: string) {
  return stableHash(`event:${key}:${type}`);
}

export async function endSession(session: ParticipantSession, reason: "signed-out" | "expired" | "changed-code") {
  await db.$transaction(async (tx) => {
    const ended = await tx.studySession.updateMany({
      where: { id: session.id, endedAt: null },
      data: { endedAt: reason === "expired" ? session.expiresAt : new Date() },
    });
    if (ended.count) {
      await recordEvent(tx, session, researchEventId(session.id, "SESSION_ENDED"), "SESSION_ENDED", { reason });
    }
  });
}

export async function sessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(participantCookie)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await findSession(stableHash(token));
  if (!session || session.endedAt) return null;
  if (session.expiresAt.getTime() > Date.now()) return session;
  await endSession(session, "expired");
  return null;
}

let rateWindow = 0;
let attempts = 0;
function limitRedeem() {
  const now = Date.now();
  if (now - rateWindow > 60_000) {
    rateWindow = now;
    attempts = 0;
  }
  if (attempts >= integerEnv("STUDY_CODE_ATTEMPTS_PER_MINUTE", 100, 5, 10000)) {
    throw new StudyError("Too many code attempts. Wait a minute and try again.", 429);
  }
  attempts += 1;
}

export function cookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true" || request.nextUrl.protocol === "https:",
    path: "/",
  };
}

export function clearParticipantCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(participantCookie, "", { ...cookieOptions(request), maxAge: 0 });
}

export function setParticipantCookie(response: NextResponse, request: NextRequest, token: string, expires: Date) {
  response.cookies.set(participantCookie, token, { ...cookieOptions(request), expires });
}

export async function redeemCode(codeText: string, request: NextRequest, eventId?: string) {
  limitRedeem();
  const codeHash = hashStudyCode(codeText);
  const demoCode = backendMode() === "MOCK" && process.env.MOCK_STUDY_CODE?.trim();
  if (demoCode && hashStudyCode(demoCode) === codeHash) {
    await db.studyCode.upsert({ where: { codeHash }, create: { codeHash }, update: {} });
  }
  const code = await db.studyCode.findUnique({ where: { codeHash } });
  if (!code || (code.expiresAt && code.expiresAt.getTime() <= Date.now())) {
    throw new StudyError("This study code is invalid or expired.", 401);
  }
  const current = await sessionFromRequest(request);
  if (current?.participant.codeId === code.id) return { session: current, token: null };

  const retryToken = eventId
    ? createHmac("sha256", codeText.trim().toUpperCase()).update(`costudio-redeem:${eventId}`).digest("base64url")
    : newToken();
  const retried = await findSession(stableHash(retryToken));
  if (retried && !retried.endedAt && retried.expiresAt.getTime() > Date.now()) return { session: retried, token: retryToken };
  const token = retried ? newToken() : retryToken;
  const tokenHash = stableHash(token);
  const expiresAt = new Date(Date.now() + integerEnv("SESSION_TTL_HOURS", 168, 1, 24 * 90) * 3_600_000);
  const session = await db.$transaction(async (tx) => {
    const participant = await tx.participant.upsert({
      where: { codeId: code.id },
      create: { codeId: code.id, publicId: `P-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}` },
      update: {},
    });
    const newSession = await tx.studySession.create({
      data: { participantId: participant.id, tokenHash, expiresAt, createdAt: new Date() },
      include: sessionInclude,
    });
    await recordEvent(tx, newSession, researchEventId(newSession.id, "SESSION_STARTED"), "SESSION_STARTED", {
      returningParticipant: participant.consentAt !== null,
    });
    if (current) {
      const ended = await tx.studySession.updateMany({ where: { id: current.id, endedAt: null }, data: { endedAt: new Date() } });
      if (ended.count) await recordEvent(tx, current, researchEventId(current.id, "SESSION_ENDED"), "SESSION_ENDED", { reason: "changed-code" });
    }
    const expired = await tx.studySession.findMany({
      where: { participantId: participant.id, endedAt: null, expiresAt: { lte: new Date() } },
      select: { id: true, participantId: true, expiresAt: true },
    });
    for (const previous of expired) {
      await tx.studySession.update({ where: { id: previous.id }, data: { endedAt: previous.expiresAt } });
      await recordEvent(tx, previous, researchEventId(previous.id, "SESSION_ENDED"), "SESSION_ENDED", { reason: "expired", effectiveEnd: previous.expiresAt.toISOString() });
    }
    return newSession;
  }).catch(async (error: unknown) => {
    const retry = await findSession(tokenHash);
    if (retry && !retry.endedAt && retry.expiresAt.getTime() > Date.now()) return retry;
    throw error;
  });
  return { session, token };
}
