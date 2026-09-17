import type { HoverCardContent } from '../shell/HoverCard'

/**
 * What "Unfinalized" means, wherever the tag appears: ReportsTable, SessionHistoryCard,
 * ReportDetailBody's chips (inside ReportModal) and CenterSessionsCard. One definition so
 * the four sites cannot drift.
 */
export const UNFINALIZED_CARD: HoverCardContent = {
  header: 'Unfinalized',
  prose: 'The instructor never completed the report. The student still attended.',
}
