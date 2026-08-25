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

Identity and timing: `account_id`, `lead_id`, `student_name`, `date` (native `Date`),
`finalized_date`, `session_start`, `session_end`, `sessions_this_month`,
`delivery_method`, `centers[]`, `instructors[]`.

Work: `pages_completed`, `session_page_goal`, `mathlete_score`, `topics[]` (each
`{id, name, status}` where status is `Worked On` / `Mastered` / `Completed`),
`schoolwork_*`, `card_level`, `stars_current`, `stars_max`, `session_stars_added`.

Notes: `session_summary_notes`, `student_notes`, `internal_notes`,
`notes_from_center_director`, `assessment`.

**Indexes**: `date`, `account_id`.

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

### `instructors` — 104 documents

Aggregated instructor profiles built from `dwp_reports`. Rebuilt by
`ingestion/build_instructors.py`.

`instructor_name`, `total_sessions_taught`, `co_taught_sessions`, `total_pages_completed`,
`total_days_taught`, `days_taught[]`, `last_session_date`, `total_students_taught`,
`students[]` (roster keyed by `student_key`), `centers[]`, `last_modified`.

**Index**: `instructor_name` (unique).

**Co-taught sessions credit each instructor the full page count** — pages are copied, not
split. 2,563 of 29,382 sessions have more than one instructor, so summing
`total_pages_completed` across instructors comes to 168,720 against the 153,360 pages
actually recorded. That overshoot is intended: these are per-instructor figures answering
"how much work happened in sessions I ran". **Do not sum them for a center-wide total** —
aggregate `dwp_reports` directly for that.

Instructors are identified by name alone, because that is all the source data carries.
Two distinct people sharing a name would merge into one document.

---

## Rebuilding the aggregates

Both builders are pure functions of `dwp_reports` — nothing in `students` or
`instructors` is authored, so they can be rebuilt from scratch at any time.

```bash
python ingestion/import_reports.py      # Excel -> dwp_reports
python ingestion/build_students.py      # dwp_reports -> students
python ingestion/build_instructors.py   # dwp_reports -> instructors
```

Each builder `drop()`s and recreates its target collection, and creates indexes **before**
inserting so a bad build fails ahead of the write. Both expose a `TARGET_COLLECTION`
constant — point it at a scratch name (`students_v2`), verify, then swap and re-run.

⚠️ **`import_reports.py` is not idempotent.** It does a plain `insert_many` with no unique
index on `dwp_reports`, so re-importing the same spreadsheet silently duplicates every row,
and both aggregate collections inherit the inflation.

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
- `total_sessions`, `total_students_taught` and `total_days_taught` matching the arrays
  they claim to count
- instructor page total overshooting the recorded total by no more than co-taught sessions
  can explain

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

`/api/metrics` still reports `total_attendance_records` and `avg_attendance_per_student`.
There is no `attendance_reports` collection on the cluster, so both are always `0` — they
are not measurements.

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

- `import_reports.py` is not idempotent — see above.
- No pagination on `/api/students`; the full list is ~1.8 MB.
- `CORS(origins="*")` on all `/api/*` routes, which serve student names and session notes.
- `app.run(debug=True, host='0.0.0.0')`.
- `database.py` prints `✓`/`✗`, which raises `UnicodeEncodeError` on a default Windows
  console (cp1252) and surfaces as a false "Could not connect" *after* the connection
  has already succeeded. The client and database are now cached before that print runs,
  so the app keeps working — the warning is cosmetic, but it is still a lie.
- `dwp_report_ids` (up to 582 entries) and `days_taught` (up to 209) are unbounded arrays
  that grow with the dataset.
- Center names are unnormalized: 13 values covering 4 locations, with 1,438 records
  carrying a bare location and no brand suffix.
- `finalized_date`, `session_start`, and `session_end` are stored as strings, so duration
  and time-of-day analysis requires reparsing at query time.
