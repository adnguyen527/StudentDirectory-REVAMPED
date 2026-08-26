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
- **Frontend**: React *(in progress)*

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
`last_session_date`, `last_assessment`, `centers[]`, `instructors[]`, `topics_mastered[]`,
`total_unique_topics_mastered`, `dwp_report_ids[]`, `last_modified`.

**Indexes**: `student_key` (unique), `account_id` (**not** unique — represents household),
`student_name`.

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
pytest                  # 82 offline tests -- no network, no credentials (~0.5s)
pytest --integration    # + 19 read-only checks against the real cluster
```

**Offline.** Runs against `mongomock`. `tests/conftest.py` reads the real `MONGODB_URI`,
then overwrites the environment variable with an unroutable sentinel, so a test that ever
escapes the mock fails to resolve rather than reaching Atlas. Nothing in this layer writes
anywhere. `Database`'s class-level client cache is reset around every test.

The fixture directory in `tests/sample_data.py` is three students, two of them siblings on
one account, because that is where this schema breaks. Most assertions turn on that pair —
a household with 3 sessions in which one student owns 2.

**`--integration`.** Read-only checks (`tests/test_live_database.py`) that catch a bad
ingestion run before the API serves it:

- `student_key` unique across `students`, and still re-derivable from that document's own
  `account_id` + `student_name`
- no `dwp_report_ids` pointing at a missing session, and no session without a profile —
  the latter means `import_reports.py` ran and `build_students.py` did not
- `total_sessions`, `unique_students` and `total_days_taught` matching the arrays
  they claim to count
- instructor page total overshooting the recorded total by no more than co-taught sessions
  can explain
- `attendance_reports` reconciling to `dwp_reports` exactly — one document per student-day,
  sessions and pages summing to the rows they were built from, and `minutes_present` null
  exactly when nothing on that day was measurable

These skip with a clear message when `MONGODB_URI` is unset or still holds the
`.env.example` placeholders, so they are safe to leave in a CI run that has no credentials.

---

## API

| Method | Route | Notes |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/metrics` | collection counts and averages |
| GET | `/api/students` | all students; `?query=` to search, `?account_id=` for one household's siblings |
| GET | `/api/students/search?q=` | name search, minimum 2 characters |
| GET | `/api/students/<student_key>` | one student plus their sessions |

`/api/metrics` reports `total_attendance_records` and `avg_attendance_per_student` from
`attendance_reports`, so both count **days attended**, not sessions.

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
- **No pagination on `/api/students`.** The full list is 1.72 MB across 893 students, and
  every call ships all of it.
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
- **Unbounded arrays.** `dwp_report_ids` runs to 192 entries per student, `days_taught` to
  272 per instructor, and instructor rosters to 304. All grow with the dataset, and all
  are far from MongoDB's 16 MB document limit — accepted, not a pending fix.

---

## TODO

### Data integrity

- [ ] **Add the partial unique index** on `(account_id, student_name, date, session_start)`
      where `finalized: true`, once the above is resolved. Finalized-only leaves exactly
      one collision today, so this is a one-line change behind a one-row decision.
- [ ] **Switch `_upsert()` to the natural key.** Then an edited source row updates its
      document instead of landing beside it. Query count is unchanged — batched lookups
      by key instead of by hash, with the hash demoted to change detection.
- [ ] **Check the anonymization mapping for other placeholders.** One instructor name was
      a stand-in for an empty field, and it went unnoticed for 73 rows because it looked
      like a person. If other names, students, or centers were mapped from blanks, they
      have the same problem. Add them to `PLACEHOLDER_INSTRUCTORS` or its equivalent.

### API

- [ ] **Session authentication** for the React client. Append an authenticator to
      `AUTHENTICATORS` in `auth.py`; also needs `supports_credentials` on the CORS config
      and a signing secret. `ALLOWED_ORIGINS` is already restricted, which cookie auth
      requires.
- [ ] **Decide who sees `student_notes`.** Personal interests collected for rapport, on
      3,594 rows. Fine for an instructor view, questionable in anything parent-facing.
      `internal_notes` and both spellings of the director note are already withheld.

### Deployment

- [ ] **Serve `create_app()` from a real WSGI server** (`waitress` on Windows, `gunicorn`
      elsewhere) and document the production command, so `python app.py` is unambiguously
      the dev-only path.
- [ ] **Consider a startup interlock** refusing `FLASK_DEBUG=1` together with a
      non-loopback `HOST`, so the dangerous combination takes a code change rather than
      an env var.

### Frontend

- [ ] **React dashboard.** Blocked on session authentication above, not on the API
      surface.

