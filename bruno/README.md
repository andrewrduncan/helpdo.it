# helpdo.it API — Bruno collection

Versioned API examples for the helpdo.it service. Lives next to the code so the
schema-evolution + request-example loop stays tight.

## Open it

In Bruno: **Collection → Open Collection** → point at this folder
(`helpdo.it/bruno/`).

You can have multiple Bruno collections open at once from anywhere on disk;
opening one doesn't replace your others.

## Environments

- **Local** — `baseUrl = http://localhost:8080`

Select it via the environment dropdown in the Bruno sidebar before running
anything. Switch to a new environment by adding `environments/<Name>.bru`.

## Layout

```
bruno/
├── bruno.json
├── environments/
│   └── Local.bru
├── REST/                    ← extension-facing REST API (questions, capture, answers)
├── GraphQL/                 ← admin training web interface API
└── Actuator/                ← health, info, metrics, flyway
```

Add new requests as resolvers/controllers land. Sequence (`seq:`) controls
render order within a folder; folders sort alphabetically by default.
