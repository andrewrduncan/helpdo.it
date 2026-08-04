# helpdo.it — Developer guide

How to set up and run the stack locally: the **Postgres** datastore, the **API**
(Spring Boot), the **admin portal** (`web/`), and the **Chrome extension**.

Most tasks are wrapped in the root `Makefile` — run `make help` for the full list.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **JDK** | **21** | Spring Boot 4 / Spring AI 2.0 require it. macOS may default to 17 — the `Makefile` pins `JAVA_HOME` via `/usr/libexec/java_home -v 21`. Running Gradle by hand: `export JAVA_HOME="$(/usr/libexec/java_home -v 21)"`. |
| **Node.js** | 18+ | For the extension (`extension/`) and portal (`web/`). |
| **Docker** | recent | For Postgres + pgvector (`docker compose` or `docker-compose`). |
| **An OpenRouter key** | — | https://openrouter.ai/keys — chat + embeddings. |
| **A Google OAuth client** | — | For sign-in (see [Auth](#auth--sign-in)). Optional if you only test the AI endpoints. |

## Ports

| Service | Port | What |
|---------|------|------|
| Postgres | `5432` | pgvector datastore |
| API (REST + GraphQL) | `8080` | `/api/**`, `/graphql` |
| RSocket channel | `8081` | the extension's live channel (RSocket-over-WebSocket) |
| Admin portal (Vite dev) | `3000` | proxies `/graphql` + `/api` → `8080` |

---

## Environment files (gitignored)

Two `.env` files, each with an `.env.example` to copy:

**`devops/.env`** — Postgres credentials. `make db-up` copies it for you; defaults are fine locally.

**`api/.env`** — secrets for the API:

```bash
cp api/.env.example api/.env
```

Then set at least:

```ini
OPENROUTER_API_KEY=sk-or-...

# For sign-in (Google). Without these, login is disabled but the AI endpoints work.
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Optional model overrides (defaults in application.yml)
# HELPDOIT_CHAT_MODEL=openai/gpt-4o-mini
# HELPDOIT_EMBEDDING_MODEL=openai/text-embedding-3-small
```

In CI/prod, set these as real environment variables instead of a file.

---

## Quick start

```bash
make db-up      # start Postgres + pgvector (background)
make dev-api    # run the API on :8080 (hot reload via Spring DevTools)
make dev-web    # run the admin portal on :3000
# + load the extension — see "Working with the extension" below
```

Smoke-test the AI wiring once the API is up:

```bash
make ai-ping    # embedding path → a 1536-dim vector
make ai-ask     # chat path → a one-sentence reply
```

Component-by-component (what the Make targets run):

| Area | Dev | Build |
|------|-----|-------|
| DB | `make db-up` | — |
| API | `make dev-api` (`./gradlew bootRun`) | `make build-api` |
| Portal | `make dev-web` (`npm run dev`) | `make build-web` |
| Extension | `make dev-ext` (`npm run dev`) | `make build-ext` |

---

## Working with the extension

There are **two ways** to run the extension, with different trade-offs. Pick based
on whether you're iterating on extension code or testing against an app you're
already logged into.

### Option A — HMR dev build, fresh Chrome window

```bash
make dev-ext          # = cd extension && npm run dev   (Chrome)
make dev-ext-firefox  # Firefox
```

WXT launches a **brand-new browser window with a temporary, dedicated profile** and
the extension already loaded, with **hot-module reload** — save a file and it
updates automatically.

- **Best for:** actively iterating on extension code.
- **Trade-off:** it's a clean profile — you are **not** signed into your apps there
  (e.g. the target app you want the widget on), no bookmarks/sessions. You'd sign
  into the target app and helpdo.it inside that throwaway window.

### Option B — Load unpacked into your everyday Chrome

```bash
make build-ext        # builds extension/dist/chrome-mv3
make load-ext         # builds, then prints the exact folder path to load
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select `extension/dist/chrome-mv3`

- **Best for:** testing in **your real profile** — already logged into the target
  app (e.g. google.com), with your bookmarks and sessions.
- **Trade-off:** no HMR. After changing extension code: `make build-ext`, then click
  the extension's **↻ reload** icon in `chrome://extensions`, and refresh the page.

> **Don't mix the two.** `npm run dev` runs its own browser/output; `npm run build`
> writes the static `dist/chrome-mv3` you load unpacked. A `build` won't update a
> running `dev` instance, and vice-versa — so if a change "won't take", check which
> mode you're in (and that you reloaded the **extension**, not just the page).

### After loading (either option)

1. Open the extension's **options** (`chrome://extensions` → helpdo.it → Details →
   Extension options).
2. Set **Instance URL** to `http://localhost:8080` and Save.
3. The widget now mounts on enabled sites (the instance's `/api/config` decides
   `enabledSites`, sign-in providers, the RSocket `wsUrl`, and `attachmentsEnabled`).
4. Sign in from the widget; ask a question, or switch to **Train** (trainer/admin).

**Debug logging:** the options page has a **Debug logging** toggle (off by default).
Turn it on to print verbose `[helpdoit]` diagnostics (e.g. guided-playback steps) to
the page console; off for normal use.

Firefox builds: `make build-ext-firefox`. Distributable zip: `make zip-ext`.

---

## Auth & sign-in

Sign-in is provider-agnostic OIDC handled by the API; the app mints its **own JWT**
and trusts only that. Out of the box a **Google** registration is wired.

1. Create a Google OAuth 2.0 **Web** client (Google Cloud Console → Credentials).
2. Authorized redirect URI: `http://localhost:8080/login/oauth2/code/google`.
3. Put the id/secret in `api/.env` (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).

Roles:

- **The first user to sign in becomes an `admin`** automatically.
- Roles are **admin** and **trainer** (a plain user has neither = FAQ only).
- Admins assign roles in the portal (**Users & Roles**). To grant **trainer** by
  hand:

  ```sql
  INSERT INTO user_role (user_id, role_id)
  SELECT u.id, r.id FROM app_user u, app_role r
  WHERE u.email = 'you@example.com' AND r.role_key = 'trainer';
  ```

  Roles are baked into the JWT at login — **re-login** after a change.

---

## Database

```bash
make db-psql     # psql shell in the container
make db-logs     # tail Postgres logs
make db-reset    # WIPE (down -v) and recreate — re-runs Flyway on next API boot
```

The **relational schema** is owned by Flyway (`api/.../db/migration/V*.sql`, applied
on API boot). The **`vector_store`** table is owned by Spring AI
(`initialize-schema: true` — it `CREATE EXTENSION vector` + builds the table/index on
first boot). Both live in the one `helpdoit` database.

> Leave the dev Postgres running between API restarts — the API hot-reloads against it.

---

## API client (Bruno)

`bruno/` holds a [Bruno](https://www.usebruno.com/) collection of the REST + GraphQL
calls (ask, config, agent, etc.) for poking the API directly.

---

## Common gotchas

- **JDK 17 vs 21** — Gradle fails on 17. Use the Makefile or export `JAVA_HOME` to 21.
- **OpenRouter base-url must include `/v1`** (`https://openrouter.ai/api/v1`) — it
  drives both chat and embeddings.
- **Boot 4 = Jackson 3** — there's no classic `com.fasterxml.jackson.databind.ObjectMapper`
  bean, and returning a Jackson-2 `JsonNode` from a controller mis-serializes. Use a
  local mapper / return Strings or plain POJOs.
- **Extension changes "won't take"** — wrong run mode (see the note above) or you
  reloaded the page but not the extension.
- **Big payloads over RSocket** — the WS frames cap ~64 KB; screenshots/attachments
  go over HTTP instead.
