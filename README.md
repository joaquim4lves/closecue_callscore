# CloseCue / CallScore — fatia 1

Playbook MVP for one workspace: organizations, users, roles, and a versioned playbook (phases + objections). One **active** playbook per organization. Drafts never become score input.

Auth is **mock only**. Clerk is not installed and is not required to boot.

Out of scope: calls, transcripts, Zoom/Meet/Fireflies webhooks, CallScore, and the CloseCue overlay.

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

Logs are JSON lines on stdout and include `requestId` (request header `x-request-id`, or a generated id echoed on the response).

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
