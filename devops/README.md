# helpdo.it DevOps

Local Postgres for the helpdo.it platform — backs the API's relational data
(knowledge corpus, question queue, feedback queue) and, later, the RAG vector
store.

## Bring it up

```bash
cd devops
cp .env.example .env        # tweak credentials if you like
docker compose up -d
docker compose logs -f postgres
```

The schema is owned by Flyway in the `api/` project — `V1__initial_schema.sql`
applies on the API's first boot, not via a Postgres init mount.

## Connect

```bash
docker compose exec postgres psql -U helpdoit -d helpdoit
# or from host:
psql postgresql://helpdoit:helpdoit_dev@localhost:5432/helpdoit
```

## Reset

The schema is applied by Flyway on app boot. To start over:

```bash
docker compose down -v
docker compose up -d
# then start the api/, which re-runs the migrations
```

## RAG vector store

The image is `pgvector/pgvector:pg16` (a drop-in superset of `postgres:16`). Spring
AI owns the `vector_store` table — on first API boot it `CREATE EXTENSION vector` and
builds the table + HNSW index. Relational data (Flyway) and the vector store share
this one Postgres. See the root README for the architecture.

## Layout

```
devops/
├── docker-compose.yml
├── .env.example
└── .gitignore
```
