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
pytest                  # 470 offline tests -- no network, no credentials (~3s)
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
| POST | `/api/auth/login` | `{username, password}` → sets the session cookie. The only public write |
| POST | `/api/auth/logout` | revokes the session server-side and clears the cookie |
| GET | `/api/auth/me` | the logged-in user, or `401` — how a browser client knows to show the login page |
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
- [x] `P1` **Session authentication** for the React client. Done: staff accounts in
      `users`, server-side revocable sessions in `login_sessions`, three `/api/auth/*`
      routes, and `scripts/create_user.py` to bootstrap. Appended to `AUTHENTICATORS`
      without touching a route. No signing secret was needed after all — a random token
      validated by lookup does not have one. See the API section.
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

- [ ] `P1` **Search for students and instructors.** The entry point everything else is
      reached from. Both searches now exist — `/api/students/search?q=` and
      `/api/instructors/search?q=`, minimum 2 characters, and both page — a dropdown wants
      the first `?limit=10` and the `total` to say how many more. *Open:* a page of its own, or
      the persistent top-bar search the layout reference uses — the reference implies
      results appear as a dropdown, with a full page only for "see all".
- [ ] `P1` **Student profile page** — profile, centers, instructors, topics mastered and
      completed, session history. `/api/students/<key>` already returns all of it, so this
      is frontend-only.
- [ ] `P1` **Session count panel on the student record** — sessions attended over a
      selectable period, with the dates, so a manager can tell a parent what their prepaid
      package has used. Backed by `GET /api/students/<key>/attendance?start=&end=`, which
      already exists.
- [ ] `P2` **Instructor profile page** — sessions taught, unique students, roster, centers,
      most-taught topics, `unfinalized_sessions` as a follow-up list.
      `/api/instructors/<name>` now serves everything except the topics.
- [ ] `P2` **Report entry page** — fields filled in on the page, saved unfinished,
      finalized into `dwp_reports` as a normal document. Needs a list of what is still
      open. *Blocked on the write endpoints.*
- [ ] `P3` **Home dashboard the user assembles.** A pin button on any stat in the app puts
      that module in the top row of the home page — the row the reference layout fills with
      fixed KPI tiles. Every stat has to render standalone at tile size, and the layout is
      per person. Not every stat will be pinnable; which ones qualify gets decided as the
      elements are built. *Open:* now that accounts exist, whether the layout is stored on
      the `users` document — following the person across browsers — or left in browser
      storage, which needs no endpoint and no schema.
- [ ] `P3` **Spreadsheet upload page**, separately, for reports that arrive as `.xlsx`.
      The command-line import already works.
