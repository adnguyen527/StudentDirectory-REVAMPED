"""The student builder's topic history.

The build itself talks to a real cluster, so what is unit-tested here is the part that
decides what the source means -- which is where it needs interpreting.

Status is a ladder: Worked On (worked, not completed) -> Completed (completed, not
mastered) -> Mastered (completed and mastered).

A topic is never idle on a lesson plan. If a student is working other topics instead, this
one came off the plan; when it reappears that is a fresh assignment, prompted by a new
assessment or plan. So an assignment ends when enough other topics have displaced it --
six, in the current data -- or when the status drops back down the ladder, which is a topic
handed back with no gap at all.
"""

from datetime import datetime

from ingestion.build_students import (
    DISPLACED_TOPICS_THRESHOLD,
    build_topic_history,
    count_topics,
    topic_list,
)


def day(n):
    return datetime(2026, 3, n)


def seen(topic_id, status, name=None):
    return (topic_id, name or topic_id, status)


def others(count, status='Worked On'):
    """A day spent on `count` topics that are not the one under test."""
    return [seen(f'O-{i}', status, f'Other {i}') for i in range(count)]


def history(*days):
    """days are (day number, [entries]) pairs, for readability at the call site."""
    return build_topic_history([(day(n), entries) for n, entries in days])


def only(topics):
    """The entry for the topic under test, when a case builds exactly one."""
    return topics['T-100']


class TestCountingSessions:

    def test_a_topic_records_every_session_it_appears_in(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['sessions'] == 3

    def test_two_sessions_on_one_day_both_count(self):
        """70 student-days in the current data carry more than one session."""
        topics = history(
            (1, [seen('T-100', 'Worked On'), seen('T-100', 'Mastered')]),
        )
        entry = only(topics)
        assert entry['sessions'] == 2
        assert entry['times_worked_on'] == 1
        assert entry['times_mastered'] == 1

    def test_a_day_holding_two_sessions_is_still_one_assignment(self):
        topics = history(
            (1, [seen('T-100', 'Worked On'), seen('T-100', 'Mastered')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_each_status_is_counted_separately(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, [seen('T-100', 'Mastered')]),
        )
        entry = only(topics)
        assert (entry['times_worked_on'], entry['times_mastered'], entry['times_completed']) \
            == (2, 1, 0)

    def test_the_status_counts_add_up_to_the_session_count(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Completed')]),
            (3, [seen('T-100', 'Mastered')]),
        )
        entry = only(topics)
        assert entry['sessions'] == (
            entry['times_worked_on'] + entry['times_completed'] + entry['times_mastered']
        )

    def test_two_topics_in_one_session_are_tracked_apart(self):
        topics = history(
            (1, [seen('T-100', 'Worked On'), seen('T-110', 'Mastered', 'Decimals')]),
        )
        assert topics['T-100']['times_worked_on'] == 1
        assert topics['T-110']['times_mastered'] == 1


class TestCurrentStatus:

    def test_status_is_the_most_recent_one(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Mastered')]),
        )
        assert only(topics)['status'] == 'Mastered'

    def test_a_day_with_two_results_takes_the_better_one(self):
        topics = history(
            (1, [seen('T-100', 'Mastered'), seen('T-100', 'Worked On')]),
        )
        assert only(topics)['status'] == 'Mastered'

    def test_a_reassigned_topic_reads_as_worked_on_again(self):
        """Its times_mastered still records that it was mastered once."""
        topics = history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
        )
        entry = only(topics)
        assert entry['status'] == 'Worked On'
        assert entry['times_mastered'] == 1


class TestAssignments:

    def test_a_topic_worked_once_was_assigned_once(self):
        topics = history((1, [seen('T-100', 'Worked On')]))
        assert only(topics)['times_assigned'] == 1

    def test_consecutive_sessions_are_one_assignment(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, [seen('T-100', 'Mastered')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_a_short_absence_is_still_one_assignment(self):
        """94% of returns have two or fewer other topics in between: the topic never left
        the plan, it just was not covered that day."""
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(2)),
            (3, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_displacement_just_under_the_threshold_is_one_assignment(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(DISPLACED_TOPICS_THRESHOLD - 1)),
            (3, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_displacement_at_the_threshold_starts_a_new_assignment(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(DISPLACED_TOPICS_THRESHOLD)),
            (3, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 2

    def test_displacement_accumulates_across_days(self):
        """Three days of two topics each displaces the same as one day of six."""
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(2)),
            (3, [seen('O-2', 'Worked On'), seen('O-3', 'Worked On')]),
            (4, [seen('O-4', 'Worked On'), seen('O-5', 'Worked On')]),
            (5, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 2

    def test_the_same_topic_repeated_does_not_displace(self):
        """One other topic worked six days running is one topic, not six."""
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            *[(n, [seen('O-0', 'Worked On')]) for n in range(2, 8)],
            (8, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_a_regression_starts_a_new_assignment_with_no_gap_at_all(self):
        """Mastered then handed straight back: reassigned after an assessment."""
        topics = history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['times_assigned'] == 2

    def test_climbing_the_ladder_is_not_a_new_assignment(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Completed')]),
            (3, [seen('T-100', 'Mastered')]),
        )
        assert only(topics)['times_assigned'] == 1

    def test_a_topic_can_be_assigned_several_times(self):
        topics = history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, [seen('T-100', 'Mastered')]),
            (4, [seen('T-100', 'Worked On')]),
        )
        entry = only(topics)
        assert entry['times_assigned'] == 3
        assert entry['times_mastered'] == 2

    def test_last_assignment_started_marks_the_latest_one(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(DISPLACED_TOPICS_THRESHOLD)),
            (3, [seen('T-100', 'Worked On')]),
        )
        assert only(topics)['last_assignment_started'] == day(3)

    def test_last_assignment_started_is_the_first_session_when_never_reassigned(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Mastered')]),
        )
        assert only(topics)['last_assignment_started'] == day(1)


class TestState:

    def test_a_finished_topic_reads_finished(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Mastered')]),
        )
        assert only(topics)['state'] == 'finished'

    def test_completed_counts_as_finished(self):
        topics = history((1, [seen('T-100', 'Completed')]))
        assert only(topics)['state'] == 'finished'

    def test_an_unfinished_topic_worked_recently_is_still_on_the_plan(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(2)),
        )
        assert only(topics)['state'] == 'on_plan'

    def test_an_unfinished_topic_displaced_since_reads_removed(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, others(DISPLACED_TOPICS_THRESHOLD)),
        )
        assert only(topics)['state'] == 'removed'

    def test_a_topic_finished_then_reassigned_is_not_finished_now(self):
        """state reads the last assignment only. total_unique_topics_finished is the one
        that asks whether it was ever finished at all."""
        topics = history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
        )
        entry = only(topics)
        assert entry['state'] == 'on_plan'
        assert entry['times_mastered'] == 1

    def test_a_topic_finished_then_reassigned_then_dropped_reads_removed(self):
        topics = history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, others(DISPLACED_TOPICS_THRESHOLD)),
        )
        assert only(topics)['state'] == 'removed'

    def test_every_topic_gets_a_state(self):
        """Including the ones that did the displacing -- they were worked most recently,
        so they are the ones still on the plan."""
        topics = history(
            (1, [seen('T-100', 'Worked On'), seen('T-110', 'Mastered', 'Decimals')]),
            (2, others(DISPLACED_TOPICS_THRESHOLD)),
        )
        assert topics['T-100']['state'] == 'removed'
        assert topics['T-110']['state'] == 'finished'
        assert {topics[f'O-{i}']['state'] for i in range(DISPLACED_TOPICS_THRESHOLD)} \
            == {'on_plan'}
        assert all(t['state'] for t in topics.values())


class TestDates:

    def test_first_and_last_seen_span_the_history(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Worked On')]),
            (3, [seen('T-100', 'Worked On')]),
        )
        entry = only(topics)
        assert (entry['first_seen'], entry['last_seen']) == (day(1), day(3))

    def test_a_single_session_is_both_ends(self):
        topics = history((1, [seen('T-100', 'Mastered')]))
        entry = only(topics)
        assert entry['first_seen'] == entry['last_seen'] == day(1)

    def test_days_arriving_out_of_order_are_sorted_first(self):
        """The whole notion of an assignment is a sequence, so the function orders the
        days itself rather than trusting its caller."""
        topics = build_topic_history([
            (day(3), [seen('T-100', 'Mastered')]),
            (day(1), [seen('T-100', 'Worked On')]),
        ])
        entry = only(topics)
        assert entry['first_seen'] == day(1)
        assert entry['status'] == 'Mastered'
        assert entry['times_assigned'] == 1


class TestWhatIsIgnored:

    def test_an_unknown_status_is_not_rolled_up(self):
        topics = history(
            (1, [seen('T-100', 'Something New'), seen('T-200', None)]),
        )
        assert topics == {}

    def test_a_day_with_no_topics_is_not_an_error(self):
        assert build_topic_history([(day(1), [])]) == {}
        assert build_topic_history([]) == {}

    def test_a_topic_without_an_id_falls_back_to_its_raw_text(self):
        """The caller resolves id-or-raw, so an empty id would collide; this pins that a
        real fallback value survives as the key."""
        topics = build_topic_history([
            (day(1), [('Long Division', None, 'Mastered')]),
        ])
        assert list(topics) == ['Long Division']

    def test_a_name_that_arrives_late_is_kept(self):
        topics = build_topic_history([
            (day(1), [('T-100', None, 'Worked On')]),
            (day(2), [('T-100', 'Fractions', 'Mastered')]),
        ])
        assert only(topics)['name'] == 'Fractions'

    def test_the_working_fields_do_not_reach_the_document(self):
        topics = history((1, [seen('T-100', 'Worked On')]))
        assert not [k for k in only(topics) if k.startswith('_')]


class TestTopicList:

    def test_most_worked_through_first(self):
        topics = history(
            (1, [seen('T-100', 'Worked On')]),
            (2, [seen('T-100', 'Mastered'), seen('T-200', 'Mastered', 'Angles')]),
        )
        assert [t['id'] for t in topic_list(topics)] == ['T-100', 'T-200']

    def test_a_tie_is_broken_by_name_so_rebuilds_are_stable(self):
        topics = history(
            (1, [seen('T-100', 'Mastered', 'Fractions'),
                 seen('T-110', 'Mastered', 'Decimals')]),
        )
        assert [t['name'] for t in topic_list(topics)] == ['Decimals', 'Fractions']

    def test_no_topics_is_an_empty_list(self):
        assert topic_list({}) == []


class TestCountTopics:

    def test_counts_topics_ever_reaching_that_status(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Mastered'),
                 seen('T-200', 'Completed', 'Angles'),
                 seen('T-300', 'Worked On', 'Ratios')]),
        ))
        assert count_topics(topics, 'times_mastered') == 1
        assert count_topics(topics, 'times_completed') == 1

    def test_a_reassigned_topic_still_counts_as_ever_mastered(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
        ))
        assert count_topics(topics, 'times_mastered') == 1
        assert topics[0]['status'] == 'Worked On'

    def test_a_topic_mastered_twice_counts_once(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Mastered')]),
        ))
        assert count_topics(topics, 'times_mastered') == 1


class TestTopicsFinished:
    """'Finished' = completed or mastered, which is what a parent means by the word.

    The source writes one status per session rather than both, so a mastered topic is
    almost never also marked Completed -- 8,739 of them are not. Counting times_completed
    alone therefore misses nearly every topic the student actually finished.
    """

    def test_a_mastered_topic_is_finished_even_though_completed_is_zero(self):
        topics = topic_list(history((1, [seen('T-100', 'Mastered')])))
        assert count_topics(topics, 'times_completed') == 0
        assert count_topics(topics, 'times_completed', 'times_mastered') == 1

    def test_a_completed_topic_is_finished(self):
        topics = topic_list(history((1, [seen('T-100', 'Completed')])))
        assert count_topics(topics, 'times_completed', 'times_mastered') == 1

    def test_a_topic_only_worked_on_is_not_finished(self):
        topics = topic_list(history((1, [seen('T-100', 'Worked On')])))
        assert count_topics(topics, 'times_completed', 'times_mastered') == 0

    def test_one_topic_holding_both_statuses_is_counted_once(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Completed')]),
            (2, [seen('T-100', 'Mastered')]),
        ))
        assert count_topics(topics, 'times_completed', 'times_mastered') == 1

    def test_a_topic_finished_then_reassigned_stays_finished(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Mastered')]),
            (2, [seen('T-100', 'Worked On')]),
        ))
        assert count_topics(topics, 'times_completed', 'times_mastered') == 1
        assert topics[0]['state'] == 'on_plan'

    def test_finished_is_never_smaller_than_either_part(self):
        topics = topic_list(history(
            (1, [seen('T-100', 'Mastered'),
                 seen('T-200', 'Completed', 'Angles'),
                 seen('T-300', 'Worked On', 'Ratios')]),
        ))
        finished = count_topics(topics, 'times_completed', 'times_mastered')
        assert finished == 2
        assert finished >= count_topics(topics, 'times_mastered')
        assert finished >= count_topics(topics, 'times_completed')
