# pickup_scheduler

Web application for scheduling used tire pickup appointments. Minimal stack — Node.js built-ins only (no external packages). App serves a static front-end and a small JSON API that persists to local JSON files.

## Quick Start

- Requirements: Node.js 16+.
- Optional: set `ADMIN_PASSWORD` for the admin dashboard.

Commands:

```
npm start
```

Then open:
- Customer: http://localhost:3000/
- Admin: http://localhost:3000/admin

## Configuration

- File: `data/config.json`
  - `businessName`, `businessPhone`
  - `capacityPerDay` — max appointments per date
  - `timeWindows` — selectable time windows
  - `blackoutDates` — array of `YYYY-MM-DD` dates unavailable for scheduling

Environment variables:
- `PORT` — server port (default 3000)
- `ADMIN_PASSWORD` — admin login password (default `changeme` — change this!)

## API (summary)

- `GET /api/config` — public config for the client
- `POST /api/appointments` — create appointment
  - body: `{ name, email?, phone?, address, city?, state?, zip, date: 'YYYY-MM-DD', timeWindow, tiresCount?, notes? }`
- `POST /api/admin/login` — admin login, returns `{ token }`
- `GET /api/appointments[?date=YYYY-MM-DD]` — list appointments (admin)
- `PATCH /api/appointments/:id` — update `{ status, notes? }` (admin)

Data files:
- `data/appointments.json` — stored appointments
- `data/config.json` — business settings

## Notes

- This is a simple demo suitable for a small operation. Consider migrating to a database, adding per-slot capacity, email/SMS notifications, and robust auth for production use.


## Video link

- https://www.youtube.com/watch?v=PXOsddcWL4g
- last ended @ 1:06:57