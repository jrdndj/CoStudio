# CoStudio implementation plan

1. Establish the study boundary. Create the database, participant code exchange, consent and profile flows, scoped sessions, and an append-only event stream. Connect the prompt library and collaboration modes to text generation.
2. Preserve creative negotiation. Add structured outputs, visual generation, parent-linked versions, decisions, participant annotations, and the micro-diary.
3. Add participant-controlled creation. Implement editable workflow snapshots with SVG and PNG export, sketching and upload, and the Future Studio scenario.
4. Enable researcher review. Add study configuration, versioned questionnaires, participant inspection and withdrawal, machine-readable exports, and a gated pictorial export.
5. Verify the prototype against a fresh SQLite database using fictional mock records. Exercise authentication, lifecycle events, generation modes, unauthorized reads, and export.

## Project structure

```text
prisma/                   Database schema and migrations
src/app/                  Next.js UI, researcher area, and route handlers
src/components/           Participant workspace and study modules
src/lib/                  Shared types and client-safe configuration
src/server/               Persistence, generation, and research export logic
tests/                    Automated integration checks
```

## Data design

A participant has a pseudonymous identifier and potentially many authenticated sessions. Sessions carry the active role, creative stage, and mode. Participant-owned artefacts preserve immutable generated content and parent links. Negotiation decisions and annotations remain available in the event stream. Workflow snapshots, diary entries, questionnaire responses, sketches, and Future Studio proposals attach to the participant and, where applicable, to a session or artefact. The Prisma schema and migrations are the source of truth for relations, constraints, and defaults.
