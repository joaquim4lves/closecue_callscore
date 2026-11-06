# CloseCue / CallScore — fatia 1 and 2

Playbook MVP plus call ingest for one workspace. One **active** playbook per organization. Drafts never become score input.

Auth is **mock only**. Clerk is not installed and is not required to boot.

Fatia 2 ingests calls through a full Zoom webhook. Meet and Fireflies are typed stubs. Upload and paste are the dev fallback. Fatia 3 scores ready calls. Fase 1b is the seller overlay beside the call. There is no meeting bot and no live speech-to-text vendor.

## Deploy target

One process and one database:

1. `npm run db:migrate`
2. `npm run build`
3. `npm run start`

`GET /api/health` checks the app and Postgres. There is no worker and no second service.

## Run locally

Requirements: Node.js 22+ and Postgres 16.

```bash
cp .env.example .env
npm install
npm run db:create
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and pick a seeded user in the header. The dev server reads `.env`.

Rollback the latest migration:

```bash
npm run db:migrate:down
```

Roll back every migration:

```bash
npx tsx scripts/migrate.ts down --all
```

Apply again with `npm run db:migrate`.

## Mock auth

There is no login screen and no Clerk key.

| Who | Email | User id |
| --- | --- | --- |
| Manager (Marina Gestor) | `manager@demo.closecue.local` | `22222222-2222-4222-8222-222222222222` |
| Seller (Lucas Vendedor) | `seller@demo.closecue.local` | `33333333-3333-4333-8333-333333333333` |

Organization `Demo Workspace`: `11111111-1111-4111-8111-111111111111`.

Send either header:

```http
x-mock-user-id: 22222222-2222-4222-8222-222222222222
```

or cookie:

```http
Cookie: mock_user_id=33333333-3333-4333-8333-333333333333
```

The header wins when both are present. Middleware rejects protected `/api/*` calls with `401` when neither is set. Unknown users are `401`. Users without a membership are `403`.

The UI sets an HttpOnly `mock_user_id` cookie through `POST /api/dev/session`. `GET /api/dev/users` lists local users so the switcher can render. Both routes are off when `MOCK_AUTH=false`.

Roles:

- **manager** — create and edit drafts, reorder phases and objections, save a draft, publish, delete a draft or archived playbook.
- **seller** — read only the active playbook of their own organization.

Another organization's rows are `404`. A seller asking for a draft in their own org is also `404`.

## Seed

`npm run db:seed` is idempotent. It ensures:

- 1 organization, 1 manager, 1 seller
- playbook **Outbound B2B** (`44444444-4444-4444-8444-444444444444`)
- 5 phases: Abertura, Descoberta, Proposta, Objeções, Fechar
- 4 objections: Preço, Confiança, Já temos fornecedor, Timing

The demo playbook is **active** unless that id already exists (status is left as-is) or another active playbook already exists (the demo row is inserted as a draft). Re-running the seed does not duplicate rows.

## Playbook rules

- Status is `draft`, `active`, or `archived`.
- At most one `active` playbook per organization (partial unique index).
- `POST /api/playbooks/:id/save-draft` updates a draft and leaves it a draft.
- `POST /api/playbooks/:id/publish` activates a draft that has at least one phase.
- If another playbook is already active, publish returns `409` with copy key `playbook.replace_active` until the body is `{ "replaceActive": true }`. The previous active playbook becomes `archived`.
- Active content is not edited in place. Duplicate it (`POST /api/playbooks/:id/duplicate`) and publish the new draft.
- Score input for a later fatia is `getPlaybookForScoring(orgId)`, which returns only `status=active`.

Copy keys:

| Key | Text |
| --- | --- |
| `playbook.publish` | Publicar |
| `playbook.save_draft` | Salvar rascunho |
| `playbook.replace_active` | Publicar e substituir o playbook ativo? |
| `playbook.none_active` | Publique um playbook para pontuar calls |

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/health` | public |
| GET | `/api/me` | any member |
| GET | `/api/playbooks` | manager: all; seller: active only |
| POST | `/api/playbooks` | manager |
| GET | `/api/playbooks/:id` | manager, or seller if active |
| PATCH | `/api/playbooks/:id` | manager, draft only |
| DELETE | `/api/playbooks/:id` | manager, not the active one |
| POST | `/api/playbooks/:id/save-draft` | manager, draft only |
| POST | `/api/playbooks/:id/publish` | manager, draft only |
| POST | `/api/playbooks/:id/duplicate` | manager |
| POST | `/api/playbooks/:id/phases` | manager, draft |
| PATCH/DELETE | `/api/playbooks/:id/phases/:phaseId` | manager, draft |
| POST | `/api/playbooks/:id/phases/reorder` | manager, draft — `{ "orderedIds": ["..."] }` |
| POST | `/api/playbooks/:id/objections` | manager, draft |
| PATCH/DELETE | `/api/playbooks/:id/objections/:objectionId` | manager, draft |
| POST | `/api/playbooks/:id/objections/reorder` | manager, draft |

Example:

```bash
MANAGER=22222222-2222-4222-8222-222222222222
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/playbooks -H "x-mock-user-id: $MANAGER"
curl -s -X POST http://127.0.0.1:3000/api/playbooks/$PLAYBOOK_ID/publish \
  -H "content-type: application/json" \
  -H "x-mock-user-id: $MANAGER" \
  -d '{"replaceActive":true}'
```

Logs are JSON lines on stdout and include `requestId` (request header `x-request-id`, or a generated id echoed on the response). Ingest logs also include `callId` and `externalId`.

## Calls (fatia 2)

Zoom is the only production provider. Point the Zoom Event Subscription at:

```text
POST https://<host>/api/webhooks/zoom
```

Placeholder env vars (no real secrets in the repo):

```bash
ZOOM_WEBHOOK_SECRET_TOKEN=replace-with-zoom-secret-token
ZOOM_ORG_ID=11111111-1111-4111-8111-111111111111
ZOOM_DEFAULT_SELLER_ID=33333333-3333-4333-8333-333333333333
STT_PROVIDER=mock
AUDIO_CONSENT_GATE=off
```

`ZOOM_ORG_ID` is the workspace that receives Zoom events. The meeting `host_email` is matched to a user in that org; otherwise `ZOOM_DEFAULT_SELLER_ID` is used, then the first seller. Signature is Zoom's `v0:{timestamp}:{rawBody}` HMAC (`x-zm-signature` / `x-zm-request-timestamp`). Invalid signatures return `401`. Valid events are stored in `webhook_inbox` and answered with `202` before ingest finishes in-process. `endpoint.url_validation` returns `plainToken` and `encryptedToken`.

An inline transcript becomes `ready` with segments and does not call STT. An audio URL without transcript goes through `STT_PROVIDER` (`mock` or `fail`) and ends `ready` or `failed`. The same `external_id` does not create a second call.

`POST /api/webhooks/meet` and `POST /api/webhooks/fireflies` return `501`. The `MeetingProvider` stubs throw `ProviderNotImplemented` and have no production logic.

Fallback, with the mock user header:

- `POST /api/calls` JSON `{ "title", "transcript" }` → source `paste`
- `POST /api/calls` multipart `title` + `audio` file, optional `transcript` → source `upload`
- `GET /api/calls?source=zoom&period=week&sellerId=`
- `GET /api/calls/:id`
- `POST /api/calls/:id/reprocess` (manager)

`bad` is accepted on the list query and ignored. There is no score schema.

In production (`NODE_ENV=production`) or when `AUDIO_CONSENT_GATE=enforce`, audio bytes and audio URLs are rejected unless `consentRecordedAt` is sent. Transcript text is still stored. Demo paste does not need a recording.

Retention defaults are `audio_days=30` and `transcript_days=90` on `retention_policies`. The seed creates that row for the demo org.

The Calls screen lists origin badges, a source filter, this-week empty copy (`calls.empty_week`), and the upload fallback. A failed ingest shows `calls.ingest_failed`.

## CallScore (fatia 3)

When a call becomes `ready` and the org has an active playbook, a thin score is stored: overall 0–100, phase scores, objection scores, up to three short reasons, and `bad_flag`. There is no coaching chat.

`SCORE_PROVIDER=mock` (default) is a deterministic rules check against checklist items and objection signals. `SCORE_PROVIDER=fail` records `scores.status=failed`. A missing active playbook does not invent a score; the list and detail show `playbook.none_active`.

A call is bad when overall is below the org threshold, or a detected objection is unanswered. The threshold lives on `retention_policies.bad_score_below` (default 60). `SCORE_BAD_BELOW` is the fallback when the org has no row yet.

- `GET /api/calls?bad=true&reviewed=false&period=week&source=&sellerId=`
- `GET /api/calls/:id` includes the score and the evidence segments
- `POST /api/calls/:id/review` marks it reviewed (manager)
- `POST /api/calls/:id/rescore` retries a failed score or refreshes after the active playbook version changes (manager)
- `GET /api/metrics/scoring?period=week` returns `% scored` (ready calls with `score.status=ok` / ready calls) and `% ruins revisadas` (reviewed bad scores / bad scores)

The Calls screen has Esta semana / Ruins, the metric summary, score and origin on each row, and the detail gaps. `calls.score_failed` is the retry state.

## Overlay (fase 1b)

The seller panel at `/overlay` is a web panel beside the call. It does not join the meeting. Cues come from `matchAdherence`, the same phase and objection matcher CallScore uses, pinned to the active playbook version at session start.

```bash
# as the seeded seller
curl -s -X POST http://127.0.0.1:3000/api/cue-sessions \
  -H "content-type: application/json" \
  -H "x-mock-user-id: 33333333-3333-4333-8333-333333333333" \
  -d '{}'
curl -s -X POST http://127.0.0.1:3000/api/cue-sessions/$SESSION/ticks \
  -H "content-type: application/json" \
  -H "x-mock-user-id: 33333333-3333-4333-8333-333333333333" \
  -d '{"simulate":"objection"}'
```

- `POST /api/cue-sessions` starts a live session when a playbook is active, or an idle session with `noneActive` when it is not
- `POST /api/cue-sessions/:id/ticks` accepts `{ "text" }` or `{ "simulate": "phase" | "objection" }`
- `GET /api/cue-sessions/:id/events` polls; `GET /api/cue-sessions/:id/stream` is SSE
- `POST /api/cue-events/:id/ack` and `/dismiss` persist acknowledgement
- `POST /api/cue-sessions/:id/end` closes the session

Without a session the panel shows `status.no_audio`. If the SSE connection drops, the panel shows offline and `action.retry_audio` reconnects. There is no live speech-to-text vendor: paste a line or use the simulate buttons.

## Tests

```bash
npm test
npm run lint
```

Tests use `postgres://closecue:closecue@127.0.0.1:5432/closecue_test` and prove migrate down/up against `closecue_migrate`. Create the role if needed:

```bash
sudo -u postgres psql -c "CREATE USER closecue WITH PASSWORD 'closecue' SUPERUSER;"
```

CI runs typecheck, the test suite, and migrate up → down → up on Postgres 16.
