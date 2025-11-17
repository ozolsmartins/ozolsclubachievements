Ozols Club Achievements – 3 Person‑Months Product Plan
=====================================================

Purpose
- Answer: “What does this project need additionally to make it worth ~3 person‑months of code?”
- This roadmap defines high‑impact, scoped deliverables that turn the current prototype into a production‑ready, engaging achievements product for ozols.club.

Assumptions
- Stack remains Next.js + MongoDB; existing API endpoint and UI continue to evolve.
- Timezone remains server‑local for all calculations unless otherwise noted.
- Target: ~12–13 weeks of focused engineering (≈ 3 person‑months at 1 FTE or ≈ 1 month with 3 FTEs working in parallel).

Guiding principles
- Product value first: features that retain and motivate users (achievements, seasons, profiles, notifications).
- Operational excellence: predictable performance, test coverage, observability, and admin tooling.
- Iterative delivery: ship value every 2–3 weeks with clear acceptance criteria.

Scope overview
1) Productize achievements (rules engine + admin)
2) Seasons & progression
3) Notifications & digests
4) Profiles & lightweight auth
5) Anti‑cheat & data quality
6) Analytics & charts
7) Exports & integrations (CSV/JSON/Webhooks)
8) Performance & scalability
9) Observability & reliability
10) Testing & CI/CD
11) Accessibility, i18n, UX polish
12) Admin dashboard
13) Mobile/PWA
14) Security & compliance
15) Documentation & operations

Detailed deliverables and acceptance criteria

1) Productize achievements (rules engine + admin) — ~2–3 weeks
- Declarative rules DSL for achievements: thresholds, time windows (early/night), streaks, distinct‑day counts, exclusions.
- Versioned badge metadata (title, description, icon), enable/disable flags, rollouts.
- Admin UI: create/edit rules, preview on sample user/date, dry‑run & backfill.
- Backfill job: idempotent, resumable; progress and audit logs.
Acceptance: A non‑developer can create a new badge and see awards applied after backfill; preview matches production counts.

2) Seasons & progression — ~2 weeks
- Season model (start/end), scoring (e.g., distinct active days), seasonal badges.
- Automatic rollovers; archived season pages with winners/records.
- Hall of Fame section.
Acceptance: Previous season shows frozen standings; new season starts with clean slate, badges issued per season rules.

3) Notifications & digests — ~1.5 weeks
- Email (and/or web push) for achievements, streak milestones, rank movements.
- Weekly/monthly personal digest emails with stats and highlights.
- User preferences: per‑type opt‑in/out; unsubscribe links; rate limiting.
Acceptance: Test user receives expected notifications without duplication; preferences honored.

4) Profiles & lightweight auth — ~2 weeks
- Passwordless magic‑link login to let users claim identity from logs.
- Public profile toggle; shareable OG images (badges + summary).
- Privacy controls: opt‑out from leaderboards; hide certain achievements.
Acceptance: User can claim profile, adjust privacy, and share a profile card that renders correctly.

5) Anti‑cheat & data quality — ~1 week
- Duplicate/clock‑skew detection, impossible streak guards.
- Suspicious patterns (e.g., >N entries/min) flagged; admin review queue.
Acceptance: Flagged data is excluded from aggregates until approved; decisions auditable.

6) Analytics & charts — ~1 week
- Trend charts: entries/day, DAU/WAU/MAU; retention and streak distributions.
- Cohort analysis: new vs. returning by month.
Acceptance: Charts render for current filters; CSV/PNG export available.

7) Exports & integrations — ~0.5–1 week
- CSV export for tables/leaderboards; JSON API for aggregates.
- Webhooks: achievement earned, season end; retry with backoff.
Acceptance: Admin can register a webhook and observe event deliveries and retries.

8) Performance & scalability — ~0.5 week
- Indexes: entryTime, username, lockId, composite (username+entryTime).
- Background rollups (daily user activity); cache layer with SWR.
Acceptance: P95 latency meets target on dataset of size N; pagination remains deterministic.

9) Observability & reliability — ~0.5 week
- Structured logs, request IDs, slow query tracing.
- Error reporting (Sentry) + health endpoint.
Acceptance: Errors appear in Sentry with context; /health reports OK and includes build SHA.

10) Testing & CI/CD — ~1 week
- Unit tests for aggregation and rules; contract tests for API; Playwright E2E for filtering/search/profile flows.
- GitHub Actions: lint/test/build; preview deployments.
Acceptance: CI gates merges; failing tests block; preview URLs for PRs.

11) Accessibility, i18n, UX polish — ~0.5–1 week
- WCAG AA audit; keyboard navigation; focus states.
- i18n scaffolding; externalized strings; RTL readiness.
Acceptance: Axe scan passes; locale switch demonstrates translated copy.

12) Admin dashboard — ~0.5–1 week
- Sections: Rules & badges, Seasons, Review queue (anti‑cheat), Announcement banner.
- User merge tool for duplicate usernames.
Acceptance: Admin can merge two usernames; aggregates reflect merge after backfill.

13) Mobile/PWA — ~0.5 week
- Installable PWA; offline cache for last month view; responsive stacked table rows.
Acceptance: Lighthouse PWA passes; offline capability demonstrated.

14) Security & compliance — ~0.5 week
- Rate limiting on API/admin routes; secrets management docs.
- GDPR‑friendly data export/delete workflow.
Acceptance: Export JSON available to user; admin can process delete requests; rate limits tested.

15) Documentation & operations — ~0.5 week
- ADRs (timezone/streaks/seasons), backfill/runbooks, env configuration matrix.
Acceptance: A new engineer can set up locally and run a backfill from docs alone.

Milestones (suggested)
- M1 (Weeks 1–3): Rules engine + Admin; CI foundation; indexes.
- M2 (Weeks 4–6): Seasons; Profiles/Auth; initial Notifications.
- M3 (Weeks 7–9): Analytics; Anti‑cheat; Exports/Webhooks; Observability.
- M4 (Weeks 10–12): PWA; Accessibility/i18n; Security; Docs; polish.

Risks & mitigations
- Email/push deliverability: start with email (verified sender, domain auth), add push later.
- Mongo version/features: ensure $dateTrunc availability; fallback to $dateToString if needed.
- Backfill scale: chunked processing with checkpoints; feature flags for staged rollout.

Open questions
- Do users need OAuth SSO (Google/Apple) in addition to magic links?
- Should timezone be user‑configurable or instance‑wide?
- Do we need role‑based admin (owner/moderator) separation now or later?

Appendix: High‑level data model additions
- AchievementRule: { key, version, type, params, active, createdAt, updatedAt }
- Award: { user, ruleKey, ruleVersion, earnedAt, metadata }
- Season: { key, name, startAt, endAt, scoring, active }
- Flag: { user, day, reason, status, createdBy, resolvedBy, resolvedAt }
- NotificationPreference: { user, channels, categories }
