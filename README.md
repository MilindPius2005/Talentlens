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

## Vercel frontend with Render backend

[vercel.json](vercel.json) deploys the React frontend as a single **Vite** project. Flask continues to run on Render at `https://talentlens-4zgu.onrender.com`.

The browser calls `/api/*` on the frontend's own domain. Vercel forwards these requests to Render, removing `/api`: `/api/auth/signup` reaches Render's `/auth/signup`. The API rewrite comes before the frontend's SPA fallback. This gives browser requests and session cookies one public origin.

The `build:vercel` and `dev:vercel` scripts use a Vite mode that embeds `/api` as the API base and `/` as the asset base. It overrides an old `VITE_API_BASE` value pointing directly at Render and disables Vite's standalone local Flask proxy for this deployment mode.

To deploy:

1. Commit and push `vercel.json`, `package.json`, `vite.config.ts`, its generated `vite.config.js`, `src/TalentLens.tsx`, `.gitignore`, `.vercelignore` and this README to the connected GitHub repository.
2. In Vercel, use **Root Directory `./`**, **Framework Preset Vite**, **Build Command `npm run build:vercel`** and **Output Directory `dist`**. The configuration file supplies these build settings.
3. Keep the six MongoDB and Neo4j environment variables on Render. The Vercel frontend does not need database credentials or a `VITE_API_BASE` variable.
4. Allow Vercel to deploy the new commit, then open `/api/healthz` on the frontend domain. It should return `OK`. `/api/auth/me` should return a JSON `401` response until logged in.
5. Test login/signup and confirm a reload preserves the session. Use `/api/health/db` to check the backend's database connections.

To test the same rewrite locally using Vercel CLI:

```bash
npx vercel dev --local
```

This serves the UI locally and forwards `/api` requests to the deployed Render backend. Plain `npm run dev` instead uses the original proxy to a locally running Flask server on port 8000.

If signup displays an account-service error with HTTP 404, inspect `/api/healthz`: a Vercel `NOT_FOUND` response means this rewrite configuration has not reached the deployment. Commit and deploy the configuration along with the frontend. Render's free service can take time to wake after inactivity; a successful static frontend deployment does not verify Flask or the database connections.

`.vercelignore` excludes Flask source, local secrets, virtual environments and generated assets from Vercel uploads. Render deploys the backend directly from GitHub. No Vercel services or runtime bindings are required for this setup.

Reference: [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## GitHub Pages frontend

The workflow in [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) builds and publishes the frontend on pushes to `main`, or when run manually from the Actions tab. The Pages build uses `/Talentlens/` as its asset base; regular builds and local development use `/`.

Follow these steps in order:

1. **Get the deployed backend URL.** Deploy Flask to an HTTPS host such as Render. If using Render, set the root directory to `backend`, build command to `pip install -r requirements.txt`, and start command to `gunicorn app:app --bind 0.0.0.0:$PORT`. Configure MongoDB and Neo4j credentials in that host's environment settings. Verify that `https://YOUR-BACKEND/healthz` responds with `OK`. GitHub Pages cannot run Flask or connect the browser directly to these databases.
2. **Set the frontend API URL.** Open [the repository's Actions settings](https://github.com/MilindPius2005/Talentlens/settings/variables/actions), select **New repository variable**, and enter the name **`VITE_API_BASE`** and your actual backend URL as the value, for example `https://your-backend.onrender.com`. Select **Add variable**. Use **Variables**, rather than **Secrets**, because the workflow reads `vars.VITE_API_BASE`. Use the API's actual base URL, without adding `/api` unless the deployed server serves its routes under that prefix. Localhost and the example URL are not deployed backend addresses.
3. **Enable GitHub Pages.** Open [Settings → Pages](https://github.com/MilindPius2005/Talentlens/settings/pages). Under **Build and deployment → Source**, select **GitHub Actions**. This step must be completed before the workflow's Configure GitHub Pages step can succeed. Pages is available for public repositories on GitHub Free; private repositories require a plan that includes Pages.
4. **Commit and push these changes.** In the repository directory, review `git status`, then run:

   ```bash
   cd /Users/sarang04/Documents/Talentlens/Talentlens
   git add .github/workflows/deploy-pages.yml package.json package-lock.json vite.config.ts vite.config.js vite.config.d.ts src/TalentLens.tsx src/useOntologyExplorer.js README.md
   git commit -m "Configure TalentLens frontend for GitHub Pages"
   git push origin main
   ```

5. **Watch the deployment.** Open **Actions → Deploy TalentLens frontend to GitHub Pages** and select the new run. Both **build** and **deploy** should finish successfully. To run again manually, select **Run workflow**, choose `main`, and run it. You can optionally enter a backend HTTPS URL for that manual run; it overrides the repository variable for that run only.
6. **Open the published site.** Use the URL shown in the successful deployment, normally `https://milindpius2005.github.io/Talentlens/`. Subsequent pushes to `main` rebuild and deploy the frontend automatically.

The expected site address is `https://milindpius2005.github.io/Talentlens/`. Updating `VITE_API_BASE` requires a new workflow run because Vite embeds this value at build time. The Pages build fails with a clear error when the backend URL is missing or is not HTTPS.

To build and preview the Pages output locally, put your deployed backend URL in the ignored file `.env.github-pages.local`:

```dotenv
VITE_API_BASE=https://your-backend.onrender.com
```

Then run `npm run build:pages` followed by `npm run preview:pages`, and open `http://localhost:4173/Talentlens/`.

`VITE_API_BASE` is public configuration. Database credentials stay in the backend host's environment settings. Pages serves the frontend only; it does not provide Flask routes or Vite's development proxy. The backend's current `SameSite=Lax` login cookies and unrestricted CORS origin reflection still need production configuration for a separate frontend domain. Browser policies may also restrict cookies between unrelated sites.

If deployment fails:

- **Backend URL missing:** Add the repository variable from step 2, or enter the URL in **Run workflow**. A variable in the backend host or a local `.env` does not supply the GitHub Actions build.
- **Get Pages site failed / Not Found:** Select **GitHub Actions** under **Settings → Pages** and confirm your account has access to Pages for this repository.
- **Permission denied / deployment rejected:** Check that repository or organization settings permit GitHub Actions and Pages deployments, and that the `github-pages` environment permits `main`.
- **Site loads but login/API requests fail:** Check the browser network request URL, backend connectivity, CORS and session-cookie configuration. A successful static deployment does not verify the separate backend.
- **Assets return 404:** Run the Pages workflow using `npm run build:pages`, retain the exact `/Talentlens/` path, and open the full project-site URL.

## Backend regression tests

```bash
python -m pip install -r backend/requirements-dev.txt
python -m unittest backend.test_employee_persistence -v
node --test src/deploymentStatuses.test.mjs
```

The suite uses in-memory MongoDB and a Neo4j test double without contacting live databases. It covers document storage, employee updates, re-ingestion, offline operations, retry ordering, and clearing. Live MongoDB validator enforcement and Neo4j execution require separate integration verification.
