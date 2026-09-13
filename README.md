# StudentDirectory-REVAMPED

A full-stack student directory system for a tutoring center. Ingests daily Excel reports,
parses and stores them in MongoDB, and exposes a Flask REST API for a React frontend
dashboard.

---

## Tech Stack

- **Database**: MongoDB Atlas (`StudentDirectory` database)
- **Backend**: Python / Flask
- **Data ingestion**: Python (`openpyxl`)
- **Tests**: `pytest` + `mongomock` (backend), Vitest + Testing Library + MSW (frontend)
- **Frontend**: React + TypeScript + Vite — **Sigma**, in `frontend/` *(in progress)*

---

## Requirements and versions

| Category | Component | Version / requirement |
|---|---|---|
| Runtime | Python | 3.x; minor version not currently pinned |
| Runtime | Node.js | `^20.19.0` or `>=22.12.0` |
| Runtime | MongoDB | Atlas or compatible MongoDB instance |
| Backend | pymongo | 4.6.1 |
| Backend | Flask | 3.0.0 |
| Backend | Flask-CORS | 4.0.0 |
| Backend | python-dotenv | 1.0.0 |
| Backend | openpyxl | 3.1.5 |
| Frontend | React | 19.2.8 |
| Frontend | React DOM | 19.2.8 |
| Frontend | React Router DOM | 7.18.3 |
| Frontend tooling | TypeScript | 6.0.3 |
| Frontend tooling | Vite | 8.2.2 |
| Frontend tooling | oxlint | 1.79.0 |
| Backend testing | pytest | 9.1.1 |
| Backend testing | mongomock | 4.3.0 |
| Frontend testing | Vitest | 4.1.11 |
| Frontend testing | Testing Library React | 16.3.3 |
| Frontend testing | Testing Library Jest DOM | 7.0.1 |
| Frontend testing | Testing Library User Event | 14.6.6 |
| Frontend testing | MSW | 2.15.0 |
| Frontend testing | jsdom | 30.0.1 |

Python packages are pinned in `requirements.txt` and `requirements-dev.txt`; frontend
versions are resolved by `frontend/package-lock.json`.

---

## Setup

The connection string carries cluster credentials and is **not** in source. Copy the
template and fill it in:

```bash
cp .env.example .env      # then set MONGODB_URI and API_KEY
pip install -r requirements.txt
python app.py
```

There are two ways in, and a server needs at least one of them:

```bash
python scripts/create_user.py <username>   # a person, for the browser frontend
# or set API_KEY in .env                   # a shared key, for scripts and server-side callers
```

`create_user.py` prompts for the password twice and never takes it as an argument.
Generate an `API_KEY` with
`python -c "import secrets; print(secrets.token_urlsafe(32))"`. With neither configured
every protected route answers `401` and `app.py` says so on startup — an unconfigured
server costs availability rather than serving student data openly.

`ALLOWED_ORIGINS` is optional and defaults to the local dev servers. Set it when the
frontend is served from anywhere else. It **cannot** be `*` — browsers refuse to send
cookies to a wildcard origin, so the app refuses to start on that combination rather
than serving one where login silently never works.

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

This API-key proxy is development-only. A browser cannot safely hold the shared key (`auth.py`
says why: anything in the bundle is readable in DevTools), so deployed builds use the session
cookie from `/api/auth/login` instead. `npm run build` produces a `dist/` that can be served
behind a web server or reverse proxy that routes `/api/*` to Flask.

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

**Indexes**: `date`, `account_id`, `finalized`, `natural_key`
(`account_id, student_name, date, session_start` — what every import looks its rows up by,
deliberately **not** unique), `row_hash` (**unique**, now a corruption tripwire rather than
the idempotency mechanism), and `(date DESC, _id ASC)`

### `students` — 893 documents

Aggregated per-student profiles built from `dwp_reports`. Each document is a full
dashboard view. Rebuilt by `ingestion/build_students.py`.

`student_key`, `account_id`, `student_name`, `total_sessions`, `total_pages_completed`,
`last_session_date`, `last_assessment`, `centers[]`, `instructors[]` (each
`{name, sessions, finalized_sessions, pages_completed}`), `topics[]`,
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
  **last** assignment only: `finished`, `on_plan`, or `removed`. 2,115 topics are removed
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
`total_pages_completed`, `days_taught[]`, `last_session_date`, `students[]` (roster keyed
by `student_key`), `topics[]`, `centers[]`, `last_modified`.

**Index**: `instructor_name` (**unique** - Instructors are identified by name alone, because that is all the source data carries.
Two distinct people sharing a name would merge into one document.).

**`topics[]` ranks what each instructor taught most** — `{topic_id, name, sessions}`, most
taught first then alphabetical, for the instructor profile page. It holds the same 16,932
(instructor, topic) pairs as `topics.instructors[]`, read from the other side — exactly the
way `students[]` here mirrors `students.instructors[]`. Both sides give each instructor on
a co-taught session full credit, so they agree pair for pair, and
`test_instructor_topics_and_topic_instructors_are_the_same_pairs` holds them to it. A
median instructor has 126 distinct topics; the widest, 504.

The display name comes from `build_topics.canonical_name`, so a topic the source spells two
ways reads the same here as on the topics page. That couples the builds: rebuild `topics`
after a source rename without rebuilding `instructors` and the old name lingers here until
this one runs too.

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

### `topics` — 771 documents

One document per topic across the whole program, built from `dwp_reports` by
`ingestion/build_topics.py`. Backs the Topics tab.

`topic_id`, `name`, `also_known_as[]`, `sessions`, `times_worked_on`, `times_completed`,
`times_mastered`, `unique_students`, `students_finished`, `students_mastered`,
`students_on_plan`, `students_removed`, `students_ever_finished`, `total_reassignments`,
`median_sessions_to_finish`, `instructors[]`, `first_taught`,
`last_taught`, `last_modified`.

**Indexes**: `topic_id` (**unique**), `(sessions, topic_id)` — the list's default order,
compound because 670 of the 771 topics share a session count with another and a partial
order cannot be paged — and `(name, topic_id)`, the same guarantee for a name ordering,
kept for the column-sort work.

**It reuses the student builder's history.** `build_topics.py` reads `dwp_reports` and
calls `build_students.build_topic_history()` per student, then rolls the results up by
id — so what counts as an *assignment*, and therefore `total_reassignments` and the three
state counts, has one definition shared with `students.topics[]`. Change
`DISPLACED_TOPICS_THRESHOLD` and both aggregates move together. The two reconcile exactly:
50,900 topic entries, 13,598 (student, topic) pairs, 1,235 reassignments.

**`students_mastered` is the mastery share of that finished group**, and the topic page
shows the pair as a fraction — 58/66 on `PK-3125-00`. Every finished student sits at
Mastered or Completed (8,551 and 398 of 8,949, no remainder), so
`students_finished - students_mastered` is exactly the students who completed a topic
without mastering it. 215 topics show a fraction below 1, 445 read *n/n*, and 111 have
nobody in that row at all — a zero denominator the page renders as a dash.

**It is counted inside the finished group, not off `status` across everybody.** The two
agree today — every student at Mastered or Completed is finished — but sourcing the
numerator differently would make the fraction depend on that holding, and the page divides
by `students_finished`. Note also that this is students, while `times_mastered` beside it
is sessions.

**Counts are per (student, topic) pair, not per session.** `students_finished` is how many
students finished the topic; someone who worked it across nine sessions counts once.
`state` reads a student's last assignment only, so the three state counts partition
`unique_students` exactly. `students_ever_finished` asks the other question — ever
completed or mastered, even if the topic was later handed back — so it can exceed
`students_finished`. `median_sessions_to_finish` is `null` for a topic nobody has
finished, which is an answer rather than a missing field.

**`instructors[]` ranks who taught the topic most** — `{name, sessions}`, most sessions
first, then alphabetical so the order is stable between builds. This is what the topic
page's "taught most by" list reads. It is a detail-view array: 16,932 roster entries
across 771 topics, a median of 17 per topic and 82 at the widest, so when `models/topic.py`
lands it should sit in a `LIST_PROJECTION` exclusion the way `topics[]` and `instructors[]`
already do on students (`models/student.py:11`).

**Co-taught sessions credit each instructor in full here too.** 5,216 of 50,900 topic
entries have more than one instructor, so the credits summed across a topic exceed that
topic's own sessions — 56,728 against 50,900 program-wide. Intended, and the same rule the
`instructors` collection applies to pages: these are per-instructor figures, not a
breakdown of the topic's sessions. **There is deliberately no page count on these entries**
— pages are recorded once per session and a session covers several topics, so charging a
session's pages to each of its topics would multiply the real number. `build_instructors`
can credit pages in full because its unit *is* the session; here it is not.

**Three ids carry two names, and only one is a rename.** `PK-3121-00` is the real one:
"Reducing Fractions using GCF" stops on 2024-10-01 and "Simplifying Fractions using GCF"
runs from 2024-10-05 to 2025-09-17. The other two are not renames at all — on `PK-3099-00`
and `PK-3081-00` both names start the same day and run side by side for the topic's whole
life, splitting near 50/50. A rename map would not fix those, so the name is settled by a
rule: **most recently used, then most sessions, then alphabetical**, with the names not
chosen kept in `also_known_as` so a search for the old name still finds the topic.
Last-used is chosen because it stays correct the next time the source renames something;
on all three collisions today it happens to agree with most-sessions.

### `users` and `login_sessions` — staff accounts and their logins

**The only two authored collections here.** Everything above is a pure function of
`dwp_reports` and can be dropped and rebuilt at will; these two cannot. There is no
builder, no migration path and no second copy — a `users` collection dropped by mistake
is accounts gone. Treat them the way you would not treat the rest of this database.

`users`: `username` (folded to lowercase, **unique**), `password_hash`, `display_name`,
`disabled`, `created_at`, `last_login_at`, `failed_attempts`, `locked_until`. Created by
`scripts/create_user.py`; there is no signup route.

`login_sessions`: `_id` (the **SHA-256 of the session token**, never the token),
`user_id`, `created_at`, `expires_at`. **Index**: `expires_at` with
`expireAfterSeconds: 0`.

Deliberately no `role` or permissions field. Nothing would read it until per-user
permissions exist — see the `P2` TODO — and a field with no consumer is a promise the
code does not keep.

---

## Rebuilding the aggregates

All four builders are pure functions of `dwp_reports` — nothing in `students`,
`instructors`, `attendance_reports` or `topics` is authored, so they can be rebuilt from
scratch at any time.

```bash
python ingestion/import_reports.py      # Excel -> dwp_reports
python ingestion/build_students.py      # dwp_reports -> students
python ingestion/build_instructors.py   # dwp_reports -> instructors
python ingestion/build_attendance.py    # dwp_reports -> attendance_reports
python ingestion/build_topics.py        # dwp_reports -> topics
```

The builders share code but not data. `build_topics.py` imports `build_topic_history` from
`build_students.py` so the two agree on what an assignment is, and `build_instructors.py`
imports `canonical_name` from `build_topics.py` so the two agree on what a topic is called.
None of them reads another aggregate's collection, so **the order of the four builds does
not matter** — but a source rename does mean rebuilding `topics` *and* `instructors`, since
both embed the topic name.

Each builder `drop()`s and recreates its target collection, and creates indexes **before**
inserting so a bad build fails ahead of the write.

### Migrations

One-time scripts, all dry-run by default and committed with `--apply`:

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

**`import_reports.py` writes on a natural key.** A dwp row is identified by
`(account_id, student_name, date, session_start)` — `NATURAL_KEY` — and `row_hash` answers
only *did this row change?*. A row whose hash matches what is stored is skipped; a row whose
hash differs **replaces its document in place, keeping its `_id`**. So re-importing an
unchanged file is a no-op, and re-importing a file in which a row was corrected at the
source updates that row instead of landing a second copy beside it.

Keeping the `_id` is the part the rest of the system depends on:
`students.dwp_report_ids[]` and `attendance_reports.dwp_report_ids[]` hold those ids, and
`/api/reports/<id>` is the only handle the frontend has on a report.

⚠️ **The natural key is not unique, and an ambiguous key is skipped rather than guessed at.**
Four student-days carry two rows each (see *Known Issues*). When a key matches more than one
stored document — or more than one row within a single file, disagreeing on content —
`_upsert()` writes none of them and names the key in its output:

```
    [ok] 0 new, 992 unchanged, 0 updated, 8 ambiguous -> dwp_reports
      ambiguous: Elizabeth Burch 2025-07-01 15:30 (2 stored documents share this key)
```

---

## Tests

```bash
pip install -r requirements-dev.txt
pytest                  # 670 offline tests -- no network, no credentials
pytest --integration    # + 99 read-only checks against the real cluster
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

### Frontend tests

```bash
cd frontend
npm test                # 364 tests, Vitest + Testing Library
npm run test:watch      # re-runs on change
npm run test:coverage
```

**The same instinct as `mongomock`: fake the boundary, not our own seams.** MSW
(`tests/support/server.ts`) intercepts `fetch`, so a test drives the real UI through the
real client — `client.ts`'s error mapping, `bson.ts`'s `$date` unwrapping, `useApi`, the
components and the router all actually execute. Nothing under `src/api` is stubbed, which
is the point: both bugs that reached the browser (dates a day early, emoji as `&#128218;`)
lived in exactly the seams a module-level mock would have skipped over.

`tests/support/handlers.ts` reimplements the routes' real rules — the paging envelope, the
two-character search floor that answers `400`, `404` on an unknown key — rather than
always returning `200`. A handler that cannot fail leaves the UI's error and empty paths
untested, and those are the ones worth having. `onUnhandledRequest: 'error'` makes an
uncovered call a loud failure, the same way `conftest.py` points `MONGODB_URI` at an
unroutable host.

`tests/support/sampleData.ts` is deliberately the same cast as `tests/sample_data.py` —
the Nguyen siblings, Chloe Tan, Dana Reyes — carrying the same two traps: a household
holding two students, and a co-taught session whose pages are credited to each instructor
in full. The difference is dialect: these are the JSON shapes the API returns, so dates are
`{"$date": ...}`.

⚠️ **`vitest.config.ts` pins `TZ` to `America/Chicago`.** The date helpers format in UTC
because the stored datetimes are naive wall clock. On a UTC machine — most CI — a local
reading and a UTC reading agree, so those regression tests would pass with the fix removed.
The suite also asserts the offset is non-zero, so it fails loudly rather than silently
proving nothing.

---

## API

| Method | Route | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → sets the session cookie. The only public write |
| POST | `/api/auth/logout` | revokes the session server-side and clears the cookie |
| GET | `/api/auth/me` | the logged-in user, or `401` — how a browser client knows to show the login page |
| GET | `/api/health` | liveness |
| GET | `/api/metrics` | collection counts and averages, plus `latest_session_date` — the newest session in the data, which the date filter's presets count back from |
| GET | `/api/centers` | the center names the list filters offer |
| GET | `/api/centers/metrics` | all-time totals across `?center=` (repeatable): sessions, students, instructors, pages, unfinalized, days, and the span. Counted from `dwp_reports`; an unknown center is zeroes, not a `400` |
| GET | `/api/students` | a page of students; `?query=` to search, `?account_id=` for one household's siblings, `?center=` (repeatable), `?sessions_min=`/`_max`, `?finished_min=`/`_max`, `?on_plan_min=`/`_max`, `?last_session_from=`/`_to`, `?sort=`+`?direction=` |
| GET | `/api/students/search?q=` | name search, minimum 2 characters |
| GET | `/api/students/<student_key>` | one student plus their sessions |
| GET | `/api/students/<student_key>/attendance` | sessions attended in a period; `?start=` and `?end=` required, `YYYY-MM-DD`, both inclusive |
| GET | `/api/instructors` | a page of instructors; `?query=`, `?center=` (repeatable), `?sessions_min=`/`_max`, `?unfinalized_min=`/`_max`, `?last_session_from=`/`_to`, `?sort=`+`?direction=` |
| GET | `/api/instructors/search?q=` | name search, minimum 2 characters |
| GET | `/api/instructors/<instructor_name>` | one instructor, with the roster and days taught |
| GET | `/api/topics` | a page of topics, most worked first; `?query=` to search name, former names or id, a `_min`/`_max` pair per count column, `?sort=`+`?direction=` |
| GET | `/api/topics/search?q=` | search, minimum 2 characters — matches `name`, `also_known_as` and `topic_id` |
| GET | `/api/topics/<topic_id>` | one topic, with its ranked instructors |
| GET | `/api/reports` | a page of session reports, newest first; `?query=` matches the student, `?center=` (repeatable), `?date_from=`/`_to`, `?sort=date\|student`+`?direction=`. Withholds `student_notes` |
| GET | `/api/reports/<report_id>` | one report, whole — **including `student_notes`**, which the list withholds. `_id` is the key; a malformed one is a `404`, not a `500` |

`/api/metrics` reports `total_attendance_records` and `avg_attendance_per_student` from
`attendance_reports`, so both count **days attended**, not sessions.

### List parameters

Three optional groups, each parsed by its own module and combinable with the others and
with paging: `routes/pagination.py` (`limit`, `offset`), `routes/sorting.py` (`sort`,
`direction`) and `routes/filtering.py` (the `_min`/`_max` and `_from`/`_to` pairs). Which
columns each list accepts is declared per model as `SORTABLE` and `FILTERABLE`, so the
allowlist and the field names live next to the documents they describe.

**Refused with a `400`:** an unknown `sort` column, a `direction` that is not `asc`/`desc`,
a bound that is not a number or a date, and a range that runs backwards. **Ignored:** a
blank value, and a `_min` on a column that is not filterable. The line between the two is
whether a correct answer exists — "no students at Xyz" is one, `sort=bogus` is not.

### Session authentication

Two credentials, tried in order: the session cookie, then `X-API-Key`. Sessions come
first so a browser carrying both is identified as the person rather than as the anonymous
shared key. Adding the cookie was an append to `AUTHENTICATORS` in `auth.py`, not a
change to any route.

**Sessions are server-side, and that is the point.** The cookie holds 32 random bytes;
`login_sessions` holds only their SHA-256, so a database dump yields nothing presentable
as a credential. Validation is a lookup, which means **logout actually revokes** — the
row is deleted and the cookie stops working everywhere, not just in the browser that
discarded it. The alternative, signing the user id into the cookie, needs no collection
and no lookup, but a stolen cookie then stays valid until it expires and the only way to
revoke anything is to rotate a secret and log everyone out.

There is **no signing secret** anywhere in this design. A random token validated by
lookup needs no key, so there is nothing to configure, leak or rotate.

The cookie is `HttpOnly` (no script can read it, including one injected into our own
page), `SameSite=Lax`, and `Secure` whenever `HOST` is not loopback. Sessions last 12
hours, absolute rather than sliding — a sliding window would write to the database on
every authenticated request.

Expiry is enforced **in the query**, not by the TTL index. MongoDB's TTL monitor sweeps
on roughly a one-minute cycle, so every session spends up to a minute expired and still
stored; a lookup trusting the index would authenticate for that minute. The index is a
janitor.

Disabling an account takes effect on the **next request**, because the user is loaded on
each one rather than copied into the session at login. `create_user.py --disable` also
deletes the live sessions outright.

Ten failed logins lock an account for fifteen minutes. The tradeoff is accepted rather
than overlooked: with a handful of staff accounts, someone who knows a username can lock
it for that window — cheaper than an unthrottled password endpoint. Guessing *during* a
lockout does not extend it, or the lock would last as long as the guessing.

Every login failure — wrong password, unknown username, disabled, locked — returns the
same `401 {"error": "Invalid username or password"}`. Distinguishing them would make this
a way to discover which usernames exist, and a username is half of a credential.

⚠️ **Spell the host the same way on both sides.** `localhost:5173` → `localhost:5000` is
cross-*origin* but same-*site* (a port is not part of a site), so a `SameSite=Lax` cookie
is sent. `localhost:5173` → `127.0.0.1:5000` is cross-*site*, and the browser drops the
cookie **with no error anywhere** — the login succeeds and every request after it is
anonymous. This is the most likely hour to lose when the frontend arrives.

CSRF has no target yet: every route but the three above is a read, and `SameSite=Lax`
blocks the cross-site POST that CSRF needs. The write endpoints will need a token; see
the TODO.

### Pagination

All five list routes take `?limit=` and `?offset=` and answer in one envelope:

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

## Center-wide metrics

`GET /api/centers/metrics` answers what a selection of centers comes to, and backs the
Metrics page. `?center=` is repeatable and the names are a union, as on every list route;
none given means every center.

**Computed per request, not built.** This resolves the former TODO decision. Measured against
the live cluster, the largest center over nine months aggregates in ~120ms and the whole
summary in ~400ms across its three queries — a fifth collection to rebuild and to go stale
would buy a tenth of a second. `models/center.py` holds it.

⚠️ **It reads `dwp_reports`, never the built aggregates, and that is the point.** Summing
`instructors.total_pages_completed` across a center gives 168,623 pages against the 153,360
actually recorded, because a co-taught session credits its pages to each instructor in
full. `students.total_*` is wrong a second way: all-time, so it cannot answer a period.
Sessions are the only place a figure is counted once.

Three notions of distinct, which is why the summary is three queries rather than one
`$facet`:

- **A student is a pair.** Grouped by `(account_id, student_name)` — an account is a
  household, and 191 carry two to five siblings.
- **An instructor is an array element.** `distinct('instructors', …)` flattens and dedupes,
  so one of the 11 who work at two centers counts once across a selection of both.
- **A day is a scalar**, and is not the session count: 29,382 sessions fall on 29,311
  student-days.

`$reduce`/`$setUnion` would fold these into one pipeline, and mongomock — which backs the
tests — does not implement them.

**`totals.last_session` is what the Sessions card opens on.** Against a live database that
card would open on today; the imported data ends 2025-09-17, so it opens on the newest
session date instead — 155 sessions across the four centers, 14 to 66 each. It is the
*selection's* newest session and not the dataset's, so a center that closes or lags an
import opens on its own last day rather than on an empty one. Widening it is one click and
Clear means Any time.

**What the page can and cannot narrow.** Every student figure is center-exact, since no
student in the data attends two. Instructors are not: `instructors.centers[]` records
`{name, sessions}`, so the Sessions column sums the selected centers exactly, but there is
no per-center page count, and Pages and Pages/session are therefore all-time across
everywhere that instructor works. The instructor card labels both columns and carries a
footnote whenever a multi-center instructor is on screen. See the TODO for the fix.

⚠️ **`center_orgs` is not a property of a center.** The four locations carry three
organisations between them — Mann Mathematics (26,617 sessions), Math Made Simple (1,290)
and @Home Classroom 1 (37) — and they cross-cut: every center has sessions under both of
the first two, because every location rebranded on 2025-09-05 (`parse_center` in
`ingestion/import_reports.py`). So an organisation is a property of a *session*, and
"the centers under my organisation" is not expressible against this data as it stands.
Scoping a manager to their own centers waits on that decision; it is on the TODO.

---

## Known Issues

- **The Topics card on a student profile collapses when its search matches nothing.**
  The card is built to hold one height whatever the filter — ten rows, padded out with
  blanks when the page is short, and a pager that keeps its controls' space. A search with
  no matches takes the other branch entirely: no table, no padding, no pager, just a line
  of text. Measured on a student with 47 topics, the card goes from **907px to 174px** and
  the attendance panel beside it in the same `CardRow` moves with it.

  The same branch also mislabels the reason. It reads *"No topics in this state"*, which
  named the chips back when they were the only filter; a search miss is not a statement
  about the state, and on `All` it contradicts the chip the reader just clicked.

  Fixing it means rendering the empty table — header, ten filler rows and the pager — and
  putting the message inside it, rather than swapping the table out for a paragraph. The
  padding machinery for that already exists in `TopicsCard.tsx`; what it does not have is
  a filler row that can carry a message.

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
- **Identity does not say what a user may read.** Accounts and revocable sessions exist
  now, so there is someone to name and something to revoke — but every logged-in account
  sees the whole directory. There are no roles, no per-center scoping and nothing
  restricting `student_notes`, which means the only access decision available today is
  whether someone has an account at all. Everything that scopes data waits on the `P2`
  permissions item.
- **The shared `API_KEY` is still anonymous.** It authenticates a *caller*, not a person,
  and rotating it affects every script at once. That is acceptable for server-side use
  and is why the browser path does not touch it, but a request authenticated by the key
  cannot be attributed to anyone in a log.
- **`app.run()` is a development server**, whatever `HOST` and `FLASK_DEBUG` are set to.
  Nothing enforces that `FLASK_DEBUG=1` and a non-loopback `HOST` are never combined —
  the defaults are safe and the danger is documented, but it is still two env vars away.
  A deployment needs a real WSGI server instead.
- **Four collisions on the natural key.** Four student-days have two rows sharing a
  `session_start` — Kimberly Thomas 2024-12-14, Michael Evans 2024-09-21, Laura Scott
  2025-06-18, Elizabeth Burch 2025-07-01. Three are an abandoned draft beside the real
  record; the fourth (2025-07-01) is two completed reports for one session by two
  instructors, differing in their notes, assessments, `session_page_goal` and topic
  statuses, which needs a human decision. Since the natural-key switch these are
  **reported and skipped** on every import rather than silently duplicated, so they are
  visible and inert rather than quietly wrong — but they are also the four rows an import
  can no longer update. Scoped to finalized rows only the 2025-07-01 pair remains, so a
  partial unique index is available once it is resolved.
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
  pending fix. The two sides of the instructor/topic relationship behave differently here:
  `topics.instructors[]` tops out at 82 and is bounded by staff headcount (103 people), so
  it cannot grow the way the others do, while `instructors.topics[]` runs to 504 and is
  bounded by the curriculum (771 topics) instead.
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
`P1` blocks it, `P2` comes straight after, and `P3` is later or still being considered.
Items remain in priority order within each group.

### Data integrity

- [x] `P2` Added completed topics and most-taught topics to the student and instructor
      aggregates, including per-status counts and instructor/topic reconciliation.
- [x] `P2` Added topic completion and page-pace statistics used by the topic detail page.
- [x] `P2` Switched report imports to the natural key with in-place replacement, retaining
      `_id` values; ambiguous keys are reported and skipped.
- [ ] `P3` **Split restricted fields out of `dwp_reports`** so access is decided by what a
      caller can reach, not by every reader remembering `PRIVATE_FIELDS`. Candidate axes:
      sensitivity and center; not yet decided.
- [ ] `P3` **Keep aggregates current once the API writes reports.** `students`,
      `instructors`, and `attendance_reports` are batch-built; update on write or show how
      stale they are. This is moot until something writes.
- [ ] `P3` **Add a partial unique index** on `(account_id, student_name, date, session_start)`
      where `finalized: true`, after resolving the duplicate natural key under Known Issues.
- [ ] `P3` **Add `pages_completed` to `instructors.centers[]`** in
      `ingestion/build_instructors.py`, so the Metrics page's instructor rows can narrow
      Pages and Pages/session to the selected centers instead of labelling them all-time.
      Affects the 11 instructors who work at more than one center; needs a rebuild.
- [ ] `P3` **Add a rename map for centers** so future rebrands merge into one identity without
      requiring a parser change and backfill.
- [ ] `P3` **Check anonymization mappings** for other placeholders created from blank fields;
      students and centers still need review.

### API

- [x] `P1` Exposed instructors, paginated all list routes, and added session authentication.
- [ ] `P2` **Add per-user permissions** on top of authentication: roles or capabilities and
      the data scopes each user may read.
- [ ] `P2` **Add viewing permissions in the models**: a `role`/`permissions` field on
      `users` and one scoping layer through which model queries are made.
- [ ] `P2` **Add report write endpoints** for create, update, and finalize, with validation.
      Decide whether drafts remain in `dwp_reports` as `finalized: false` or use a separate
      collection. The Metrics page's report modal is the second caller waiting on these.
- [x] `P2` Added center-wide metrics for sessions, students, pages, and instructors,
      computed per request from `dwp_reports` rather than from a built `centers`
      collection; co-taught pages are counted once.
- [ ] `P2` **Expose center distributions for the list-page charts.** The API must return
      student and instructor counts grouped by center, using the same center names and
      filtering rules as the list routes. Decide whether this extends `/api/centers/metrics`
      or uses a dedicated endpoint; multi-center people may appear in more than one center,
      so the counting rule must be explicit.
- [ ] `P2` **Expose report session distributions by date range.** Add an aggregation for the
      reports chart that accepts the existing inclusive date bounds and returns ordered daily,
      weekly, or monthly buckets. The default range must be the latest 30 days represented in
      the data, not the wall-clock month, using the same latest-session anchor as `/api/metrics`.
- [ ] `P2` **Expose monthly home activity trends.** Return sessions, distinct students,
      pages completed, and finalized/unfinalized reports by month. The initial default is one
      month-sized view; support extending it to three months without changing the response
      contract. Distinct students must use `(account_id, student_name)`, not `account_id` alone.
- [ ] `P2` **Expose instructor workload trends.** Return time-bucketed sessions, distinct
      students, and pages for the instructor chart, with optional instructor and center
      filters. Pages must be labelled carefully because co-taught sessions credit full pages
      to every instructor.
- [ ] `P2` **Define data-quality monitoring aggregates.** Identify and count missing topics,
      page counts, dates, session times, unfinalized reports, ambiguous natural keys, and
      other actionable import anomalies. Decide which findings need persisted import history
      because the current ambiguous-key output is console-only.
- [ ] `P3` **Expose topic progression events.** Provide the session/date/status observations
      needed for an all-topics student timeline, while distinguishing observed transitions
      from inferred continuous progress. The initial all-topic view may need pagination or a
      selected date range if the response becomes too large.
- [ ] `P2` **Decide how an organisation scopes access.** A manager should see only the
      centers under their organisation, but `center_orgs` cross-cuts centers and changes
      over time — every location rebranded on 2025-09-05 — so an organisation is currently
      a property of a session, not of a center. Needs a decision before the permissions
      work above can express "my centers".
- [x] `P2` Added topic statistics, list filtering/sorting, the reports list route, and the
      related API contracts.
- [ ] `P3` **Add instructor and `finalized` filters to the reports list.** The finalized
      filter also provides the outstanding-report follow-up view.
- [x] `P2` Decided that `student_notes` are restricted and excluded from the reports list.
- [ ] `P3` **Build the prompt-driven agent for niche statistics.** It must read only a
      pre-projected, permission-scoped surface and account for domain traps such as a day not
      being a session and `account_id` representing a household.

### Deployment

- [ ] `P2` **Serve `create_app()` from a real WSGI server** (`waitress`/`gunicorn`) and
      document the production command; keep `python app.py` for development only.
- [ ] `P3` **Add a startup interlock** refusing `FLASK_DEBUG=1` with a non-loopback `HOST`.

### Development

- [ ] `P2` **Create a development database for form writes**, so drafts can be saved, reopened,
      and finalized without touching the real collection. Add seed data and document how to
      select it; decide between an anonymized slice and hand-written fixtures.

### Frontend

**Requires Node 20+** (`^20.19 || >=22.12`, Vite's floor).

- [x] `P1` Built the app shell, data path, student search/list/profile, and session panel.
- [ ] `P3` **Page the detail route's `dwp_reports`** instead of returning every session in one
      response if a student's history becomes large.
- [x] `P2` Built instructor search/list/profile, topic list/detail, center filters, and the
      report browser/detail pages.
- [ ] `P2` **Add a toggleable center-distribution bar chart above the student and instructor
      lists.** The button should open and close the chart without replacing the paged table,
      reuse the active center/search/filter state, label counts clearly, and provide an
      accessible table or equivalent text summary. Depends on the grouped distribution API
      data and a decision on how people associated with multiple centers are counted.
- [ ] `P2` **Add a toggleable report-volume bar chart above the reports list.** It should be
      open by default, show sessions grouped over the selected date range, and update when the
      existing date filters change. Default to the latest 30 days of imported sessions rather
      than today's calendar month; preserve the table's paging and keep the bucket interval
      readable as the range expands. Depends on a date-bucket aggregation endpoint.
- [ ] `P2` **Add Home activity trend charts.** Start with monthly sessions, distinct students,
      pages, and finalized/unfinalized reports; allow the initial range to expand from one to
      three months. Include loading, empty, error, tooltip, and accessible table states.
- [ ] `P2` **Add center comparison charts.** Show student and instructor distributions by
      center above the relevant list pages, with each person counted once for every center
      they appear in. Keep the chart toggleable and preserve the paged list; label the result
      as center appearances rather than program-wide unique people.
- [ ] `P2` **Add a student attendance heatmap.** Use a GitHub-contribution-style calendar where
      cell intensity represents sessions per day over a selectable period. Use
      `attendance_reports` for the day axis, preserve the distinction between days and sessions,
      and provide exact session counts in tooltips and an accessible table summary.
- [ ] `P2` **Add instructor workload charts.** Provide a toggle between sessions, distinct
      students, and pages, with an eventual option to compare all three trends. Support time
      ranges and center/instructor filters; clearly label page totals where co-teaching causes
      full-credit duplication.
- [ ] `P3` **Add data-quality monitoring.** Provide warning cards and a drill-down table for
      missing or anomalous report data, unfinalized reports, and ambiguous imports. It should
      link to affected reports where possible and distinguish current-state checks from a
      historical import audit.
- [ ] `P3` **Add an all-topics student progression timeline.** Start with every topic and its
      observed status/date events, but keep the presentation replaceable with a selected-topic
      or filtered view if the all-topic timeline becomes unreadable or too large. Do not imply
      progress between sessions that the source data does not record.
- [ ] `P3` **Reassess the topics list's columns and layout.** Keep topic IDs visible because
      names are not unique; either reserve space for the topic column or remove a derived
      count column.
- [ ] `P2` **Build the report entry page** with drafts, reopen, and finalize flows. It depends
      on the report write endpoints and development database.
- [x] `P2` Built the center metrics page: a multi-select center bar, stat tiles from the
      center-wide metrics API, a sessions card with its own date range, and student and
      instructor cards. Sessions open in a modal — the app's first — which renders the same
      `ReportDetailBody` as `/reports/:id`.
- [ ] `P2` **Edit a report from the metrics modal.** Read-only today; depends on the report
      write endpoints and the development database.
- [ ] `P3` **Add pinned stats to the Home page.** Decide which stats qualify and whether each
      user's layout belongs in `users` or browser storage.
- [ ] `P3` **Add a separate spreadsheet upload page** for incoming `.xlsx` reports; the
      command-line import already works.

### Visualization implementation order

1. Center comparison charts, using the existing center metrics foundation.
2. Report-volume chart and the supporting date-bucket aggregation.
3. Unfinalized-report follow-up and data-quality monitoring foundations.
4. Student attendance heatmap using sessions per day.
5. Instructor workload charts with metric toggles.
6. Home activity trends, initially monthly with a possible three-month range.
7. Student topic progression timeline, initially showing all topics.

### Completed milestones

The API, aggregate builders, frontend profiles, topics, reports, filtering, pagination,
authentication, natural-key imports, and associated test coverage are implemented. Detailed
contracts and design rationale remain in the sections above.

### Retained design notes

- List pagination must always append a deterministic unique-key tiebreaker; a partial order
  can repeat or drop rows between pages.
- Topic names are not unique, so topic IDs must remain visible and searchable.
- Session timestamps are naive local wall-clock values currently stored as UTC. Do not convert
  them to another local zone until centers can supply timezone data and existing rows are
  backfilled.
