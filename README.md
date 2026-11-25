# CoStudio

**Your music. Your process.**

CoStudio is a research prototype for studying creative agency and human–AI collaboration in music-making. Participants work with editable prompts, choose how much help to request, and record what they keep, change, or reject. Researchers can review those choices alongside the artefacts and export records for analysis.

## Run the local pilot

You need Node.js 22 or later and npm. Start in the directory containing `package.json`.

```sh
npm ci
cp .env.example .env
```

Edit `.env` and set these two values for the fictional pilot:

```dotenv
AI_BACKEND=MOCK
MOCK_STUDY_CODE=CS-STUDIO-DEMO
```

To try the researcher dashboard, also set `RESEARCHER_PASSWORD` to a password of your choice and `SESSION_SECRET` to a strong random secret. Keep `OPENAI_API_KEY` empty for the local pilot.

```sh
npm run db:setup
npm run dev
```

Open [the participant workspace](http://localhost:3000/) and enter `CS-STUDIO-DEMO`. Complete the fictional pilot notice and select a musical role. Choose a collaboration mode, try a suggested or original prompt, and review the response. Use [researcher access](http://localhost:3000/research) for study configuration and exports. The same code resumes the same participant record. Issue a separate code to each person when setting up a study.

If local Next.js file watching encounters a file-descriptor error, start it with `WATCHPACK_POLLING=1000 npm run dev`.

## Participant activities

- **My Creative Workspace** supports role- and stage-specific prompt suggestions, five output types, participant sketches, decisions and annotations. Choose **Adapt** to create a participant-authored version, or **Write a revision prompt** to request an AI revision. Use **Versions** to reopen past artefacts and **Compare versions** to view two together.
- **My Creative Workflow** supports draggable activities and connections, AI-involvement preferences, notes, immutable snapshots, and SVG/PNG downloads.
- **Future Studio** opens with the 2030 scenario. Participants can sketch or attach an image, describe their environment, request a concept or revision when AI is enabled, annotate it, and save boundaries for AI behavior.
- **Creative Diary** supports standalone entries and entries linked to an artefact. It accepts optional image attachments.
- **Questionnaires** displays configured instruments grouped by activity, session, and deployment timing. Progress counts submitted instrument versions and completed activities. Instruments are available through the questionnaire tab throughout the study.
- **Work independently** disables generation on the client and server. Sketching, workflow mapping and diary entries remain available.

## Configuration and backend behavior

| Setting | Use |
| --- | --- |
| `DATABASE_URL` | SQLite URL. Relative paths are resolved from `prisma/schema.prisma`. Use an absolute path on the persistent volume for deployment. |
| `AI_BACKEND` | `LIVE` is the default. `MOCK` returns labeled fictional fixtures without credentials. `WIZARD` queues a request for a researcher to complete in the dashboard. |
| `OPENAI_API_KEY` | Server-only key for the live backend. |
| `OPENAI_TEXT_MODEL` | An available Responses API model supporting strict structured JSON output. |
| `OPENAI_IMAGE_MODEL` | An available GPT Image model supporting WebP generation and image edits. |
| `STUDY_CONSENT_TEXT`, `STUDY_CONSENT_VERSION` | Approved text and version for the initial configuration. The dashboard can save versioned updates. Non-mock onboarding requires configured content. |
| `STUDY_PROFILE_FIELDS` | Optional comma-separated field names from `experience,genres,status,tools,aiExperience,roles`. Unset enables all. An empty value collects the primary role and pseudonym only. |
| `RESEARCHER_PASSWORD`, `SESSION_SECRET` | Researcher authentication and signing key. Use randomly generated deployment-specific values. |
| `MOCK_STUDY_CODE` | Optional demo code that auto-provisions only in `MOCK`. |
| `PARTICIPANT_BUDGET_CENTS`, `TEXT_GENERATION_COST_CENTS`, `IMAGE_GENERATION_COST_CENTS` | Application quota based on configured per-request cost estimates. The provider bills actual usage separately. |
| `PARTICIPANT_GENERATION_LIMIT`, `PARTICIPANT_UPLOAD_LIMIT`, `MAX_IMAGE_UPLOAD_BYTES` | Per-participant generation and upload caps, and per-image byte cap. The default image cap is 3 MiB. |
| `STUDY_CODE_ATTEMPTS_PER_MINUTE`, `SESSION_TTL_HOURS`, `COOKIE_SECURE` | Code-attempt throttling, participant session lifetime, and secure-cookie override for HTTPS termination. |

The three assistance modes use distinct, versioned system prompts in `src/server/mode-prompts.ts`. Failed live requests create explicit failure events and retain their real backend label. Mock output is a fixture for functional checks. The researcher-assisted queue displays its source in the participant workspace.

## Configure questionnaires

Go to **Researcher access → Study settings** and import an array of instrument configurations into the questionnaires JSON editor. The built-in NASA-TLX, Creativity Support Index, state sense of agency, psychological ownership and exploratory creative agency entries have empty item lists. Supply your approved wording and increment the version when modifying an instrument. CoStudio exports raw item values and leaves approved scoring to the analysis workflow.

The following example only illustrates the configuration format. Its wording is fictional.

```json
[
  {
    "id": "pilot-interface",
    "name": "Fictional pilot interface check",
    "version": "pilot-1",
    "timing": "activity",
    "items": [
      { "id": "ease", "type": "likert", "label": "How easy was the fictional task?", "min": 1, "max": 5 },
      { "id": "time", "type": "slider", "label": "Estimated test duration in minutes", "min": 0, "max": 20, "step": 1 },
      { "id": "location", "type": "choice", "label": "Which fictional location did you use?", "options": ["Desk", "Studio", "Other"] },
      { "id": "preference", "type": "pairwise", "label": "Which fictional layout would you choose?", "options": ["Layout A", "Layout B"] },
      { "id": "note", "type": "open", "label": "Add an optional fictional note", "required": false }
    ]
  }
]
```

Valid timings are `activity`, `session`, and `deployment`. Numeric responses are stored as numbers and option or text answers as strings.

## Review and export research data

Use **Researcher access** to issue participant codes, configure the study, inspect progress, and open an individual participant. The participant detail page supports scoped JSON, JSONL, CSV and ZIP exports. Use whole-study export when you need all participants.

- **JSON** contains participant properties, sessions, append-only events, decisions, archived prompts and generation settings, responses, version links, uploads, annotations, diary entries, workflows and Future Studio proposals.
- **JSONL** contains one interaction event per line with a UTC timestamp, unique event ID, participant session and compatible artefact references. Use the event sequence to order events with the same timestamp.
- **CSV** provides event summaries and one row per questionnaire item response. The combined file has a `recordType` column for filtering, and separate event and questionnaire files are available.
- **ZIP** includes structured exports, the data dictionary and artefact files. Workflow diagrams are available as SVG and high-resolution PNG. Validated raster uploads are preserved as WebP and can be exported as PNG.
- **Data dictionary** explains the exported tables and fields.
- **Pictorial** creates a paginated PNG sequence at 2120 × 2800 pixels per page. Select an episode and revision, check the pseudonym and edit or remove sensitive text and images, add a caption, and attest to the publication permission check before downloading.

Participant withdrawal deletes the participant and invalidates their study code after researcher confirmation. Copies held in backups or previously downloaded files are governed separately by the study’s approved data handling process.

## Deploy a study instance

1. Provision one Node.js 22+ instance with an HTTPS endpoint and a durable writable volume. Store the SQLite database on that volume and include it in your institutional backup process.
2. Supply production configuration through server environment variables. Set `AI_BACKEND=LIVE` or the approved research backend. For live use, set the API key and both model identifiers. Use a separate database from the fictional pilot.
3. Run `npm ci`, `npm run db:setup`, and `npm run build`. Run `npm run start` behind the HTTPS proxy using your service manager. Preserve the original host header, set `COOKIE_SECURE=true` when appropriate, and configure the proxy to permit the study’s upload size and generation timeout.
4. Load approved study information, consent, and questionnaire wording in the researcher dashboard. Set your study’s mode availability, prompt library and generation limits. Issue one high-entropy code per participant.

### Data sent to OpenAI in LIVE

CoStudio sends text using Responses with `store: false`. Payloads include the effective mode instructions, current creative role and stage, participant prompt, and relevant title and text excerpts when building on an earlier artefact. Visual requests send the constructed image prompt, generation options and the reference image when the participant provides or revises one. The request has no account, session or participant identifiers in structured fields, and the app removes matching participant IDs from prompt text. Free text or the visible contents of a reference image may still contain identifying details that participants enter themselves. Uploaded photos are re-encoded to remove file metadata before storage or use. Diary responses, questionnaire responses and profile demographics beyond the current musical role remain in CoStudio.

Provider-side retention depends on the organization and project configuration. Review the project's data controls before processing study material. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

## Verify and maintain

```sh
npm run typecheck
npm test
npm run build
```

The tests start a local server with an isolated temporary SQLite database, generated session IDs and fictional content. They exercise participant access, prompt provenance, different mock collaboration modes, idempotent mutations, artefact revisions, decisions and annotations, visual media, workflow exports, diary, questionnaire persistence, researcher access, participant-scoped exports, and withdrawal.

See the [implementation plan](IMPLEMENTATION.md) and [Prisma schema](prisma/schema.prisma) for the architecture and database relations.

## Prototype boundaries

The application targets a small, single-instance study. SQLite, in-memory authentication throttles and full-dataset export generation are sized for that deployment. Local browser and backend verification used fictional mock data. OpenAI request and error paths were checked with intercepted transport, and a credentialed live generation remains a deployment check. The project ships with placeholders for approved study consent and standardized questionnaire wording.
