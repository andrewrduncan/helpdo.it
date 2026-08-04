# helpdo.it

> AI-driven, in-context help system. Train it on your application's domain knowledge, then let users ask "how do I do this?" right where they're working — and get shown the answer.

## Overview

**helpdo.it** is an AI help platform that lives inside the applications your users already use. Instead of digging through a separate help center, a user opens the helpdo.it Chrome extension, asks a question in plain language, and the system uses Retrieval-Augmented Generation (RAG) over your trained domain knowledge to tell — and *show* — them how to complete the task.

Conceptually similar to how **Datadog RUM** captures real user sessions, the extension can observe and capture the on-screen context (the page the user is on, the elements they're interacting with), so guidance is grounded in what the user is actually looking at.

When the system doesn't have a confident answer, the question is **queued for an admin**. The admin can view the captured screen context, author the correct answer, and store it — vectorized — back into the knowledge base. The next user who asks a similar question gets an instant, self-served answer. The platform effectively builds its own FAQ over time, without re-training on topics it has already learned.

## Core Components

### 1. Chrome Extension *(primary focus)*
The user-facing surface. It:
- Lets users ask questions in-context, inside any web application it's configured for.
- Captures on-screen context (DOM/page state, screenshots) — Datadog RUM-style — to ground answers and to give admins the context they need to build new answers.
- Surfaces retrieved guidance inline: tells and shows the user how to complete a task.
- Collects **user feedback** when an answer is wrong or unhelpful, queuing it for admin review.

### 2. API Server (Java / Spring Boot + AI framework)
The brain. It:
- Exposes APIs for the extension and the training web interface.
- Runs the RAG pipeline: embeds the incoming question, retrieves relevant knowledge from the vector store, and generates a response.
- Decides **answer vs. escalate**: returns guidance when confident, otherwise queues the question for an admin.
- Persists new admin-authored answers (vectorized) for future self-service FAQ.
- Manages feedback and review queues.

### 3. Training Web Interface
The admin surface. It:
- Lets admins train the system on domain knowledge.
- Presents the **question queue** (unanswered / low-confidence questions) with their captured screen context, so admins can author answers.
- Presents the **feedback queue** (answers users flagged as wrong/unhelpful) for review and correction.
- Pushes authored/updated answers into the vector store.

### 4. Docker Compose Stack
A small local/deployable stack that houses the supporting services — including the **vector store / RAG datastore** that holds the training knowledge and learned answers.

## How It Works

```
                ┌─────────────────────┐
   asks a Q →   │   Chrome Extension  │   ← shows answer / collects feedback
                └──────────┬──────────┘
                           │ question + captured screen context
                           ▼
                ┌─────────────────────┐
                │     API Server      │
                │  (Spring + AI/RAG)  │
                └──────────┬──────────┘
                           │
              ┌────────────┴─────────────┐
              ▼                          ▼
   confident match?                 no good match
   retrieve from vector store       OR negative feedback
   → tell + show user                       │
                                            ▼
                              ┌──────────────────────────┐
                              │   Admin Review Queue      │
                              │  (Training Web Interface) │
                              │  view screen → author     │
                              │  answer → vectorize/store │
                              └──────────────────────────┘
                                            │
                                            ▼
                              future users self-serve (FAQ)
```

1. A user asks a question in the extension; the page/screen context is captured alongside it.
2. The API embeds the question and searches the vector store for relevant knowledge.
3. **If a confident match is found**, the API returns guidance and the extension tells/shows the user how to complete the task.
4. **If not**, the question (with its screen context) is queued for an admin.
5. The admin views the context, authors the correct answer, and saves it — vectorized — to the knowledge base.
6. Future users asking similar questions are answered automatically, building a self-maintaining FAQ.
7. Users can flag any answer as wrong/unhelpful; that feedback is queued for admins to review and correct.

## Tech Stack

| Layer | Technology |
|-------|------------|
| API server | Java 21, Spring Boot 4, Spring AI 2.0 (RAG), GraphQL + REST, RSocket |
| AI provider | OpenRouter (OpenAI-compatible API) — chat + embeddings + vision |
| Knowledge store | Postgres + pgvector |
| Training UI | Vite + React + Pico (admin portal in `web/`) |
| Client | Chrome/Firefox extension — WXT + React |
| Auth | Provider-agnostic OIDC → app JWT (Google wired) |
| Local infra | Docker Compose |

### AI integration — swappable by design

All AI interaction goes through framework-agnostic **ports** in `com.helpdoit.ai`
(`ChatModelPort`, `EmbeddingPort`, `VectorStorePort`) with their own DTOs — **no
Spring AI types leak into domain code**. Spring AI is wired in as a set of
**adapters** in `com.helpdoit.ai.spring`, the only classes that import it.

This means two levels of swap:
- **Change provider** (OpenRouter → direct Anthropic, OpenAI, Ollama, ...): edit
  the `spring.ai.*` config or swap the Spring AI starter — adapters and domain
  code are untouched.
- **Change framework** (Spring AI → LangChain4j, a raw SDK, ...): write a new
  adapter package implementing the same ports and flip the bean wiring — domain
  code is untouched.

Configure via a gitignored `api/.env` (see `api/.env.example`): set
`OPENROUTER_API_KEY` and, optionally, `HELPDOIT_CHAT_MODEL` /
`HELPDOIT_EMBEDDING_MODEL`. Verify the wiring with `GET /api/ai/ping` (embedding)
and `POST /api/ai/ask` (chat).

## Getting started

See **[docs/DEVELOPER.md](docs/DEVELOPER.md)** for full setup, the run commands, and the two
ways to work with the extension. The short version (everything is wrapped in the
root `Makefile` — `make help` lists it all):

```bash
cp api/.env.example api/.env     # add OPENROUTER_API_KEY (+ Google OAuth for sign-in)
make db-up                       # Postgres + pgvector
make dev-api                     # API on :8080
make dev-web                     # admin portal on :3000
make load-ext                    # build the extension + print the folder to load unpacked
```

## Project Status

The end-to-end loop is working: ask → retrieve → answer-or-queue, train (manual or
by recording a walkthrough), and guided playback in the extension.

**Done:**
- Spring Boot 4 / Java 21 API (GraphQL + REST + an RSocket channel on `:8081`).
- Swappable Spring AI integration (OpenRouter chat + embeddings + **vision**, pgvector store).
- **AI-assisted retrieval** — wide-net vector search + an LLM relevance grader,
  multiple results offered as clickable options, query-reformulation escalation on a
  miss, and index-time query expansion (title + answer + AI variants + tags as keywords).
- **Auth & roles** — OIDC → app JWT, admin/trainer, first user → admin, live-DB checks.
- **Admin portal** (`web/`) — question queue (with captured page snapshots + attachments),
  knowledge table (delete + **edit**: opens the entry on its page to adjust the answer/tags
  and steps — relabel/reorder/delete, or **re-record from a chosen step** — then re-indexes),
  Users & Roles.
- **Chrome/Firefox extension** (WXT + React) — in-context ask, multi-result bubbles,
  **file attachments** (multimodal, central on/off toggle), and **Train mode**:
  record a click-walkthrough → AI summarizes into a reviewable draft → save → indexed.
- **Guided playback** — a simulated cursor animates through a recorded walkthrough,
  performing the steps; matches the start page by **pattern** (ids wildcarded) so it plays
  on the user's own record rather than the one that happened to be recorded.
- Reusable **agent/chat building blocks** (see below).

**Next:** the feedback queue, hardening (JWT on the RSocket channel, refresh tokens),
and moving stored screenshots to object storage.

### Building blocks

Reusable, normalized capabilities (distilled from the adjacent promptlydo.it),
each behind its own package on top of the AI ports:

- **Conversation** (`conversation`) — persistent multi-turn chat (sessions + messages).
- **Agents-as-data** (`agent`) — `AgentDefinition` rows (persona, model, toolkits) resolved by slug.
- **Toolkits** (`tool`) — named tool groups (Spring AI `@Tool`), resolved per agent, with `{"ok":..}` safe-call wrapping.
- **Agent runtime** (`agent.spring`) — one turn = agent + history + toolkits → reply; REST at `/api/agent/...`.
- **Task queue** (`task`) — broker-free async (DB lease + `FOR UPDATE SKIP LOCKED`) with an `AgentTask` handler interface.
- **Attachments** (`attachment`) — convert files for the model: images inline (vision), documents → text via Apache Tika, graceful fallback; feeds both user attachments and walkthrough screenshots.

## Repository Layout

```
helpdo.it/
├── api/              # Java Spring Boot API server + AI/RAG pipeline (Spring AI)
├── extension/        # Cross-browser extension — WXT + React (primary client)
├── web/              # Admin training portal — Vite + React + Pico (talks to /graphql)
├── devops/           # Docker Compose stack (Postgres + pgvector)
├── bruno/            # Bruno API client collection (REST + GraphQL)
└── docs/             # Project docs (see below)
```

## Documentation

Project docs live in [`docs/`](docs/):

- **[docs/DEVELOPER.md](docs/DEVELOPER.md)** — setup, running the stack, and the two
  ways to work with the extension.

(New non-README docs go in `docs/` and get linked here.)
