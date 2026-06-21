import { BrowserRouter, Route, Routes } from 'react-router'
import Layout from './components/Layout.tsx'
import AboutPage from './pages/AboutPage.tsx'
import CreateListingPage from './pages/CreateListingPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import EditListingPage from './pages/EditListingPage.tsx'
import HomePage from './pages/HomePage.tsx'
import InvitePage from './pages/InvitePage.tsx'
import ListingDetailPage from './pages/ListingDetailPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import TestPage from './pages/TestPage.tsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/listings/create" element={<CreateListingPage />} />
          <Route path="/listings/:id/edit" element={<EditListingPage />} />
          <Route path="/listings/:id" element={<ListingDetailPage />} />
          {/* The "*" path matches only when no route above does, so every
              unknown URL shows the not-found page instead of a blank screen. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
