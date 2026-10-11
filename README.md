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

`TalentLens.tsx` currently runs on local seed data (`INITIAL_EMPLOYEES`, `INITIAL_JOBS`, `INITIAL_ALERTS`, `EMPLOYEES`) held in React state, so it's fully demoable with no backend.

It already has a backend integration point built in — the `GraphExplorer` view and the root `TalentLens` component poll a REST API for live employee/alert data and POST status changes (soft-block, release, snooze):

- Base URL: `API_BASE`, read from `VITE_API_BASE` (see `.env.example`). Defaults to `http://127.0.0.1:8000`.
- Expected endpoints:
  - `GET  /employees` — list of employees with `id`, `status`, `location`, `available_since`, `softblock_job`, `softblock_manager`, `softblock_start`, `softblock_expiry`
  - `GET  /alerts` — list of alert objects (bench-age / soft-block-expiry / release notices)
  - `POST /employees/:id/softblock` — mark an employee soft-blocked
  - `POST /employees/:id/release` — release an employee back to available
  - `POST /employees/:id/snooze` — extend a soft-block expiry

To wire up a real backend:
1. Replace `INITIAL_EMPLOYEES` / `INITIAL_JOBS` / `INITIAL_ALERTS` with data fetched from your API (e.g. in a `useEffect` in `TalentLens()`), or swap the `useState` calls for a data-fetching hook / query library.
2. Point `VITE_API_BASE` (via `.env.local`) at your deployed backend.
3. The existing `fetch` calls to `${API_BASE}/employees`, `/alerts`, `/employees/:id/release`, `/employees/:id/snooze`, `/employees/:id/softblock` already match this shape — implement matching routes on the backend.

## Build
```bash
npm run build
```
Outputs static assets to `dist/`, deployable to any static host (or served by the backend).1