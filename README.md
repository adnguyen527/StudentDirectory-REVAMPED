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
cp .env.example .env      # then set MONGODB_URI
pip install -r requirements.txt
python app.py
```

Starts Flask on `http://0.0.0.0:5000` in debug mode. `.env` is gitignored — never commit it.

`MONGODB_URI` is a full Atlas SRV string. The host has **four** labels
(`<cluster>.<hash>.mongodb.net`) — dropping the cluster label leaves a hostname with no
SRV record, and `pymongo` fails at `MongoClient()` with `ConfigurationError: The DNS query
name does not exist` before any auth is attempted.

To work on the code, install the dev dependencies as well and run the tests:

```bash
pip install -r requirements-dev.txt
pytest
```

---

## Student identity: `account_id` is a household, not a student

This is the single most important thing to know about the schema.

`account_id` (and `lead_id`, which is 1:1 with it) identifies a **billing household**.
191 accounts carry 2–5 siblings — 664 accounts hold 893 students. Grouping by
`account_id` alone silently merges siblings into one profile named after whichever
session row was read first.

Student identity is therefore **`student_key`**, defined once in `util.py`:

```python
student_key = f"{account_id}_{slug(student_name)}"
# 75619a85-d16e-4f94-bd1e-4b88cbe249d0_anthony-williams
```

`account_id`s are UUIDs (hyphens, never underscores) and `slug()` never emits an
underscore, so `split_student_key()` recovers the pair exactly.

**Consequences for any new code:**

- Group aggregates by `(account_id, student_name)`, never `account_id` alone.
- Never put a unique index on `account_id` in `students`.
- Filtering sessions for one student needs **both** fields — `account_id` alone returns
  the whole household.

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
fields — `date` (midnight on the session day), `session_start`, `session_end`, and
`finalized_date` (when the report was closed out).

`instructors[]` is empty on 73 rows whose instructor was blank in the source — the session
happened and counts for the student, but it is attributed to nobody. `build_instructors.py`
skips those rows.

Work: `finalized`, `pages_completed`, `session_page_goal`, `mathlete_score`, `topics[]` (each
`{id, name, status}` where status is `Worked On` / `Mastered` / `Completed`),
`schoolwork_*`, `card_level`, `stars_current`, `stars_max`, `session_stars_added`.

Notes: `session_summary_notes`, `student_notes`, `internal_notes`,
`notes_from_center_director`, `assessment`.

**Indexes**: `date`, `account_id`, `row_hash` (**unique** — this is what enforces import
idempotency), `finalized`.

**Sparse fields** — present on every document but rarely populated:
`internet_rating` and `secondary_deck_next_page` are null in 100% of records;
`primary_deck_next_page` and `schoolwork_start_time` in ~99%; `card_level`/`stars_max`
in 91%; `assessment` in 97%.

### `students` — 893 documents

Aggregated per-student profiles built from `dwp_reports`. Each document is a full
dashboard view. Rebuilt by `ingestion/build_students.py`.

`student_key`, `account_id`, `student_name`, `total_sessions`, `total_pages_completed`,
`last_session_date`, `last_assessment`, `centers[]`, `instructors[]`, `topics_mastered[]`,
`total_unique_topics_mastered`, `dwp_report_ids[]`, `last_modified`.

**Indexes**: `student_key` (unique), `account_id` (**not** unique — siblings share one),
`student_name`.

Totals reconcile exactly to `dwp_reports`: 29,382 sessions, 153,360 pages.

### `instructors` — 103 documents

Aggregated instructor profiles built from `dwp_reports`. Rebuilt by
`ingestion/build_instructors.py`.

`instructor_name`, `total_sessions_taught`, `co_taught_sessions`, `unfinalized_sessions`,
`total_pages_completed`, `total_days_taught`, `days_taught[]`, `last_session_date`,
`unique_students`, `students[]` (roster keyed by `student_key`), `centers[]`,
`last_modified`.

**Index**: `instructor_name` (unique).

**Co-taught sessions credit each instructor the full page count** — pages are copied, not
split. 2,563 of 29,382 sessions have more than one instructor, so summing
`total_pages_completed` across instructors comes to 168,623 against the 153,360 pages
actually recorded. That overshoot is intended: these are per-instructor figures answering
"how much work happened in sessions I ran". **Do not sum them for a center-wide total** —
aggregate `dwp_reports` directly for that.

Instructors are identified by name alone, because that is all the source data carries.
Two distinct people sharing a name would merge into one document.

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

**@Home sessions are attendance.** 723 of 29,382 rows are `@Home` rather than `In-Center`,
and they are kept and tagged rather than filtered out — an in-center-only view is
`find({'delivery_methods': 'In-Center'})`. The reverse is not recoverable from a
collection that dropped them at build time.

`minutes_present` sums each session's own duration rather than spanning first start to
last end, so a student who came in twice with a gap between visits is not credited with
the gap. It is `null` — not `0` — on a day whose times could not be trusted, since `0`
would read as "attended, stayed no time". `sessions_timed` says how many of the day's
sessions were actually measured. 224 sessions go unmeasured: 217 have no `session_end` at
all, 5 pairs end before they start, and 2 run past the 12-hour plausibility cap.


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
inserting so a bad build fails ahead of the write. Each exposes a `TARGET_COLLECTION`
constant — point it at a scratch name (`students_v2`), verify, then swap and re-run.

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

`backfill_session_times.py` cleans up rows imported before `parse_session` ran
`session_start` / `session_end` through `_none()`, which stored the literal string
`'None'` in 217 documents. It rewrites `row_hash` alongside the value — the hash covers
the whole document, so correcting a field without rehashing would leave a document its
stored hash no longer describes, and the next import of that row would insert a duplicate
beside it. Two rows that differ only in this field become identical once corrected, so the
script proves every corrected hash is distinct before writing and aborts untouched if not.

**`import_reports.py` is idempotent for unchanged files.** Every row carries a `row_hash`
content fingerprint, `_upsert()` skips hashes already stored, and a unique index on
`row_hash` enforces it at the database. Re-importing a file that is already loaded reports
its rows as already present rather than duplicating them.

The lookup is batched, not per row: hashes go out in `$in` chunks of 1,000, so a full
29,382-row import costs 30 queries and a daily file costs one.

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

⚠️ **The instructor checks assume one name is one person.** A DWP row carries an
instructor's name and no uid, so `instructors` is keyed on `instructor_name` and every
instructor assertion inherits that. Two people who share a name are already merged into a
single, internally consistent document by the time the tests run —
`test_instructor_names_are_unique` catches a broken build, not a collision, and no
assertion here can see one. Separating them requires a uid in the source data, not a
stricter test. Students are not exposed this way: `make_student_key` scopes the name to an
account, so a collision needs two same-named students in the *same household*.

---

## API

| Method | Route | Notes |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/metrics` | collection counts and averages |
| GET | `/api/students` | all students; `?query=` to search, `?account_id=` for one household's siblings |
| GET | `/api/students/search?q=` | name search, minimum 2 characters |
| GET | `/api/students/<student_key>` | one student plus their sessions |

List responses project out `dwp_report_ids`. `/api/students/<student_key>` scopes its
`dwp_reports` to that student, not the household.

`/api/metrics` reports `total_attendance_records` and `avg_attendance_per_student` from
`attendance_reports`, so both count **days attended**, not sessions. They read `0` until
`ingestion/build_attendance.py` has been run against the cluster.

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
- **`CORS(origins="*")` on all `/api/*` routes**, which serve student names and session
  notes. Any origin a browser visits can read them.
- **`app.run(debug=True, host='0.0.0.0')`** is hardcoded — the debugger console, bound to
  every interface.
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

