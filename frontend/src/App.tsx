import { Navigate, Route, Routes } from 'react-router-dom'

import { HomePage } from './features/HomePage'
import { InstructorsPage } from './features/InstructorsPage'
import { StudentsPage } from './features/StudentsPage'
import { TopicsPage } from './features/TopicsPage'
import { InstructorProfilePage } from './features/profile/InstructorProfilePage'
import { StudentProfilePage } from './features/profile/StudentProfilePage'
import { TopicProfilePage } from './features/profile/TopicProfilePage'
import { AppShell } from './shell/AppShell'

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
