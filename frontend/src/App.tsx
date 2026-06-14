import { BrowserRouter, Route, Routes } from 'react-router'
import AboutPage from './pages/AboutPage.tsx'
import HomePage from './pages/HomePage.tsx'
import InvitePage from './pages/InvitePage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite" element={<InvitePage />} />
        {/* The "*" path matches only when no route above does, so every
            unknown URL shows the not-found page instead of a blank screen. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

