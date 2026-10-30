# TalentLens UI

Bench management / talent redeployment dashboard. React + TypeScript + Vite, styled with a self-contained CSS-in-JS design system (Tailwind is wired in for any new components you add).

## Folder structure

```
talentlens-ui/
├── index.html            # Vite entry HTML
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── .env.example          # copy to .env.local to set your backend URL
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx           # React root
    ├── App.tsx            # thin wrapper that renders <TalentLens />
    ├── index.css          # Tailwind directives
    └── TalentLens.tsx     # the full app: pages, components, seed data
```

## Getting started

```bash
npm install
npm run dev
```

Opens at http://localhost:5173.

## Backend integration

The Flask backend in [backend/app.py](./backend/app.py) uses MongoDB for permanent employee records and Neo4j for graph nodes and relationships. The UI polls the API for employees and alerts. `VITE_API_BASE` defaults to `/api`; Vite proxies this to the backend during development.

Configure the backend environment (or a `.env` file) with `MONGO_URI`, `MONGO_DB_NAME` (default `talentlens`), `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` (default `neo4j`). Then run:

```bash
python -m pip install -r backend/requirements.txt
python -m backend.app
```

### Document and employee persistence

`POST /ingestion/upload` accepts CSV, Excel, or JSON employee data. Required columns are `Emp_Name`, `Client_Name`, `Skills`, and `misc skill`.

- Original documents are stored in MongoDB GridFS (`fs.files` and `fs.chunks`).
- Normalized employees are upserted into the `employees` collection using the schema defined in [backend/employee_store.py](./backend/employee_store.py). The collection has a MongoDB JSON Schema validator, unique employee name and ID indexes, and a sync status index. Existing validators are upgraded as needed to accept all imported deployment status values. Employee identity follows the existing application's unique-name convention; names must be unique across uploads.
- Each employee includes deployment status, client/project/performance, skills, location/domain/level, bench availability, soft-block fields, source upload ID, timestamps, schema version, and graph sync version/status. Re-ingestion updates imported fields while preserving soft-block state.
- `upload_history` links the document ID, source columns, employee names, uploader, row count, and graph sync status to a unique upload ID.
- MongoDB is saved before Neo4j. All graph writes for an upload or edit run in one Neo4j transaction, replacing old imported relationships. Neo4j remains the graph store; MongoDB provides current employee data and graph fallback while a sync is pending.

Select an employee in **Graph**, then choose **Edit employee** to update deployment status, client, project, or performance. Changes use `PUT /employees/:id`, persist in MongoDB, and sync to Neo4j. The API also accepts `skills`, `misc_skills`, `domain`, `location`, and `level` as string arrays, plus `available_since` as `YYYY-MM-DD`. Deployment status accepts any text value from the dataset, or null; values are trimmed and stored in uppercase for consistent filtering. Editor and filter options come from the dataset's status values.

`POST /employees/:id/softblock`, `/release`, and `/snooze` use the same persistence path. Soft-blocking sets both `status` and `deployment_status` to `SOFTBLOCKED`; release sets both to `AVAILABLE`. Re-ingestion preserves active soft-blocks. Older MongoDB soft-block records with a stale deployment status are repaired when read or retried, and marked for Neo4j sync. Employees from older Neo4j-only uploads are copied into MongoDB when first edited. Existing pending employee uploads are migrated on retry.

If Neo4j is unavailable, the response reports `neo4j_pending: true`; the employee remains saved in MongoDB. Use **Ingestion → Retry graph sync** or authenticated `POST /ingestion/sync-pending` to retry the latest employee state. The sync version prevents an older operation from marking a newer edit synced. Upload history shows pending syncs. No background retry worker is configured.

`POST /ingestion/clear` removes ingested employees, stored documents, upload history, and the graph; it retains MongoDB data if Neo4j cannot be cleared. This action requires login and clears the application's shared dataset.

Spreadsheet ingestion recognizes optional `Deployment Status`, `Current Project(s)` / `Project(s)`, and `Performance` columns. The deployment filter matches the saved deployment status directly, including imported values such as Training or On Leave and later changes such as Softblocked. Project, client, and performance values do not override this status. The client filter's **No Clients** option includes employees without an assigned client.

## Build
```bash
npm run build
```
Outputs static assets to `dist/`, deployable to any static host (or served by the backend).

## Backend regression tests

```bash
python -m pip install -r backend/requirements-dev.txt
python -m unittest backend.test_employee_persistence -v
node --test src/deploymentStatuses.test.mjs
```

The suite uses in-memory MongoDB and a Neo4j test double without contacting live databases. It covers document storage, employee updates, re-ingestion, offline operations, retry ordering, and clearing. Live MongoDB validator enforcement and Neo4j execution require separate integration verification.
