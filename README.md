# StudentDirectory-REVAMPED

A full-stack student directory system for a tutoring center. Ingests daily Excel reports,
parses and stores them in MongoDB, and exposes a Flask REST API for a React frontend
dashboard.

---

## Tech Stack

- **Database**: MongoDB Atlas (`StudentDirectory` database)
- **Backend**: Python / Flask
- **Data ingestion**: Python (`openpyxl`)
- **Tests**: `pytest` + `mongomock`
- **Frontend**: React + TypeScript + Vite — **Sigma**, in `frontend/` *(in progress)*

---

## Setup

The connection string carries cluster credentials and is **not** in source. Copy the
template and fill it in:

```bash
cp .env.example .env      # then set MONGODB_URI and API_KEY
pip install -r requirements.txt
python app.py
```

`API_KEY` is required. Generate one with
`python -c "import secrets; print(secrets.token_urlsafe(32))"`. Without it the API
answers `500` on every route except `/api/health` — an unconfigured server costs
availability rather than serving student data openly.

`ALLOWED_ORIGINS` is optional and defaults to the local dev servers. Set it when the
frontend is served from anywhere else.

Starts Flask on `http://127.0.0.1:5000` with the debugger **off**. `.env` is gitignored —
never commit it.

`HOST`, `PORT` and `FLASK_DEBUG` are all optional and default to the safe values above.
To debug:

```bash
FLASK_DEBUG=1 python app.py
```

⚠️ **Do not combine `FLASK_DEBUG=1` with a non-loopback `HOST`.** `FLASK_DEBUG=1` installs
the Werkzeug debugger, whose traceback pages carry a console that executes arbitrary
Python *in the server process* — `os.environ` there holds `MONGODB_URI` and `API_KEY`, so
it is full credential compromise, not an error page. `HOST=0.0.0.0` binds every interface,
putting that console on the local network. The PIN Werkzeug prints is not a security
control: it is written to stdout and derived from machine characteristics, and Werkzeug's
own documentation says so.

`app.run()` is Werkzeug's development server either way — no request timeouts, no
slow-client protection, and it says as much on startup. A deployment needs a real WSGI
server in front of `create_app()`.

### Running the frontend

**Sigma** lives in `frontend/` — React + TypeScript on Vite. With Flask already
running:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

**The frontend has no API key of its own.** The browser calls same-origin `/api/*`, and
the Vite dev server attaches `X-API-Key` on the way through to Flask, reading `API_KEY`,
`HOST` and `PORT` straight out of the **root** `.env` — the same file `app.py` reads. So
the key never enters the bundle, and CORS is never exercised in development.

This is a development-only bridge. A browser cannot hold the shared key (`auth.py` says
why: anything in the bundle is readable in DevTools), so a deployed frontend is blocked on
the session authenticator under **TODO → API**. `npm run build` produces a `dist/` that is
not yet servable for that reason.

---

## MongoDB Collections

Counts below reflect the current dataset: 29,382 sessions spanning 2024-08-09 to
2025-09-17.

### `dwp_reports` — 29,382 documents

Raw Digital Workout Plan records imported from daily Excel exports. Compound string
fields (`Session`, `General Information`, `Digital Reward System`, `Student Materials`,
`Schoolwork`, `LP Assignment`, `Center`) are split into discrete typed fields at import
time by `transform_dwp_row()`.

Identity and timing: `account_id`, `lead_id`, `student_name`, `sessions_this_month`,
`delivery_method`, `centers[]`, `center_orgs[]`, `instructors[]`, and four native `Date`
fields — `date`, `session_start`, `session_end`, and
`finalized_date`.

Work: `finalized`, `pages_completed`, `session_page_goal`, `mathlete_score`, `topics[]` (each
`{id, name, status}` where status is `Worked On` / `Mastered` / `Completed`),
`schoolwork_*`, `card_level`, `stars_current`, `stars_max`, `session_stars_added`.

Notes: `session_summary_notes`, `student_notes`, `internal_notes`,
`notes_from_center_director`, `assessment`.

**Indexes**: `date`, `account_id`, `row_hash` (**unique** — this is what enforces import
idempotency), `finalized`.

### `students` — 893 documents

Aggregated per-student profiles built from `dwp_reports`. Each document is a full
dashboard view. Rebuilt by `ingestion/build_students.py`.

`student_key`, `account_id`, `student_name`, `total_sessions`, `total_pages_completed`,
`last_session_date`, `last_assessment`, `centers[]`, `instructors[]`, `topics[]`,
`total_unique_topics_mastered`, `total_unique_topics_completed`,
`total_unique_topics_finished`, `total_topic_reassignments`, `total_topics_on_plan`,
`total_topics_removed`, `dwp_report_ids[]`, `last_modified`.

**Topic status is a ladder, not three labels.** `Worked On` means worked on but not
completed; `Completed` means completed but not mastered; `Mastered` means completed *and*
mastered. The data bears that out — of 13,598 (student, topic) pairs, 94.3% start at
`Worked On` and 62.8% end at `Mastered`, forward moves outnumber backward ones roughly ten
to one (9,061 against 892), and mastery takes a median of three sessions from first sight.

`topics[]` is one entry per topic holding the whole history, because a topic is worked
through repeatedly rather than reached once:

```python
{'id': 'PK-3157-00', 'name': 'Distributive Property',
 'sessions': 16,              # times worked through
 'times_worked_on': 11, 'times_completed': 0, 'times_mastered': 5,
 'times_assigned': 5,         # times it was put on the plan
 'last_assignment_started': ...,
 'first_seen': ..., 'last_seen': ...,
 'status': 'Mastered',        # where it stands now
 'state': 'finished'}         # finished | on_plan | removed
```

Four things to know before reading it:

- **A topic is never idle on a plan.** If a student is working other topics instead, this
  one came off the plan; when it returns that is a **fresh assignment**, prompted by a new
  assessment or lesson plan. So `times_assigned` counts assignments, and the boundary is
  measured in *topics that displaced it* — six or more — not in days or sessions elapsed,
  because students work at very different paces. A status dropping back down the ladder
  also starts one, since that is a topic handed back with no gap at all.
  Of the 37,121 returns to a topic, 97.1% had five or fewer others in between, so the rule
  fires on the clearest 2.9% and would rather join two real assignments than split one.
  14,833 assignments across 13,598 topics; 1,096 topics were assigned more than once, one
  of them five times.
- **`state` is the honest answer to "what is this student working on".** It reads the
  **last** assignment only: `finished`, `on_plan`, or `removed`. 2,117 topics are removed
  against 2,534 still on a plan — so treating every unfinished topic as open would
  overstate by nearly half.
- **The `total_unique_*` counts mean *ever*, not *currently*.** A topic mastered and then
  assigned again still counts there, which is exactly when it disagrees with `state`.
- **Show `total_unique_topics_finished`, not `..._completed`.** The source writes one
  status per session rather than both, so a mastered topic is almost never also written as
  `Completed` — 8,739 of the 13,598 entries were mastered without it. That makes the
  completed count the rare **completed-but-not-mastered** remainder: 450 topics across 257
  students, against **9,189 topics across 752 students** actually finished. A profile page
  reading the wrong one understates a student's work about twentyfold. `Completed` is also
  very nearly terminal — only 5 pairs in the whole dataset ever move `Completed` →
  `Mastered`.

`Worked On` is counted per topic but never on its own: it is the state of a topic still in
progress, on 40,949 of the 50,900 topic entries.

**Indexes**: `student_key` (unique), `account_id` (**not** unique — represents household),
`(student_name, student_key)`

Defined once in `util.py`:

```python
student_key = f"{account_id}_{slug(student_name)}"
# 75619a85-d16e-4f94-bd1e-4b88cbe249d0_anthony-williams
```

`split_student_key()` recovers the pair exactly.

**Consequences for any new code:**

- Group aggregates by `(account_id, student_name)`, never `account_id` alone.
- Never put a unique index on `account_id` in `students`.
- Filtering sessions for one student needs **both** fields — `account_id` alone returns
  the whole household.

Totals reconcile exactly to `dwp_reports`: 29,382 sessions, 153,360 pages.

### `instructors` — 103 documents

Aggregated instructor profiles built from `dwp_reports`. Rebuilt by
`ingestion/build_instructors.py`.

`instructor_name`, `total_sessions_taught`, `co_taught_sessions`, `unfinalized_sessions`,
`total_pages_completed`, `total_days_taught`, `days_taught[]`, `last_session_date`,
`unique_students`, `students[]` (roster keyed by `student_key`), `centers[]`,
`last_modified`.

**Index**: `instructor_name` (**unique** - Instructors are identified by name alone, because that is all the source data carries.
Two distinct people sharing a name would merge into one document.).

**Co-taught sessions credit each instructor the full page count** — pages are copied, not
split. 2,563 of 29,382 sessions have more than one instructor, so summing
`total_pages_completed` across instructors comes to 168,623 against the 153,360 pages
actually recorded. That overshoot is intended: these are per-instructor figures answering
"how much work happened in sessions I ran". **IMPORTANT - Do not sum them for a center-wide total** —
aggregate `dwp_reports` directly for that.

### `attendance_reports` — 29,311 documents

One document per student per **day attended**, built from `dwp_reports` by
`ingestion/build_attendance.py`.

`student_key`, `account_id`, `student_name`, `date`, `sessions`, `sessions_timed`,
`centers[]`, `instructors[]`, `delivery_methods[]`, `pages_completed`, `minutes_present`,
`first_session_start`, `last_session_end`, `dwp_report_ids[]`, `last_modified`.

**Indexes**: `(student_key, date)` (unique), `date`, `account_id`, `student_key`.

**A day is not a session.** 70 student-days carry more than one DWP row (69 with two, one
with three), so 29,382 sessions collapse to 29,311 days. Counting rows overstates
attendance by exactly those 71 extra sessions.

---

## Rebuilding the aggregates

All three builders are pure functions of `dwp_reports` — nothing in `students`,
`instructors` or `attendance_reports` is authored, so they can be rebuilt from scratch at
any time.

```bash
python ingestion/import_reports.py      # Excel -> dwp_reports
python ingestion/build_students.py      # dwp_reports -> students
python ingestion/build_instructors.py   # dwp_reports -> instructors
python ingestion/build_attendance.py    # dwp_reports -> attendance_reports
```

Each builder `drop()`s and recreates its target collection, and creates indexes **before**
inserting so a bad build fails ahead of the write.

### Migrations

One-time scripts, both dry-run by default and committed with `--apply`:

```bash
python ingestion/migrations/backfill_row_hash.py --apply               # hash pre-idempotency rows
python ingestion/migrations/backfill_session_times.py --apply          # 'None' times -> null
python ingestion/migrations/backfill_center_split.py --apply           # 'Loc, Org' -> centers + center_orgs
python ingestion/migrations/backfill_finalized.py --apply              # add the finalized flag
python ingestion/migrations/backfill_placeholder_instructors.py --apply  # drop anonymization placeholders
python ingestion/migrations/backfill_finalized_date.py --apply         # finalized_date -> datetime
python ingestion/migrations/backfill_session_datetimes.py --apply      # session times -> datetime
```

Each one rewrites `row_hash` alongside the value it changes, proves every rewritten hash
is still distinct before writing, and aborts untouched if not. `backfill_center_split.py`
and `backfill_placeholder_instructors.py` change data the aggregates embed, so rebuild
after those two.

**`import_reports.py` is idempotent for unchanged files.** Every row carries a `row_hash`
content fingerprint, `_upsert()` skips hashes already stored, and a unique index on
`row_hash` enforces it at the database. Re-importing a file that is already loaded reports
its rows as already present rather than duplicating them.

⚠️ **A row edited at the source is imported as a new document.** The hash covers the whole
document, so a corrected row hashes differently, fails to match, and lands beside the
original — both versions then count in the aggregates. Correcting an already-imported row
is a separate operation from re-importing a file. Fixing this needs a *natural* key
(`account_id + student_name + date + session_start` is the only stable candidate) to
identify the session, with the hash demoted to change-detection.

---

## Tests

```bash
pip install -r requirements-dev.txt
pytest                  # 412 offline tests -- no network, no credentials (~2s)
pytest --integration    # + 53 read-only checks against the real cluster
```

**Offline.** Runs against `mongomock`. `tests/conftest.py` reads the real `MONGODB_URI`,
then overwrites the environment variable with an unroutable sentinel, so a test that ever
escapes the mock fails to resolve rather than reaching Atlas. Nothing in this layer writes
anywhere. `Database`'s class-level client cache is reset around every test.

The fixture directory in `tests/sample_data.py` is three students, two of them siblings on
one account, because that is where this schema breaks. Most assertions turn on that pair —
a household with 3 sessions in which one student owns 2. Three instructors sit beside them,
two sharing one session so that co-taught page double-counting is visible in the fixtures
rather than only on the cluster.

**`--integration`.** Read-only checks (`tests/test_live_database.py`) that catch a bad
ingestion run before the API serves it:


These skip with a clear message when `MONGODB_URI` is unset or still holds the
`.env.example` placeholders, so they are safe to leave in a CI run that has no credentials.

---

## API

| Method | Route | Notes |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/metrics` | collection counts and averages |
| GET | `/api/students` | a page of students; `?query=` to search, `?account_id=` for one household's siblings |
| GET | `/api/students/search?q=` | name search, minimum 2 characters |
| GET | `/api/students/<student_key>` | one student plus their sessions |
| GET | `/api/students/<student_key>/attendance` | sessions attended in a period; `?start=` and `?end=` required, `YYYY-MM-DD`, both inclusive |
| GET | `/api/instructors` | a page of instructors; `?query=` to search by name |
| GET | `/api/instructors/search?q=` | name search, minimum 2 characters |
| GET | `/api/instructors/<instructor_name>` | one instructor, with the roster and days taught |

`/api/metrics` reports `total_attendance_records` and `avg_attendance_per_student` from
`attendance_reports`, so both count **days attended**, not sessions.

### Pagination

All four list routes take `?limit=` and `?offset=` and answer in one envelope:

```json
{ "students": [ ... ],
  "page": { "limit": 50, "offset": 0, "total": 893, "returned": 50 } }
```

---

## Date Range Queries

`date` in `dwp_reports` is a native MongoDB `Date` with an index, so date-range filtering
is efficient. The `students` and `instructors` collections hold **all-time** aggregates —
for date-scoped metrics, query `dwp_reports` directly.

Scope by student, not by account, or you will get every sibling's sessions:

```python
pipeline = [
    {'$match': {
        'account_id':   account_id,
        'student_name': student_name,     # both fields, or you get the household
        'date': {'$gte': start, '$lte': end},
    }},
    {'$group': {'_id': None, 'pages': {'$sum': '$pages_completed'}}},
]
```

---

## Known Issues

- **A row edited at the source imports as a new document** rather than replacing the
  original — see *Rebuilding the aggregates*. Re-importing an unchanged file is a no-op.
- **A list row still costs more than it should.** Paging and the `instructors[]` projection
  took `/api/students` from 1.08 MB to 31.0 KB a page, but what remains is mostly field
  *names* paid once per row: the six topic counters are ~160 KB across 893 students, much
  of it spelling `total_unique_topics_completed` out 893 times. Nothing to fix there short
  of an explicit allowlist projection naming the handful of fields a results table draws,
  which is worth doing once the frontend says which ones those are.
- **Two topic counts that sound alike and answer different questions.**
  `total_unique_topics_finished` means a topic was **ever** completed or mastered;
  `state == 'finished'` means its **most recent** assignment ended that way. They disagree
  for 242 topics — the ones finished once and then assigned again. Both are correct and
  both are wanted (one for "what has this student achieved", one for "what is open now"),
  but the names do not advertise the difference, so a reader reaching for "finished" can
  easily take the wrong one. A live check asserts the gap still exists; if it ever closed,
  one of the two would be redundant.
- **No user accounts.** The shared `API_KEY` authenticates a *caller*, not a person, so
  there is nothing to audit and nothing to revoke short of rotating the key for everyone.
  A browser client will need session auth regardless — see the API section.
- **`app.run()` is a development server**, whatever `HOST` and `FLASK_DEBUG` are set to.
  Nothing enforces that `FLASK_DEBUG=1` and a non-loopback `HOST` are never combined —
  the defaults are safe and the danger is documented, but it is still two env vars away.
  A deployment needs a real WSGI server instead.
- **Four collisions on the natural key.** Four student-days have two rows sharing a
  `session_start`. Three are an abandoned draft beside the real record, and the
  `finalized` flag now separates those; the fourth (2025-07-01) is two completed reports
  for one session by two instructors, which needs a human decision. Scoped to finalized
  rows, only that one remains — so a partial unique index is available once it is
  resolved.
- **217 sessions have no recorded end time.** The source writes the literal string
  `'None'` into `session_end` rather than leaving it blank. `parse_session` now nulls it
  on the way in and `backfill_session_times.py` cleaned the stored rows, so nothing
  downstream sees the string any more — but the underlying gap is untouched: those 217
  sessions cannot be given a duration, and they are counted in `sessions_timed` as
  unmeasured rather than assumed. **To address:** find out why the source omits the end
  time (a session closed by timeout? an unfinished punch-out?), and decide whether an
  unended session should be flagged for follow-up rather than silently unmeasurable.
- **Unbounded arrays.** `dwp_report_ids` runs to 192 entries per student and `topics` to
  100, `days_taught` to 272 per instructor, and instructor rosters to 304. All grow with
  the dataset, and all are far from MongoDB's 16 MB document limit — accepted, not a
  pending fix.
- **Session times are local wall clock at the point of entry, with no zone attached.**
  The source records "3:58 PM" as whoever filled in the report saw it, and `date`,
  `session_start`, `session_end` are stored naive — which Mongo keeps as UTC, so they read
  as `15:58Z` while meaning 3:58 PM local. **Assumed for now: one timezone throughout.**
  It breaks the moment two locations in different zones are compared: a 4 PM session at each is the same
  stored number but not the same moment, so "who taught latest" and any cross-center
  duration or overlap would be quietly wrong. `@Home` sessions are the likelier first
  crack, since the student need not be near the center at all. Fixing it means a zone per
  center, the DST boundaries across 2024–2025, and a backfill of all 29,382 rows — not
  worth it until a second zone actually exists. Until then, read and render these in UTC;
  converting to a local zone corrupts them. Documented at the two ends in
  `combine_session_time` (`ingestion/import_reports.py`) and `frontend/src/api/bson.ts`.

---

## TODO

Priorities are relative to the next milestone — a frontend a manager can actually use.
`P1` blocks it, `P2` comes straight after, `P3` is later or still being thought through.
Items are listed in priority order within each group.

### Data integrity

- [x] `P2` **Add completed topics to `students`.** Done, as part of `topics[]` — one entry
      per topic with per-status counts, reassignments and current standing. Rebuilt:
      13,598 topic entries, 187 students with a reassigned topic.
- [ ] `P2` **Add most-taught topics to `instructors`.** Ranked topic counts across the
      sessions each instructor ran; the collection carries no topic data today. For the
      instructor profile page.
- [ ] `P2` **Switch `_upsert()` to the natural key**, so an edited row updates its document
      instead of landing beside it. Hash demoted to change detection. The write endpoints
      need this.
- [ ] `P3` **Split restricted fields out of `dwp_reports`** so access is decided by what a
      caller can reach, not by every reader remembering `PRIVATE_FIELDS`. Candidate axes:
      sensitivity, center. *Exploring — not decided.*
- [ ] `P3` **Keep aggregates current once the API writes reports.** `students`,
      `instructors` and `attendance_reports` are batch-built; update on write, or show how
      stale they are. Moot until something writes.
- [ ] `P3` **Partial unique index** on `(account_id, student_name, date, session_start)`
      where `finalized: true` — blocked on the one 2025-07-01 duplicate under *Known
      Issues*.
- [ ] `P3` **A rename map for centers**, so a rebrand merges into one identity instead of
      taking a parser change and a backfill each time. The 2025-09-05 `Mann Mathematics` →
      `Math Made Simple` cutover is normalized at import today, and the next one would be
      handled the same way. Low priority — the data already in the cluster is merged.
- [ ] `P3` **Check the anonymization mapping for other placeholders** mapped from blank
      fields. One instructor name already found; students and centers not yet checked.

### API

- [x] `P1` **Expose the `instructors` collection** — `Instructor` model, list, detail by
      `instructor_name`, name search. Done; see the API table.
- [x] `P1` **Paginate the list routes.** `?limit=`/`?offset=` in a shared envelope on all
      four, sorted and index-backed so pages cannot repeat a row. A page of students is
      31.0 KB against 1.08 MB for the old full list. Done; see the API section.
- [ ] `P1` **Session authentication** for the React client — an authenticator in
      `AUTHENTICATORS`, `supports_credentials` on CORS, a signing secret. The shared
      `API_KEY` cannot go in a browser.
- [ ] `P2` **Per-user permissions** on top of it. Identity alone does not say what a user
      may read; everything that scopes data depends on this.
- [ ] `P2` **Write endpoints for the report form** — create, update, finalize, plus the
      validation the importer never needed. Needs the natural-key switch above.
      *Open:* whether drafts live in `dwp_reports` as `finalized: false` or their own
      collection.
- [ ] `P2` **Center-wide metrics.** Sessions, students, pages and instructors per location
      — the four centers have no rollup and no route. Has to aggregate `dwp_reports`
      directly: instructor totals double-count co-taught pages, so they cannot be summed
      into a center figure. *Open:* a built `centers` collection like the other aggregates,
      or computed per request, which is what would make a date range possible.
- [ ] `P2` **Per-topic stats endpoint**, backing the Topics tab under **Frontend** — the
      one thing that page is blocked on. Rolls up `students.topics[]` rather than
      `dwp_reports.topics[]`: the per-topic history is already computed there, so this is
      a rollup of 13,598 existing entries into 771 topics, not a re-derivation. Per topic:
      students who worked it, finished, on plan, removed; median sessions to finish;
      reassignments. *Open:* a built `topics` collection like the other aggregates, or
      computed per request — the same question the center metrics above carry, and the same
      trade, since computed is what would allow a date range.
      *Also open:* the canonical name. `PK-3121-00` appears as both "Reducing Fractions
      using GCF" and "Simplifying Fractions using GCF" — one topic renamed at the source,
      the same shape of problem as the centers rename map below, and it has to resolve to
      one name before topics can be listed.
- [ ] `P2` **Decide who sees `student_notes`** (3,594 rows). Fine for instructors,
      questionable parent-facing. Needed before anything reaches a parent.
- [ ] `P3` **Prompt-driven agent for niche stats.** Hard requirement: it reads only what the
      asking user may see, through a pre-projected, permission-scoped surface — never the
      raw database. Blocked on permissions. Must encode the traps that make it answer
      confidently wrong: a day is not a session, `account_id` is a household, and the
      aggregates are all-time.

### Deployment

- [ ] `P2` **Serve `create_app()` from a real WSGI server** (`waitress` / `gunicorn`) and
      document the production command, leaving `python app.py` as the dev-only path. Due
      the moment anyone but you loads the frontend.
- [ ] `P3` **Startup interlock** refusing `FLASK_DEBUG=1` together with a non-loopback
      `HOST`.

### Development

- [ ] `P2` **Dev database for form writes**, so drafts can be saved, reopened and finalized
      without test reports landing in the real collection. `MONGODB_DB` already selects it;
      what is missing is a seed and a documented way to point at it. *Open:* anonymized
      slice vs. hand-written fixtures.

### Frontend

**Layout reference.** The target shape is a conventional admin shell: a fixed left sidebar
(logo, one primary action button, icon nav, settings at the bottom), a top bar carrying
global search and the user menu, and a content area of cards — a top row of small tiles
above a mixed grid of chart, list and highlight cards. Where that reference puts fixed KPI
tiles, **this app puts the user's pinned stats** — the top row is assembled by pinning, not
hard-coded. Each card owns its header controls: a period dropdown where the data is
time-scoped, and an overflow menu in the corner, which is where the pin button lives.

- [x] `P1` **App shell and the data path.** `frontend/` — Vite + React + TypeScript, the
      sidebar/top-bar/card layout above, CSS custom-property tokens in
      `src/styles/tokens.css`, and a typed client in `src/api/` that unwraps the Extended
      JSON `json_util` emits (`{"$date"}`, `{"$oid"}`) and tells 400/401/500 apart. Auth in
      dev is a Vite proxy injecting `X-API-Key`; see **Running the frontend**.
- [x] `P1` **Student search.** Answered as the persistent top-bar dropdown the layout
      reference implies, not a page of its own: debounced, `?limit=10`, `page.total` for the
      "N more" line, and Enter takes the whole term to the list as "see all". Both open
      questions in the old note are settled that way. Instructor search is still unwired.
- [x] `P1` **Student list**, paged off the shared envelope with `query` and `offset` in the
      URL so a result is linkable and Back steps through pages.
- [x] `P1` **Student profile page** — header stats, centers, instructors, topics and full
      session history, reached from a search result or a name in the list. Frontend-only as
      predicted: `/api/students/<key>` serves it in one response. The topics card filters on
      `state` and opens on **On plan**, since `total_unique_*` means *ever*; the session
      history pages 25 at a time **in the browser** over the array already in memory, and
      rows expand to the notes and that session's topics.
- [x] `P1` **Session count panel on the student record.** Date range in the card's header
      controls, showing sessions against days and a per-month breakdown. Defaults to the
      three months ending at that student's **last session, not today** — the route refuses
      to guess a period for the same reason, and anchoring on today would open the panel
      empty on every student while the data ends 2025-09-17.
- [ ] `P3` **Page the detail route's `dwp_reports`.** The profile pulls every session in one
      response — 229 KB for the heaviest student (149 sessions). Fine at this size and the
      reason the page needed no API work; revisit if a student ever gets big enough to feel
      it.
- [ ] `P2` **Instructor list and profile page** — sessions taught, unique students, roster,
      centers, most-taught topics, `unfinalized_sessions` as a follow-up list.
      `/api/instructors/<name>` now serves everything except the topics. The nav item and
      the typed client exist; the route renders a placeholder.
- [ ] `P2` **Instructors in the global search.** The top-bar dropdown searches students
      only. `/api/instructors/search?q=` already answers in the same paged envelope and
      already returns everything a row needs — name, sessions taught, unique students,
      centers — so the client side is a `searchInstructors` call beside the existing
      `listInstructors` in `src/api/endpoints.ts` and a second section in the dropdown.
      Group the results under Students and Instructors headings with a count each, since a
      name can match both. Sits behind the item above: an instructor hit has nowhere useful
      to land while the profile is a placeholder. *Open:* whether Enter still means
      `/students?query=`, which stops being a sensible "see all" once results span both.
- [ ] `P2` **Topics tab in the sidebar** — per-topic stats across the whole program, which
      is the one question shape the app cannot answer today. 771 distinct topics over
      13,598 (student, topic) pairs: for each, how many students worked it, how many
      finished, how many are on plan or removed, median sessions to finish, and how often
      it was reassigned. Sortable, so "most reassigned" and "lowest finish rate" are
      reachable. *Half of Odd Numbers* is the shape — 176 students, 117 finished, 40 on
      plan, 23 removed, median 4 sessions, 18 reassignments. **Not frontend-only**, unlike
      the student profile: blocked on the topics endpoint under **API**. The per-student
      view of the same data is the profile's topics card.

      ⚠️ **Group or filter by topic type, or the finish-rate column lies.** The id prefix
      predicts it almost entirely: `PK` — the curriculum, 663 topics and 13,268 pairs —
      finishes 68.7%, while `GF` is 28.3%, `WCH` 13.0%, `FO` 11.4% and the single `WOB`
      topic 0.0% across 20 students. Those are a different kind of item and do not carry a
      completion status the same way, so a flat ranking by finish rate fills the bottom
      with them and reads as "hardest topics".
- [ ] `P2` **Report entry page** — fields filled in on the page, saved unfinished,
      finalized into `dwp_reports` as a normal document. Needs a list of what is still
      open. *Blocked on the write endpoints.*
- [ ] `P3` **Home dashboard the user assembles.** A pin button on any stat in the app puts
      that module in the top row of the home page — the row the reference layout fills with
      fixed KPI tiles. Every stat has to render standalone at tile size, and the layout is
      per person — browser storage until session auth lands. Not every stat will be
      pinnable; which ones qualify gets decided as the elements are built.
- [ ] `P3` **Spreadsheet upload page**, separately, for reports that arrive as `.xlsx`.
      The command-line import already works.
