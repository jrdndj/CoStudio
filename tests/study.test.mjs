import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";

const MOCK_CODE = "CS-FICTIONAL-PILOT";
const RESEARCHER_PASSWORD = "fictional-test-researcher-password";
const ENVIRONMENT_PROBE_SECRET = "fictional-session-signing-secret-for-testing";
let origin;
let server;
let directory;
let output = "";

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "costudio-fixtures-"));
  const port = await freePort();
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(directory, "fixture.db")}`,
    AI_BACKEND: "MOCK",
    OPENAI_API_KEY: "",
    MOCK_STUDY_CODE: MOCK_CODE,
    RESEARCHER_PASSWORD,
    SESSION_SECRET: ENVIRONMENT_PROBE_SECRET,
    STUDY_CONSENT_TEXT: "",
    STUDY_CONSENT_VERSION: "",
    STUDY_PROFILE_FIELDS: "experience,genres,status,tools,aiExperience,roles",
    COOKIE_SECURE: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "1000",
    COSTUDIO_TEST_BUILD_DIR: ".next-test",
  };
  const schema = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, encoding: "utf8" });
  assert.equal(schema.status, 0, schema.stdout + schema.stderr);
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) break;
    const response = await fetch(origin, { signal: AbortSignal.timeout(2500) }).catch(() => null);
    if (response?.ok) return;
    await delay(250);
  }
  assert.fail(`CoStudio did not start.\n${output}`);
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await closed;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function client() {
  let cookie = "";
  async function send(path, body, headers = {}) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "Content-Type": "application/json", origin } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const issued = response.headers.getSetCookie().at(-1);
    if (issued) cookie = issued.split(";")[0];
    return response;
  }
  async function post(path, action, payload = {}, expected = 200, headers) {
    const response = await send(path, { action, eventId: randomUUID(), ...payload }, headers);
    const value = await response.json();
    assert.equal(response.status, expected, `${path} ${action}: ${JSON.stringify(value)}
${response.ok ? "" : output.slice(-3000)}`);
    return value;
  }
  return {
    send,
    study: (action, body, expected, headers) => post("/api/study", action, body, expected, headers),
    research: (action, body, expected) => post("/api/research", action, body, expected),
  };
}

const prompt = "Help me consider transition choices for a fictional trio.";
const diaryAnswers = {
  goal: "Test a fictional arrangement.",
  usedAI: "yes",
  why: "I wanted to compare different options.",
  changes: "I kept a plan to listen back.",
  intention: "Mostly.",
  differently: "Leave more space for an undecided ending.",
};
const nodes = [
  { id: "listen", position: { x: 0, y: 0 }, data: { label: "Listen", preference: "human" } },
  { id: "arrange", position: { x: 288, y: 0 }, data: { label: "Arrange", preference: "conditional", notes: "Compare only when asked." } },
];

async function onboard(member, code, role = "Composer") {
  const entry = await member.study("redeem", { code });
  assert.equal(entry.participant.role, null);
  assert.equal(entry.participant.mode, "");
  await member.study("consent", { accepted: true, version: entry.settings.consentVersion });
  return member.study("profile", { role, roles: ["Performer"], experience: 4, genres: "Fictional chamber music" });
}

test("participants can negotiate, revise and persist creative work in mock mode", async () => {
  const participant = client();
  const guest = await participant.study("state");
  assert.equal(guest.participant, null);
  assert.equal(guest.settings.backend, "MOCK");
  assert.deepEqual(guest.artefacts, []);

  const initial = await onboard(participant, MOCK_CODE);
  const id = initial.participant.id;
  const publicId = initial.participant.publicId;
  const sessionId = initial.session.id;
  const selection = await participant.study("select", { role: "Composer", stage: "Explore", mode: "guide" });
  const suggestion = selection.settings.suggestions.find((item) => item.role === "Composer" && item.stage === "Explore");
  assert.ok(suggestion);
  await participant.study("prompt", { kind: "selected", text: suggestion.text, suggestionId: suggestion.id });
  const modified = suggestion.text + " Focus on a fictional trio.";
  await participant.study("prompt", { kind: "edited", text: modified, suggestionId: suggestion.id });
  const requestId = randomUUID();
  const request = { eventId: requestId, prompt: modified, promptSource: "modified", suggestionId: suggestion.id, outputType: "text" };
  const first = await participant.study("generate", request);
  assert.ok(first.artefact.text);
  assert.equal(first.artefact.promptSource, "modified");
  assert.equal(first.artefact.mode, "guide");
  assert.equal(first.artefact.backend, "MOCK");
  const original = first.artefact.id;
  const replay = await participant.study("generate", request);
  assert.equal(replay.artefact.id, original);
  assert.equal(replay.artefacts.length, 1);
  assert.equal(replay.events.filter((event) => event.type === "GENERATION_COMPLETED").length, 1);
  await participant.study("view", { artefactId: original });
  await participant.study("decision", { artefactId: original, decision: "reject", reflection: "The sketch was too dense." });
  await participant.study("annotate", { artefactId: original, text: "Leave the first transition open." });
  await participant.study("select", { mode: "collaborate" });
  await participant.study("decision", { artefactId: original, decision: "alternatives" });
  const revised = await participant.study("generate", { prompt, promptSource: "original", outputType: "text", parentId: original, variations: true });
  assert.equal(revised.artefact.parentId, original);
  assert.equal(revised.artefact.mode, "collaborate");
  assert.notEqual(revised.artefact.text, first.artefact.text);
  const revision = revised.artefact.id;
  const adapted = await participant.study("decision", {
    artefactId: revision, decision: "adapt", reflection: "Keep my ending open.", text: "I left the final measure empty.",
  });
  assert.equal(adapted.artefact.parentId, revision);
  assert.equal(adapted.artefact.origin, "human");
  const adaptedId = adapted.artefact.id;
  await participant.study("decision", { artefactId: adaptedId, decision: "accept" });
  await participant.study("select", { mode: "lead" });
  const visual = await participant.study("generate", { prompt, promptSource: "original", outputType: "concept", style: "monochrome wireframe" });
  assert.equal(visual.artefact.backend, "MOCK");
  assert.equal(visual.artefact.status, "completed");
  const image = await participant.send(visual.artefact.imageUrl);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\//);
  const workflow = await participant.study("generate", { prompt, promptSource: "original", outputType: "workflow" });
  assert.ok(workflow.artefact.workflow.nodes.length >= 2);
  await participant.study("select", { mode: "independent" });
  const blocked = await participant.send("/api/study", {
    action: "generate", eventId: randomUUID(), prompt, promptSource: "original", outputType: "text",
  });
  assert.ok([400, 403, 409].includes(blocked.status));
  assert.match((await blocked.json()).error, /independent/i);

  const snapshot = await participant.study("workflow", { title: "Fictional workflow", nodes, edges: [{ id: "one", source: "listen", target: "arrange" }] });
  assert.equal(snapshot.workflows[0].nodes[0].data.preference, "human");
  for (const [kind, content] of [["svg", /svg/], ["png", /png/]]) {
    const diagram = await participant.send(snapshot.workflows[0][kind]);
    assert.equal(diagram.status, 200);
    assert.match(diagram.headers.get("content-type"), content);
  }
  const diary = await participant.study("diary", { answers: diaryAnswers, artefactId: adaptedId });
  assert.equal(diary.diary[0].sessionId, sessionId);
  assert.equal(diary.diary[0].artefactId, adaptedId);
  const independentDiary = await participant.study("diary", { answers: { ...diaryAnswers, usedAI: "no" } });
  assert.equal(independentDiary.diary[0].artefactId, null);

  const future = await participant.study("future", {
    description: "A simple physical studio with written note cards.",
    acceptable: "Show options on request.",
    unacceptable: "Intervene during recording.",
    artefactId: visual.artefact.id,
    finalized: true,
  });
  assert.equal(future.future.finalized, true);

  const fixture = future.questionnaires.find((questionnaire) => questionnaire.id === "mock-demo");
  assert.ok(fixture);
  const answer = await participant.study("questionnaire", {
    instrumentId: fixture.id, version: fixture.version, responses: { interface: 4, notes: "Fictional observation" }, artefactId: adaptedId,
  });
  assert.equal(answer.responses[0].responses.interface, 4);
  assert.equal(answer.responses[0].version, fixture.version);
  await participant.study("logout");
  assert.equal((await participant.study("state")).participant, null);
  const resumed = await participant.study("redeem", { code: MOCK_CODE });
  assert.equal(resumed.participant.id, id);
  assert.equal(resumed.participant.publicId, publicId);
  assert.notEqual(resumed.session.id, sessionId);
  assert.ok(resumed.artefacts.some((item) => item.id === original && item.annotations.length === 1));
  assert.equal(resumed.diary.length, 2);
  assert.equal(resumed.responses.length, 1);
  assert.equal(resumed.workflows.length, 1);
  assert.ok(resumed.events.some((event) => event.type === "SESSION_ENDED" && event.sessionId === sessionId));
});

test("study routes restrict cross-participant resources and research exports", async () => {
  const researcher = client();
  assert.equal((await researcher.send("/api/research?format=json")).status, 401);
  await researcher.research("login", { password: RESEARCHER_PASSWORD });
  const secondCode = await researcher.research("createCode", {}, 201);
  const second = client();
  const secondState = await onboard(second, secondCode.code, "Performer");
  const first = client();
  const firstState = await first.study("redeem", { code: MOCK_CODE });
  const target = firstState.artefacts.find((artefact) => artefact.imageUrl);
  assert.ok(target);
  assert.notEqual(firstState.participant.id, secondState.participant.id);
  assert.deepEqual(secondState.artefacts, []);

  for (const [action, payload] of [
    ["view", { artefactId: target.id }],
    ["annotate", { artefactId: target.id, text: "Unauthorized annotation" }],
    ["diary", { answers: diaryAnswers, artefactId: target.id }],
  ]) await second.study(action, payload, 404);
  assert.equal((await second.send(target.imageUrl)).status, 404);
  assert.equal((await client().send(target.imageUrl)).status, 401);
  assert.equal((await second.send("/api/research?format=csv")).status, 401);
  const foreignOrigin = await second.send("/api/study", {
    action: "select", eventId: randomUUID(), mode: "guide",
  }, { origin: "https://foreign.invalid" });
  assert.equal(foreignOrigin.status, 403);

  const id = firstState.participant.id;
  const summary = await researcher.research("participant", { id });
  assert.equal(summary.participants[0].id, id);
  assert.ok(summary.events.length > 15);
  const exportPath = (format) => `/api/research?participant=${id}&format=${format}`;
  const exported = await researcher.send(exportPath("json"));
  assert.equal(exported.status, 200);
  const json = await exported.text();
  assert.ok(json.includes(firstState.participant.publicId));
  assert.ok(!json.includes(secondState.participant.publicId));
  assert.ok(!json.includes("tokenHash") && !json.includes("codeHash"));
  const events = await researcher.send(exportPath("jsonl"));
  const rows = (await events.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(rows.length > 15);
  assert.ok(rows.every((event) => event.participantId === id && event.createdAt.endsWith("Z")));
  assert.equal(new Set(rows.map((event) => event.id)).size, rows.length);
  const csv = await researcher.send(exportPath("csv"));
  const csvText = await csv.text();
  assert.match(csvText, /itemId/);
  assert.match(csvText, /GENERATION_COMPLETED/);
  assert.match(csvText, /fixture-1/);
  const zip = await researcher.send(exportPath("zip"));
  assert.equal(zip.status, 200);
  const archive = await JSZip.loadAsync(await zip.arrayBuffer());
  assert.ok(Object.keys(archive.files).some((name) => name.endsWith(".png")));
  assert.ok(Object.keys(archive.files).some((name) => name.endsWith(".svg")));

  await researcher.research("deleteParticipant", { id, confirmation: firstState.participant.publicId, protocolConfirmed: true });
  assert.equal((await first.study("state")).participant, null);
  assert.equal((await researcher.send(exportPath("json"))).status, 404);
  assert.equal((await second.study("state")).participant.id, secondState.participant.id);
});
