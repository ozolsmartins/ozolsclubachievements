Ozols Club Achievements
=======================

An achievements, leaderboards, and activity explorer for the ozols.club platform. This app analyzes raw lock entry logs to surface meaningful insights such as most active users, early birds, night visitors, and longest streaks, with both month‑level and lifetime views.

What this project is
- A focused “Achievements” UI for ozols.club built with Next.js (App Router)
- Client + API in a single repository (no separate backend service)
- Uses MongoDB (via Mongoose) for data storage and aggregation

Core features
- Filters: by date/month, lock, user, and per‑page size
- Range switch: Day or Month (month view disables picking a specific day)
- Entries table: shows activity for the selected range; in Month view shows full date & time
- Achievements (selected range, all pages): totals, unique users, most active user, time span; day‑only metrics include busiest hour and most used lock
- User search “profile”: lifetime stats and gamified achievements for a single user
- Monthly Leaderboard (Month view only): top users (distinct active days), top early visitors, top night visitors, and longest streaks
- Global Leaderboard (lifetime): toggle on/off; same categories as monthly but for all‑time
- Deterministic pagination and stable ordering
- Timezone‑aware computations for hour/day logic
- Seasons & progression: pick a predefined Season to see seasonal standings; per‑user season progress includes points (distinct active days), rank, streaks, and level
 - Analytics & charts: trend charts (entries/day, DAU/WAU/MAU), retention and streak distributions, cohort analysis (new vs returning by month); CSV and PNG export per chart

How calculations work (high level)
- Distinct active days (month/global top users): a user is counted once per day with activity
- Early visitors: number of days where the first entry of the day was before 08:00 (local time)
- Night visitors: number of days where there exists an entry at/after 22:00; days are counted once based on the first post‑22:00 entry
- Longest streak: maximum consecutive day streak with activity; computed per user either within the month or across all time (global)
- Day achievements: also include busiest hour and most used lock; these are hidden in Month mode

Screens and behavior
- Default view shows Achievements for the selected range (Day/Month) and the entries table
- Month view also shows a Leaderboard block (user‑centric)
- Global Leaderboard can be toggled under the monthly leaderboard and appears instantly without pressing Apply
- Searching by user switches the view into a profile: lifetime stats + achievements, plus the entries table for the selected range; leaderboards are hidden in this mode
 - Season mode: selecting a Season switches the view to that season’s date range (disables date/range pickers); the leaderboard shows “this season” and user search reveals a “Season progress” box

Tech stack
- Next.js App Router (server components)
- Tailwind (via @import tailwindcss in app/globals.css)
- MongoDB with Mongoose (see lib/mongodb.js)

Testing
- Unit tests use Vitest. Pure helper functions are in lib/utils.js to enable isolated tests.
- Run tests: npm test
- API contract tests: see tests/api.contract.test.js — validates response shape, headers (X-Request-ID), and rate limiting behavior using mocks.

Project structure (key files)
- app/page.js — Main UI: filters, achievements, leaderboards, table, pagination
- app/api/route.js — Single API endpoint implementing all queries and aggregations
- app/layout.js — Global layout and metadata (title and description)
- app/components/AutoSubmitSelect.js — Select that auto‑submits its enclosing form on change
- app/components/AutoSubmitCheckbox.js — Checkbox that auto‑submits (used for Global Leaderboard toggle)
- lib/mongodb.js — Mongo connection helper using MONGO_URI
 - lib/utils.js — Pure helpers (buildQuery, formatLocalYMD, computeAchievements, formatDurationHM) with unit tests
 - tests/utils.test.js — Vitest unit tests for helpers

Environment and setup
1) Requirements
- Node.js 18+
- A MongoDB instance (local or hosted)

2) Configure environment
- Create a .env.local file in the repo root with:

  MONGO_URI="your mongodb connection string"

3) Install and run
- Install dependencies: npm install
- Development server: npm run dev (http://localhost:3000)
- Production build: npm run build
- Start production: npm run start

Data model
- Entries collection (see app/api/route.js model):
  - username: string
  - lockId: string
  - entryTime: Date
  - lockMac: string
  - recordType: number
  - electricQuantity: number

Query parameters (UI/API)
- page: number (pagination)
- limit: number (25/50/100)
- date: YYYY-MM-DD for Day or YYYY-MM for Month
- period: "day" | "month"
- lockId: string (optional)
- userId: string (username; case‑insensitive exact match)
- showGlobal: "1" to show lifetime leaderboard (only visible in Month mode, not in user search)
 - season: string (season key). When present, it overrides date/period and uses the season’s start/end window. Treated like Month for user‑centric metrics.

Timezone behavior
- All hour‑based and day‑bucketing calculations in the API are timezone‑aware and use the server’s local timezone. This keeps UI and backend aligned for 08:00/22:00 logic and distinct‑day counting.

Design choices and constraints
- Leaderboards are hidden for Day view (requested UX); they appear in Month view only
- Lock‑related metrics are not shown in Month mode and are not part of leaderboards there
- Deterministic sorts with tie‑breaks ensure stable pagination and repeatable results
- The date input prevents selecting future dates; Month view uses a month‑only input
 - When a Season is active, date/range navigation is suppressed and the view labels use “this season”

Seasons & progression
- Season catalog is currently hard‑coded in the API (see app/api/route.js, SEASONS array). Each season has key, name, startAt, endAt.
- Selecting a season applies that time window to all queries and aggregates; the Achievements heading switches to “this season,” and the Leaderboard shows the season standings.
- Progression model (per user within the selected season):
  - Points = number of distinct active days during the season
  - Rank = position by points among all users in the season
  - Streaks = current and longest consecutive day streaks within the season
  - Levels = simple thresholds at 1/5/10/20/30 points, shown with the next milestone

Troubleshooting
- Ensure MONGO_URI is set and reachable; the server will throw if missing
- If times look off by a day or hour, confirm the server’s timezone and data timestamps
- Large datasets: MongoDB aggregations are optimized but indexes on entryTime/username/lockId will help at scale
 - PostCSS/Tailwind: Next 15 requires object-map plugins in postcss.config.mjs

Operations & secrets
- See docs/SECRETS.md for environment variables, rotation, and platform guidance

Roadmap ideas
- User‑configurable timezone via env var
- Additional achievements (e.g., weekly streaks, weekend warriors)
- CSV export and charting

License
- Proprietary to ozols.club (adjust as appropriate for your distribution needs)
