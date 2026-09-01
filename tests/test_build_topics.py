"""The topic builder's rollup and its canonical-name rule.

The build itself talks to a real cluster, so what is unit-tested here is the part that
decides what the source means. Two things need interpreting.

A topic can carry more than one name. Three ids do in the current data, and only one of
them is a rename -- PK-3121-00, where the old name stops the week the new one starts. The
other two run both names side by side for the topic's whole life. So the name is settled
by a rule rather than a map: most recently used, then most sessions, then alphabetical.
The rule is deliberately tested with the recent name holding *fewer* sessions, because
that is the only case where last-used and most-sessions disagree -- and no collision in
the current data separates them.

The rollup itself counts per (student, topic) pair, not per session. Its per-student
histories come from build_students.build_topic_history, which has its own tests; what is
tested here is that they add up.
"""

from datetime import datetime

from ingestion.build_topics import canonical_name, collect, make_documents, roll_up


def day(n):
    return datetime(2026, 3, n)


def seen(topic_id, status, name=None):
    return (topic_id, name or topic_id, status)


def others(count, status='Worked On'):
    """A day spent on `count` topics that are not the one under test."""
    return [seen(f'O-{i}', status, f'Other {i}') for i in range(count)]


def student(*days):
    """One student's history, as (day number, [entries]) pairs."""
    return {day(n): entries for n, entries in days}


def stats(mapping):
    """{'A name': (sessions, day number or None)} -> what canonical_name reads."""
    return {
        name: {'sessions': sessions, 'last': day(n) if n else None}
        for name, (sessions, n) in mapping.items()
    }


def only(topics):
    """The rollup for the topic under test, when a case builds exactly one."""
    return topics['T-100']


class TestCanonicalName:

    def test_the_most_recently_used_name_wins(self):
        """The rename case, with the counts that make it a real test: the newer name is
        given far fewer sessions, so most-sessions would pick the other one."""
        name, alternates = canonical_name(stats({
            'Reducing Fractions':    (493, 1),
            'Simplifying Fractions':  (39, 2),
        }))
        assert name == 'Simplifying Fractions'
        assert alternates == ['Reducing Fractions']

    def test_names_last_used_the_same_day_fall_back_to_sessions(self):
        name, _ = canonical_name(stats({
            'Identifying Triangles': (62, 3),
            'Classifying Triangles': (63, 3),
        }))
        assert name == 'Classifying Triangles'

    def test_a_full_tie_falls_back_to_alphabetical_order(self):
        """So the collection does not change between builds on read order alone."""
        name, alternates = canonical_name(stats({
            'Properties of 3D Figures':        (40, 4),
            'Identifying Pyramids and Prisms': (40, 4),
        }))
        assert name == 'Identifying Pyramids and Prisms'
        assert alternates == ['Properties of 3D Figures']

    def test_a_name_the_source_never_dated_ranks_below_one_it_did(self):
        name, _ = canonical_name(stats({
            'Undated': (900, None),
            'Dated':     (1, 1),
        }))
        assert name == 'Dated'

    def test_a_missing_name_is_ignored(self):
        name, alternates = canonical_name({
            None:   {'sessions': 50, 'last': day(9)},
            'Real': {'sessions': 1,  'last': day(1)},
        })
        assert (name, alternates) == ('Real', [])

    def test_no_usable_name_at_all(self):
        assert canonical_name({None: {'sessions': 5, 'last': day(1)}}) == (None, [])
        assert canonical_name({}) == (None, [])

    def test_the_alternates_keep_the_ranking_order(self):
        _, alternates = canonical_name(stats({
            'Oldest': (10, 1),
            'Newest': (10, 3),
            'Middle': (10, 2),
        }))
        assert alternates == ['Middle', 'Oldest']


class FakeReports:
    """Just enough of a pymongo collection for collect() -- find(query, projection)."""

    def __init__(self, *docs):
        self._docs = docs

    def find(self, *args, **kwargs):
        return iter(self._docs)


def report(student, date_n, topics, instructors=()):
    return {
        'account_id':   f'acct-{student}',
        'student_name': student,
        'date':         day(date_n),
        'topics':       topics,
        'instructors':  list(instructors),
    }


def entry(topic_id, status, name=None):
    return {'id': topic_id, 'name': name or topic_id, 'status': status}


class TestCollectingInstructors:
    """Who taught a topic, for the ranked list on the topic page."""

    def taught(self, *docs):
        return collect(FakeReports(*docs))[2]

    def test_a_co_taught_session_credits_each_instructor_in_full(self):
        """Both of them taught it, so neither gets half. The same rule
        build_instructors applies to pages -- and the reason the credited total across a
        topic can exceed that topic's own session count."""
        assert self.taught(
            report('Ada', 1, [entry('T-100', 'Worked On')], ['Grace', 'Kay']),
        ) == {'T-100': {'Grace': 1, 'Kay': 1}}

    def test_credit_accumulates_across_sessions_and_students(self):
        assert self.taught(
            report('Ada', 1, [entry('T-100', 'Worked On')], ['Grace']),
            report('Bo',  2, [entry('T-100', 'Mastered')],  ['Grace', 'Kay']),
        ) == {'T-100': {'Grace': 2, 'Kay': 1}}

    def test_two_topics_on_one_session_each_credit_the_instructor(self):
        assert self.taught(
            report('Ada', 1, [entry('T-100', 'Worked On'),
                              entry('T-110', 'Mastered')], ['Grace']),
        ) == {'T-100': {'Grace': 1}, 'T-110': {'Grace': 1}}

    def test_a_status_off_the_ladder_credits_nobody(self):
        """It is not rolled up, so it does not get a say in who taught the topic."""
        assert self.taught(
            report('Ada', 1, [entry('T-100', 'In Progress')], ['Grace']),
        ) == {}

    def test_an_unstaffed_session_leaves_the_topic_with_no_instructor(self):
        assert self.taught(report('Ada', 1, [entry('T-100', 'Worked On')], [])) == {}

    def test_blank_instructor_names_are_dropped(self):
        assert self.taught(
            report('Ada', 1, [entry('T-100', 'Worked On')], ['  ', 'Grace ']),
        ) == {'T-100': {'Grace': 1}}


class TestRollUp:

    def test_the_three_states_partition_the_students(self):
        topics = roll_up({
            'finished': student((1, [seen('T-100', 'Mastered')])),
            'on-plan':  student((1, [seen('T-100', 'Worked On')])),
            'removed':  student(
                (1, [seen('T-100', 'Worked On')]),
                (2, others(6)),
            ),
        })
        entry = only(topics)
        assert entry['unique_students'] == 3
        assert (entry['students_finished'],
                entry['students_on_plan'],
                entry['students_removed']) == (1, 1, 1)
        assert (entry['students_finished']
                + entry['students_on_plan']
                + entry['students_removed']) == entry['unique_students']

    def test_reassignments_are_summed_across_students(self):
        handed_back = (
            (1, [seen('T-100', 'Mastered')]),
            (2, others(6)),
            (3, [seen('T-100', 'Worked On')]),
        )
        topics = roll_up({
            'a': student(*handed_back),
            'b': student(*handed_back),
            'c': student((1, [seen('T-100', 'Worked On')])),
        })
        assert only(topics)['total_reassignments'] == 2

    def test_ever_finished_can_exceed_finished_now(self):
        """A topic mastered and then handed back is not finished now, but it was."""
        topics = roll_up({'a': student(
            (1, [seen('T-100', 'Mastered')]),
            (2, others(6)),
            (3, [seen('T-100', 'Worked On')]),
        )})
        entry = only(topics)
        assert entry['students_ever_finished'] == 1
        assert entry['students_finished'] == 0

    def test_first_and_last_taught_span_every_student(self):
        topics = roll_up({
            'early': student((1, [seen('T-100', 'Worked On')])),
            'late':  student((5, [seen('T-100', 'Worked On')])),
        })
        entry = only(topics)
        assert entry['first_taught'] == day(1)
        assert entry['last_taught'] == day(5)

    def test_session_and_status_counts_add_across_students(self):
        topics = roll_up({
            'a': student(
                (1, [seen('T-100', 'Worked On')]),
                (2, [seen('T-100', 'Worked On')]),
            ),
            'b': student((1, [seen('T-100', 'Mastered')])),
        })
        entry = only(topics)
        assert entry['sessions'] == 3
        assert entry['times_worked_on'] == 2
        assert entry['times_mastered'] == 1
        assert entry['sessions'] == (
            entry['times_worked_on'] + entry['times_completed'] + entry['times_mastered']
        )

    def test_two_topics_are_rolled_up_apart(self):
        topics = roll_up({'a': student(
            (1, [seen('T-100', 'Worked On'), seen('T-110', 'Mastered', 'Decimals')]),
        )})
        assert topics['T-100']['students_on_plan'] == 1
        assert topics['T-110']['students_finished'] == 1


class TestDocuments:

    def rolled(self):
        """One topic worked by three students, two of whom finished it."""
        return roll_up({
            'quick':  student((1, [seen('T-100', 'Mastered')])),
            'slower': student(
                (1, [seen('T-100', 'Worked On')]),
                (2, [seen('T-100', 'Worked On')]),
                (3, [seen('T-100', 'Mastered')]),
            ),
            'never':  student(*[(n, [seen('T-100', 'Worked On')]) for n in range(1, 6)]),
        })

    def document(self, names=None, instructors=None):
        docs = make_documents(self.rolled(), names or {}, instructors or {})
        return next(d for d in docs if d['topic_id'] == 'T-100')

    def test_the_median_counts_only_the_students_who_finished(self):
        """The one who never finished spent the most sessions of anyone; counting them
        would move the median from 2 to 3."""
        doc = self.document()
        assert doc['students_ever_finished'] == 2
        assert doc['median_sessions_to_finish'] == 2

    def test_a_topic_nobody_finished_has_no_median(self):
        topics = roll_up({'a': student((1, [seen('T-100', 'Worked On')]))})
        doc = make_documents(topics, {}, {})[0]
        assert doc['median_sessions_to_finish'] is None

    def test_the_names_not_chosen_are_kept(self):
        doc = self.document(names={'T-100': stats({
            'Old Name': (1, 1),
            'New Name': (1, 2),
        })})
        assert doc['name'] == 'New Name'
        assert doc['also_known_as'] == ['Old Name']

    def test_a_topic_with_no_name_falls_back_to_its_id(self):
        assert self.document()['name'] == 'T-100'

    def test_unique_instructors_counts_distinct_people(self):
        doc = self.document(instructors={'T-100': {'Ada': 9, 'Grace': 1}})
        assert doc['unique_instructors'] == 2

    def test_instructors_are_ranked_by_how_much_they_taught_it(self):
        """What the topic page's 'taught most by' list reads."""
        doc = self.document(instructors={'T-100': {'Ada': 2, 'Grace': 9, 'Kay': 5}})
        assert doc['instructors'] == [
            {'name': 'Grace', 'sessions': 9},
            {'name': 'Kay',   'sessions': 5},
            {'name': 'Ada',   'sessions': 2},
        ]

    def test_instructors_tied_on_sessions_are_ordered_by_name(self):
        """So the ranking does not reshuffle between builds."""
        doc = self.document(instructors={'T-100': {'Grace': 4, 'Ada': 4}})
        assert [i['name'] for i in doc['instructors']] == ['Ada', 'Grace']

    def test_a_topic_nobody_was_recorded_teaching_has_an_empty_list(self):
        """73 dwp rows name no instructor, and one topic has no staffed session at all."""
        doc = self.document()
        assert doc['instructors'] == []
        assert doc['unique_instructors'] == 0

    def test_unique_instructors_always_matches_the_list(self):
        doc = self.document(instructors={'T-100': {'Ada': 1, 'Grace': 2, 'Kay': 3}})
        assert doc['unique_instructors'] == len(doc['instructors'])

    def test_the_working_field_is_not_stored(self):
        assert '_sessions_to_finish' not in self.document()

    def test_topics_are_ordered_by_how_much_they_were_worked(self):
        topics = roll_up({'a': student((1, [
            seen('T-100', 'Worked On'),
            seen('T-110', 'Worked On', 'Decimals'),
            seen('T-110', 'Worked On', 'Decimals'),
        ]))})
        assert [d['topic_id'] for d in make_documents(topics, {}, {})] == ['T-110', 'T-100']
