import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

// features
import { CenterMetricsPage } from './features/centers/CenterMetricsPage'
import { DataQualityPage } from './features/quality/DataQualityPage'
import { HomePage } from './features/HomePage'
import { InstructorsPage } from './features/InstructorsPage'
import { ReportsPage } from './features/ReportsPage'
import { ReportDetailPage } from './features/profile/ReportDetailPage'
import { StudentsPage } from './features/StudentsPage'
import { TopicsPage } from './features/TopicsPage'
import { InstructorProfilePage } from './features/profile/InstructorProfilePage'
import { StudentProfilePage } from './features/profile/StudentProfilePage'
import { TopicProfilePage } from './features/profile/TopicProfilePage'
import { AppShell } from './shell/AppShell'

/**
 * The page's old address, kept working after the rename to /center-metrics.
 *
 * ⚠️ It carries the query string across. A bare `<Navigate to="/center-metrics">` drops it,
 * and the centers this page shows live entirely in `?center=` -- so a saved link to two
 * centers would silently reopen on all of them, which is a wrong answer rather than a
 * missing one. `replace` so Back returns to wherever the reader came from instead of
 * bouncing through the redirect.
 */
function CenterMetricsRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/center-metrics${search}`} replace />
}

export default function App() {
  return (
    <Routes>
      {/* Every page renders inside the shell, so the sidebar and the search bar are
          mounted once and survive navigation. */}
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="students" element={<StudentsPage />} />
        {/* The key is account_id + slugified name, so it carries characters that must
            survive a URL -- it is encoded on the way out in endpoints.ts. */}
        <Route path="students/:studentKey" element={<StudentProfilePage />} />
        <Route path="instructors" element={<InstructorsPage />} />
        {/* The name is the key, so it travels in the path URL-encoded. */}
        <Route path="instructors/:instructorName" element={<InstructorProfilePage />} />
        <Route path="topics" element={<TopicsPage />} />
        {/* topic_id, e.g. PK-3121-00 -- URL-safe as stored, encoded anyway. */}
        <Route path="topics/:topicId" element={<TopicProfilePage />} />
        {/* The center selection rides in ?center=, repeated -- so a link to this page
            carries which centers it was showing. */}
        <Route path="center-metrics" element={<CenterMetricsPage />} />
        {/* The page answered to /metrics before the rename. Declared above the catch-all,
            which would otherwise send a saved link to Home. */}
        <Route path="metrics" element={<CenterMetricsRedirect />} />
        <Route path="reports" element={<ReportsPage />} />
        {/* _id, the only unique field on dwp_reports -- its natural key is shared by four
            student-days. A malformed one answers 404 rather than 500; see find_by_id in
            models/dwp_report.py. */}
        <Route path="reports/:reportId" element={<ReportDetailPage />} />
        {/* Scoped by ?center= like the metrics page, so a manager can link to their own. */}
        <Route path="data-quality" element={<DataQualityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
