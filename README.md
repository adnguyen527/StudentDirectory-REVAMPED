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
pytest                  # 549 offline tests -- no network, no credentials (~3s)
pytest --integration    # + 93 read-only checks against the real cluster
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
npm test                # 205 tests, Vitest + Testing Library (~13s)
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
| GET | `/api/metrics` | collection counts and averages |
| GET | `/api/centers` | the center names the two list filters offer |
| GET | `/api/students` | a page of students; `?query=` to search, `?account_id=` for one household's siblings, `?center=` (repeatable) to filter |
| GET | `/api/students/search?q=` | name search, minimum 2 characters |
| GET | `/api/students/<student_key>` | one student plus their sessions |
| GET | `/api/students/<student_key>/attendance` | sessions attended in a period; `?start=` and `?end=` required, `YYYY-MM-DD`, both inclusive |
| GET | `/api/instructors` | a page of instructors; `?query=` to search by name, `?center=` (repeatable) to filter |
| GET | `/api/instructors/search?q=` | name search, minimum 2 characters |
| GET | `/api/instructors/<instructor_name>` | one instructor, with the roster and days taught |
| GET | `/api/topics` | a page of topics, most worked first; `?query=` to search name, former names or id |
| GET | `/api/topics/search?q=` | search, minimum 2 characters — matches `name`, `also_known_as` and `topic_id` |
| GET | `/api/topics/<topic_id>` | one topic, with its ranked instructors |

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
`P1` blocks it, `P2` comes straight after, `P3` is later or still being thought through.
Items are listed in priority order within each group.

### Data integrity

- [x] `P2` **Add completed topics to `students`.** Done, as part of `topics[]` — one entry
      per topic with per-status counts, reassignments and current standing. Rebuilt:
      13,598 topic entries, 187 students with a reassigned topic.
- [x] `P2` **Add most-taught topics to `instructors`.** Done, as `topics[]` — ranked
      `{topic_id, name, sessions}` per instructor. The mirror
      of `topics.instructors[]`: the same 16,932 pairs from the other side, same co-taught
      full-credit rule, named by the same `canonical_name`, and reconciled pair for pair in
      the integration tests. 103 instructors, a median of 126 distinct topics each.
- [ ] `P2` **Three fields the topic detail page needs**, none of which are in `topics`
      today. Two are cheap: `mean_sessions_to_finish` and `median_days_to_finish` — the
      `roll_up()` loop in `ingestion/build_topics.py` already holds each student's
      `sessions`, `first_seen`, `last_seen` and `last_assignment_started`, so both fall out
      of what it is already iterating.

      The third is the page figure, and it is the one that adds real work: it needs a
      second pass over `dwp_reports` to build each student's baseline pages-per-session
      before any topic can be compared against it. **It reads the session's total
      `pages_completed`, compared to the student's own baseline — not the topic's share of
      the pages.** Nobody should later "simplify" it into an attribution; a session carries
      2.17 topics on average, so a per-topic share does not exist to be computed. See the
      detail-page item under **Frontend** for the ~1.12 neutral point and the co-occurrence
      caveat.
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
      may read; everything that scopes data depends on this. *Open:* roles (`admin`,
      `manager`, `instructor`) or per-capability flags.
- [ ] `P2` **Viewing permissions in the models.** The mechanism the item above needs: a
      `role`/`permissions` field on `users` — deliberately left out until something read
      it, and the admin-only user page below is now that consumer — plus a scoping layer
      every model query goes through, so access is decided in one place rather than by
      each route remembering. Candidate scopes: center, own students, `student_notes`.
      The `P3` restricted-fields split and the prompt-driven agent both wait on this.
- [ ] `P2` **Write endpoints for the report form** — create, update, finalize, plus the
      validation the importer never needed. Needs the natural-key switch above.
      *Open:* whether drafts live in `dwp_reports` as `finalized: false` or their own
      collection.
- [ ] `P2` **Center-wide metrics.** Sessions, students, pages and instructors per location
      — the four centers have no rollup and no route. Has to aggregate `dwp_reports`
      directly: instructor totals double-count co-taught pages, so they cannot be summed
      into a center figure. *Open:* a built `centers` collection like the other aggregates,
      or computed per request, which is what would make a date range possible.
- [x] `P2` **Per-topic stats endpoint**, backing the Topics tab under **Frontend**. Done —
      `models/topic.py` and `routes/topics.py`: the paged list, `/api/topics/search?q=`
      with the same two-character floor as the students route, and `/api/topics/<topic_id>`
      for the detail page. Search covers `name`, `also_known_as` and `topic_id`, so
      `?q=Reducing` finds `PK-3121-00` even though it is now called *Simplifying Fractions
      using GCF*, and `?q=pk-3121` finds it by the handle staff actually use. The id arm
      matters because the list shows ids to tell same-named topics apart — a list that
      displays them but cannot search them would be incoherent.
      `instructors[]` is excluded from the list projection — 16,932 roster entries would
      otherwise ride along on every page — and the list comes to 27 KB. The list sorts on `(sessions, topic_id)` over a compound
      index — most worked first, with the id breaking the constant session ties.
      The three detail-page stats are still open, under **Data integrity**.
      Both open questions are settled. **Built, not computed per request**, matching the
      other aggregates; the date range that computing would have allowed is deferred until
      something asks for it. **The canonical name is a rule, not a map** — most recently
      used, then most sessions, then alphabetical, alternates kept in `also_known_as`.
      Worth correcting the old note here: only `PK-3121-00` is a rename. `PK-3099-00` and
      `PK-3081-00` run both names concurrently for the topic's whole life, so the centers
      rename map would not have fixed them. See the `topics` section above.
- [ ] `P2` **Filter and sort parameters on the two list routes**, backing the column
      controls under **Frontend**. `/api/students` and `/api/instructors` accept only
      `query` (plus `account_id` on students). They need one filter per column — `center`,
      numeric ranges, a last-session date range — plus `sort` and `direction`, each optional
      and combinable with the existing paging. **`center` is multi-valued**: the checkbox
      control under **Frontend** ticks several at once, so it repeats as `?center=` and
      matches `centers.name` `$in` the list, and on instructors the result is a union rather
      than a partition. `sort` is validated against an allowlist of
      sortable fields and an unrecognised value is a `400`, not a silent fallback to name
      order, in the same spirit as `pagination.parse` refusing a bad `limit`.

      ⚠️ **Every sort must append the collection's unique key, or paging breaks.** This is
      correctness, not tuning. `total_topics_on_plan` has **8 distinct values across 893
      students, 280 of them sharing one**; `last_session_date` ties 155 rows and
      `total_unique_topics_finished` 141. A page boundary landing inside a tie makes
      `skip`/`limit` repeat and drop rows — the exact bug **Pagination** already claims is
      fixed, so reintroducing it would make the docs wrong as well as the pages. `LIST_SORT`
      in `models/student.py` and `models/instructor.py` already does this for names
      (`student_name` then `student_key`); it becomes a function of the requested column
      rather than a constant.

      Indexes are the separate, smaller problem: one compound `(sort_field, unique_key)` per
      sortable column, and `(centers.name, …)` for the center filter — neither collection
      indexes `centers.name` today. Indexing every *filter × sort* combination is neither
      practical nor needed at 893 and 103 documents, where an unindexed sort is merely
      slower. An untied one is wrong.
- [ ] `P2` **A list route for `dwp_reports`**, backing the report browser under
      **Frontend**. The collection has no route of its own — it is reachable only through
      `/api/students/<key>`, one student at a time. `/api/reports` in the shared paged
      envelope, filtered by date range, center, instructor, student and `finalized`.
      `models/dwp_report.py`'s `PRIVATE_FIELDS` already withholds the set that never leaves
      the server, so the projection is in place.

      ⚠️ **Date alone is not a stable sort here**, and newest-first is the obvious default.
      The 29,382 reports fall on 309 days — a **median of 85 a day and 192 on the busiest**
      — so nearly every page boundary lands inside a single day's tie, and `skip`/`limit`
      over it repeats and drops rows. Sort `(date, _id)`; `_id` is the only field on this
      collection guaranteed unique. Same requirement as the list-route sorting above, just
      unavoidable rather than opt-in.

      Indexes: `date` and `finalized` already exist, `account_id` covers the student filter.
      A compound `(date, _id)` matches the default order, and an `instructors` index is
      what the instructor filter would want — without it that filter scans all 29,382,
      which is survivable but is the one filter that does not ride an existing index.
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

**Requires Node 20+** (`^20.19 || >=22.12`, Vite's floor). Installed: `node v22.23.2`,
`npm 10.9.8`.

| Tool | Version |
|---|---|
| Vite | 8.x |
| Tailwind | 4.x |
| React Router | 8.x |
| TanStack Query | 5.x |

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
      rows expand to the notes and that session's topics. The instructors card pages the
      same way at 10, matching the instructor roster and the topic page's instructor
      ranking — every one of those lists arrives whole in its detail response, so paging
      costs no request.
- [x] `P1` **Session count panel on the student record.** Date range in the card's header
      controls, showing sessions against days and a per-month breakdown. Defaults to the
      three months ending at that student's **last session, not today** — the route refuses
      to guess a period for the same reason, and anchoring on today would open the panel
      empty on every student while the data ends 2025-09-17.
- [ ] `P3` **Page the detail route's `dwp_reports`.** The profile pulls every session in one
      response — 229 KB for the heaviest student (149 sessions). Fine at this size and the
      reason the page needed no API work; revisit if a student ever gets big enough to feel
      it.
- [x] `P2` **Instructor list and profile page** — the list pages off the shared envelope
      like the students one; the profile shows sessions taught (and how many co-taught),
      unique students, days taught with sessions-per-day, centers, days-taught-by-month,
      and the roster. Roster rows carry `student_key`, so they link straight through to
      the student profile with no lookup. Frontend-only: `/api/instructors/<name>` serves
      it in ~10 KB, and the largest roster (304) pages in the browser. Navigation runs both
      ways: a roster row opens that student, and an instructor name on a student's profile —
      in the Instructors card and in each session row — opens that instructor.
      **Two gaps left, both needing backend work:** most-taught topics renders an explicit
      "not available" card — the collection carries no topic data, see the `P2` data
      integrity item. And `unfinalized_sessions` is a **count, not the follow-up list** the
      original note asked for: it is surfaced as a figure with its share of the
      instructor's sessions (Samuel Smith is 135 of 478, 28%), but listing *which* sessions
      needs a route that serves `dwp_reports` filtered by instructor and `finalized:
      false`, which does not exist.
- [x] `P2` **Instructors in the global search.** Both kinds in one dropdown, under Students
      and Instructors headings with a total beside each — grouped rather than merged
      because a name can match both (*smith* is 15 students and 4 instructors) and a flat
      list would not say which kind a row is or where clicking it goes. Two requests, each
      rendering as it lands rather than waiting for the other; the dropdown only reports
      failure if **both** fail.
      **The Enter question is settled by group:** each group carries its own "see all N",
      and Enter goes to whichever group actually matched — `/instructors?query=` when only
      instructors did, `/students?query=` otherwise. Four rows per group, not five: at five
      the students filled the dropdown and the Instructors heading fell below the fold,
      hiding the thing the grouping exists to show.
- [x] `P2` **Months attended, on the student's *Sessions in a period* card.** The card
      reports sessions and days attended, then a per-month table underneath — so "how many
      months did they actually turn up in" can only be answered by counting rows by eye.
      **Frontend-only:** `by_month` is already in the `/api/students/<key>/attendance`
      response and already drives that table, so the figure is a third total beside the
      existing two.

      **A month counts only if they attended it.** No denominator, no "X of Y" — a month
      with no attendance simply does not count, and `by_month` is built from visits so it
      already omits those. The array's length *is* the figure; nothing needs deriving from
      `period.start` and `period.end`.

      That gap is the reason it is worth showing: **216 of 893 students, 24%, skipped at
      least one month inside their own span**, one of them missing 10 months between first
      session and last. For those students the count sits below the months the range covers,
      which is the point of counting attendance rather than calendar. Across the whole
      dataset the median student attended 5 months, against a 14-month span (Aug 2024 –
      Sep 2025) — 109 attended in only one month, 17 in twelve.

      It earns its place on a **wide** range rather than the default one: the card opens on
      three months ending at the student's last session, where the count can only read 1–3.
      It becomes useful once someone widens the range to a term or a year, which is also
      when reading the table by eye stops being practical. And it extends the distinction
      the card already trades on — sessions, days and months are three granularities of the
      same attendance, coarsest last, so a month with twelve sessions counts once here.

      Done, and it lands in **two places, scoped differently** — deliberately, so the same
      words showing different numbers is not a bug:

      - **The Sessions tile**, all-time: `149 Sessions · 12 months · last Jul 30, 2025`.
        Counted from distinct months across `dwp_reports`, not from `by_month`, because the
        tile row is all-time while `by_month` only covers the panel's range. The
        last-session date stays on the line — it appears nowhere else on the page.
      - **The attendance card**, period-scoped, beside sessions and days.

      Verified against real data: for one student the tile reads 12 months while the panel,
      on its default Apr–Jul range, reads 3. Widened to Sep 2024 – Sep 2025 the panel reads
      **136 sessions, 136 days, 11 months** over a range covering **13** — August and
      September 2025 are absent from `by_month`, so they do not count.
- [ ] `P2` **Pages per session on the instructor roster.** The roster shows sessions and
      pages completed as raw totals, which makes its rows incomparable: a student seen 24
      times will out-total one seen twice no matter how either session went. The rate is
      what says how a session with that student actually goes, and both halves are already
      on the roster entry — `sessions` and `pages_completed` — so this is **frontend-only**,
      the cheapest item in this section.

      It discriminates: across 8,475 roster entries the median is **4.6 pages a session**,
      the tenth percentile 1.0 and the ninetieth 10.0, with a maximum of 34. And it matters
      most where the totals mislead most — **40% of roster entries are a single session**,
      where "pages completed" *is* the per-session figure but reads as a total next to a
      24-session row.

      Two things to get right: **580 entries genuinely sit at 0.0** and must render as zero,
      not as a dash for missing; and while no roster entry currently has `sessions: 0`,
      guard the division anyway, the way the profile's sessions-per-day tile already does.
      The same column belongs on the student profile's Instructors card, which carries the
      identical two totals and the identical problem.
- [ ] `P2` **Average days worked per week, on the instructor profile.** A card beside
      *Days taught by month*, answering how often someone actually works rather than how
      much they have worked in total. **Frontend-only** — `days_taught[]` is already on the
      detail response, and the whole thing is a grouping of that array.

      **The denominator is the whole point.** Count the weeks from their first day taught
      to their last, then **drop any run of three or more consecutive weeks with nothing
      taught**. A one- or two-week gap still counts against the average — a week off is part
      of how someone works — but a longer absence is a term break, a closure or leave, and
      charging it to them measures the calendar rather than the person. **31 of the 103
      instructors have a gap of four weeks or more**, so this is not a rare correction.

      It lands where it should, between the two readings that get this wrong:

      | denominator | median days/week | worst case |
      |---|---|---|
      | every week in the span | 1.55 | 0.18 — punished for a long absence |
      | **gaps ≤ 2 weeks counted** | **1.76** | **0.62** |
      | only weeks actually worked | 1.98 | 1.00 by construction — flatters everyone |

      That rule drops **384 of 2,620 span weeks, 15%**, as long absences. A run after the
      final day taught never counts either, since the span ends there.

      Two edges: **4 instructors span less than two weeks**, where any weekly rate is noise
      — show the raw days instead. And group by **ISO week in UTC**, for the same reason the
      months grouping does: these are naive wall-clock dates, so a local read can push a
      Sunday or Monday across a week boundary.
- [x] `P2` **Topics tab in the sidebar.** Done — `TopicsPage` / `TopicsTable`, 771 topics
      paged off the shared envelope with the filter and offset in the URL. Per row: students
      who worked it, finished, on plan, removed, median sessions to finish and
      reassignments. Sorting by column is still open, under *Filter and sort each list*.

      **The list carries its own search bar, topics only** — not the global dropdown, which
      answers students and instructors and would bury 771 topics in it. It debounces into
      `?query=` on the list route, which matches `name`, `also_known_as` and `topic_id`,
      so an old name or a bare `pk-3121` both land.

      **Counts, not rates**, because of the type warning below: a finish-rate column would
      rank `GF` and `WCH` items to the bottom and read as "hardest topics". The visible id
      prefix is what makes the difference legible instead.

      ⚠️ **Show the `topic_id`, or the rows read as duplicates.** A name is not unique:
      90 names are carried by more than one topic and four topics are called *Patterns –
      Number Patterns*, so a name-ordered list shows four identical-looking rows. The id is
      the only thing that tells them apart. It is also the sort's tiebreak: the list
      leads with the most worked topics, and 670 of the 771 share a session count with
      another, so sessions alone is not a total order and paging over a partial one
      repeats and drops rows.

      The same applies to search results: `?q=Reducing Fractions using GCF` legitimately
      returns two topics, `PK-3233-00`, which is called that, and `PK-3121-00`, which used
      to be.

      ⚠️ **Group or filter by topic type, or the finish-rate column lies.** The id prefix
      predicts it almost entirely: `PK` — the curriculum, 663 topics and 13,268 pairs —
      finishes 68.7%, while `GF` is 28.3%, `WCH` 13.0%, `FO` 11.4% and the single `WOB`
      topic 0.0% across 20 students. Those are a different kind of item and do not carry a
      completion status the same way, so a flat ranking by finish rate fills the bottom
      with them and reads as "hardest topics".
- [ ] `P2` **Topic detail page** — *built, on the fields that exist*. `TopicProfilePage`
      is reachable from any list row and shows the header with `also_known_as`, the state
      breakdown, the status ladder and the ranked instructors, each linking onward. What
      remains is the first section below: the two time figures and the page comparison are
      not in `topics` yet, and the page carries a placeholder card naming them rather than
      faking a number. Finish this item by adding those three fields (see **Data
      integrity**) and filling that card in.

      Three things beyond what the list row already shows:

      **How long it takes.** Sessions to finish (the median is already stored; the mean is
      worth showing beside it) and elapsed days to finish, which is not the same question —
      a topic can take four sessions spread over two months. Computable now: 9,189 finished
      (student, topic) pairs, every one with usable dates. Median 13 days from first sight,
      9 from the finishing assignment's start. **Lead with the median on both** — the mean
      is 26.7 days against a median of 13, with a 393-day tail and 7.7% finishing the same
      day, so a mean on its own describes almost nobody.

      **What it does to a session's page count.** Not the topic's share of the pages — the
      *whole session's* `pages_completed`, and whether having this topic on the plan moves
      that total. So it is a comparison against the student's own baseline, never an
      attribution; page pace varies far more between students than between topics, which is
      why the student is their own control. Real signal, and face-valid: across 283 topics
      with 50+ finalized sessions it runs 0.69× to 2.11×, the drag end being long division
      (*Division – 5-digit by 2-digit* 0.69×) and the fast end shape recognition
      (*Transversals* 2.11×).

      ⚠️ **Its neutral point is ~1.12, not 1.0.** Sessions carry 2.17 topics on average and
      only 29.6% carry one, and a session's pages count once for every topic on it — which
      biases every ratio upward. Centred on 1.0 the page claims almost every topic speeds
      students up. Read it against the program median, label it "sessions including this
      topic", and do not imply the topic caused it: a topic usually worked alongside fast
      ones inherits their pace. Separating co-occurring topics needs a marginal effect
      rather than a mean — a later refinement, not a blocker.

      **Who teaches it most.** Already built — `topics.instructors[]` is ranked and holds
      the same pairs as `instructors.topics[]`.

      The `PK` / `GF` / `WCH` / `FO` / `WOB` warning on the list item applies here too:
      every rate on this page means something different for a non-`PK` item.
- [x] `P2` **Filter the two lists by center.** Done — a multi-select dropdown beside each
      list's search bar, in the `Card` header's `lead` slot. Several centers can be ticked,
      no ticks means all of them, and the selection rides in the URL as repeated `?center=`
      so a filtered view is linkable; changing it drops the offset. `FilterDropdown` in
      `src/shell/` is the reusable half — trigger, checkbox panel, outside-click and Escape
      dismissal — so the filters under the item below can join the same row.

      The options come from `GET /api/centers`, the union of distinct `centers.name` across
      both collections, rather than four names written into a component that would be
      silently wrong the day a fifth center opens.

      ⚠️ **The same filter is a partition on one page and a union on the other.** Students
      belong to exactly one center, so ticking North Dallas and Southlake returns
      395 + 234 = **629**. Instructors do not — 11 of 103 work at two or more — so the same
      two ticks return **62, not 67**: five instructors answer both boxes without being ten
      people. Do not put a per-option count beside an instructor checkbox without saying
      that, and never present the instructor total as a sum of its ticked parts.

      An unrecognised center name returns an empty page rather than a `400`. That looks
      like the `sort` allowlist under **API**, but it is the opposite case: "no students at
      Xyz" is a correct answer to a filter, while `sort=bogus` has no correct answer.
- [ ] `P2` **Filter and sort each list by its own columns.** Both lists take only a name
      substring today and are stuck in name order, so a column can be read but not asked
      about — there is no way to say "Southlake only", "fewer than 5 sessions", "nothing
      since June", or "most sessions first". Every column gets a filter, and its **type
      follows the column**, so the whole thing is one pattern applied seven times rather
      than seven separate features:

      | column | students | instructors | filter |
      |---|---|---|---|
      | name | ✓ | ✓ | text — **exists** as `?query=` |
      | account | ✓ | — | exact — **exists** as `?account_id=` |
      | center | ✓ | ✓ | multi-select — **done**, see the center item above |
      | sessions | ✓ | ✓ | numeric range |
      | topics finished / students taught | ✓ | ✓ | numeric range |
      | on plan / days taught | ✓ | ✓ | numeric range |
      | unfinalized | — | ✓ | numeric range |
      | last session | ✓ | ✓ | date range |

      **The numeric and date columns also sort**, from the same header: clicking one
      toggles **descending → ascending → descending**. Descending first because that is the
      end anyone asks for — most sessions, most unfinalized, most recent. One sort at a
      time; clicking another column starts that column at its own default, and the name
      column keeps today's ascending-by-name as the list's resting order.

      The controls belong in each `Card`'s header slot, hung off the column headers so the
      filter sits where the value it filters is read, and `sort` and `direction` join
      `query`, `offset` and the filters in the URL, so a filtered *and* sorted view is
      linkable and Back steps through it. Changing the sort has to reset the offset, and so
      does clearing a filter — page 3 of one ordering is not page 3 of another, which the
      existing "clear filter" button already handles for `query`.
      Blocked on the query parameters under **API**.

      Four things the data says before any of it is built:

      - **An instructor center filter means anywhere they have taught**, not their primary
        center — so one instructor can appear under two centers, deliberately. 395 North
        Dallas / 234 Southlake / 134 Forney / 130 Tyler. It needs saying because the two
        readings disagree for a tenth of the roster: **11 of 103 instructors teach at
        several**, while **no student attends more than one** (0 of 893), which makes the
        same filter unambiguous on the other list.
      - ⚠️ **Anchor the last-session range on the latest session in the data, not today.**
        Same trap as the attendance panel: the data ends 2025-09-17, so a "last 30 days"
        filter run now matches nobody. For scale, 313 students had no session in the data's
        final month, 226 in three months, 87 in six.
      - **A range beats a checkbox on the count columns.** "Has unfinalized reports" would
        match 70 of 103 instructors and "has topics on plan" 822 of 893 students — neither
        narrows anything. A minimum is what separates a straggler from a problem.
      - **Delivery method is not a column and cannot become one yet.** `@Home` / `In-Center`
        lives on `dwp_reports` and no aggregate carries it, so it needs `build_students.py`
        to roll it up before it could be shown, let alone filtered.
- [ ] `P2` **Report browser** — a page for reading `dwp_reports` across students. Today a
      report is reachable only one student at a time, through the session history on their
      profile, so questions that span students cannot be asked at all: what came in
      yesterday, everything Dana Reyes taught last week, every report still unfinalized.
      29,382 reports over 309 days. Blocked on the list route under **API**.

      Two views, and they earn their place differently:

      - **The list**, filtered on the same column pattern as the other two lists: date
        range, center, instructor, student, and finalized. `finalized: false` is the one
        that pays for the page on its own — **1,068 unfinalized reports**, and it is the
        *follow-up list* the instructor profile still cannot give, since
        `/api/instructors/<name>` serves only a count. Filtering that list by instructor is
        the same question answered properly.
      - **A single report**, showing the **whole** record. The profile's session history
        deliberately drops `card_level`, `stars_*`, `student_goal*` and `schoolwork_*`
        because they are populated on under a fifth of rows and would be dead columns on
        almost every student — but on the one report that has them they are the point.
        Render what is present, omit what is not, as the notes expander already does.

      ⚠️ **Settle `student_notes` before this ships**, not after. 3,594 reports carry them,
      and the existing `P2` question about who may read them is sharper here than on a
      profile: this page makes staff commentary about named children browsable in bulk,
      filtered by center and instructor, by anyone who can reach the API.
- [ ] `P2` **Report entry page** — fields filled in on the page, saved unfinished,
      finalized into `dwp_reports` as a normal document. Needs a list of what is still
      open. *Blocked on the write endpoints.*
- [ ] `P3` **Pinned stats on the Home page.** A pin button on any stat in the app puts
      that module in the top row of the home page — the row the reference layout fills with
      fixed KPI tiles. Every stat has to render standalone at tile size, and the layout is
      per person. Not every stat will be pinnable; which ones qualify gets decided as the
      elements are built. *Open:* now that accounts exist, whether the layout is stored on
      the `users` document — following the person across browsers — or left in browser
      storage, which needs no endpoint and no schema.
- [ ] `P3` **Spreadsheet upload page**, separately, for reports that arrive as `.xlsx`.
      The command-line import already works.
- [x] `P2` **Frontend test coverage.** 115 tests in `frontend/tests/` — 97.8% of
      statements, 92.6% of branches, 98.9% of lines. Every page, both list/profile pairs,
      `useApi`'s abort-on-unmount and `AsyncBoundary`'s state precedence are covered.
      What is left uncovered is defensive: `?? 'No center'`-style fallbacks and a handful
      of guards for shapes the API does not currently produce. Chasing the last few percent
      would mean asserting on branches that cannot be reached, so it stops here.
