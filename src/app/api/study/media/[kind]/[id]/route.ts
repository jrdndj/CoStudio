import { type NextRequest } from "next/server";
import { getStudyConfig } from "@/server/config";
import { db } from "@/server/db";
import { readImageData } from "@/server/security";
import { sessionFromRequest } from "@/server/session";
import { hasCurrentConsent } from "@/server/study-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }) {
  const session = await sessionFromRequest(request);
  if (!session || !hasCurrentConsent(session.participant, await getStudyConfig())) {
    return new Response("Authentication required.", { status: 401 });
  }
  const { kind, id } = await context.params;
  const where = { id, participantId: session.participantId };
  let value: string | null | undefined;
  if (kind === "artefact") {
    value = (await db.artefact.findFirst({ where, select: { imageUrl: true } }))?.imageUrl;
  } else if (kind === "upload") {
    value = (await db.upload.findFirst({ where, select: { dataUrl: true } }))?.dataUrl;
  } else if (kind === "png" || kind === "svg") {
    const snapshot = await db.workflowSnapshot.findFirst({ where, select: { svg: true, png: true } });
    value = snapshot?.[kind];
  }
  if (!value) return new Response("File not found.", { status: 404 });

  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  if (kind === "svg") return new Response(value, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
  const { data, format } = readImageData(value, 12 * 1024 * 1024);
  return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Type": `image/${format}` } });
}
