import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStudyConfig } from "@/server/config";
import { generate } from "@/server/generation";
import { mutate, mutationKey } from "@/server/mutations";
import { maxImageBytes, StudyError } from "@/server/security";
import { clearParticipantCookie, endSession, redeemCode, sessionFromRequest, setParticipantCookie } from "@/server/session";
import { hasCurrentConsent, loadState } from "@/server/study-state";
import { studyAction } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function assertSameSite(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const host = request.headers.get("host") || request.nextUrl.host;
  if (fetchSite === "cross-site" || (origin && origin !== request.nextUrl.origin && !["https://" + host, "http://" + host].includes(origin))) {
    throw new StudyError("This request did not originate in the study application.", 403);
  }
}

async function readJson(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new StudyError("Send a JSON study request.", 415);
  }
  const maxBytes = Math.ceil(maxImageBytes() / 3) * 4 + 96 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new StudyError("The request exceeds the study upload limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new StudyError("The request body is missing.");
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new StudyError("The request exceeds the study upload limit.", 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new StudyError("The study request is invalid JSON.");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameSite(request);
    const validated = studyAction.safeParse(await readJson(request));
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new StudyError(`Please check ${issue?.path.join(".") || "the request"}: ${issue?.message || "invalid input"}.`);
    }
    const action = validated.data;
    const config = await getStudyConfig();
    if (action.action === "redeem") {
      const { session, token } = await redeemCode(action.code, request, action.eventId);
      const response = reply(await loadState(config, session));
      if (token) setParticipantCookie(response, request, token, session.expiresAt);
      return response;
    }
    const session = await sessionFromRequest(request);
    if (action.action === "state") return reply(await loadState(config, session));
    if (action.action === "logout") {
      if (session) await endSession(session, "signed-out");
      const response = reply({ ok: true });
      clearParticipantCookie(response, request);
      return response;
    }
    if (!session) throw new StudyError("Enter a study code first.", 401);
    if (action.action !== "consent" && !hasCurrentConsent(session.participant, config)) {
      throw new StudyError("Review the study information and record consent first.", 403);
    }
    if (action.action !== "consent" && action.action !== "profile" && !session.participant.role) {
      throw new StudyError("Complete the participant profile first.", 409);
    }

    const key = mutationKey(session, action.action, action.eventId ?? randomUUID());
    if (action.action === "generate") {
      const result = await generate(action, config, session, key);
      return reply({ ...await loadState(config, session), ...result }, result.error ? 502 : 200);
    }
    return reply({ ...await mutate(action, config, session, key), ...await loadState(config, session) });
  } catch (error) {
    if (error instanceof StudyError) return reply({ error: error.message }, error.status);
    // Avoid logging request bodies or provider payloads to the host process.
    console.error("CoStudio study request failed:", error instanceof Error ? error.name : "Unknown error");
    return reply({ error: "The study could not process this request. Try again or contact the researcher." }, 500);
  }
}
