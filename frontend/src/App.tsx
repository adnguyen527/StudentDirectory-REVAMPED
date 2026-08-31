import { Navigate, Route, Routes } from 'react-router-dom'

import { DashboardPage } from './features/DashboardPage'
import { InstructorsPage } from './features/InstructorsPage'
import { StudentsPage } from './features/StudentsPage'
import { AppShell } from './shell/AppShell'

export default function App() {
  return (
    <Routes>
      {/* Every page renders inside the shell, so the sidebar and the search bar are
          mounted once and survive navigation. */}
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="instructors" element={<InstructorsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
