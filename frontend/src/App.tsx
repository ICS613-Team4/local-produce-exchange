import { BrowserRouter, Route, Routes } from 'react-router'
import Layout from './components/Layout.tsx'
import AboutPage from './pages/AboutPage.tsx'
import BrowsePage from './pages/BrowsePage.tsx'
import CreateListingPage from './pages/CreateListingPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import EditListingPage from './pages/EditListingPage.tsx'
import ExchangeThreadPage from './pages/ExchangeThreadPage.tsx'
import HomePage from './pages/HomePage.tsx'
import InvitePage from './pages/InvitePage.tsx'
import ListingDetailPage from './pages/ListingDetailPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import NotificationsPage from './pages/NotificationsPage.tsx'
import MyListingsPage from './pages/MyListingsPage.tsx'
import MyRequestsPage from './pages/MyRequestsPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import RequestQueuesPage from './pages/RequestQueuesPage.tsx'
import RequireAuth from './components/RequireAuth.tsx'
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
          <Route path="/register" element={<RegisterPage />} />
          {/* Member-only pages. RequireAuth wraps them as one group, so the
              login check lives in a single place instead of in each page. A
              logged-out visitor (or a stored id the backend rejects) sees the
              "please log in" message instead of the page. */}
          <Route element={<RequireAuth />}>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/requests" element={<RequestQueuesPage />} />
            <Route path="/my-requests" element={<MyRequestsPage />} />
            <Route path="/my-listings" element={<MyListingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/listings/create" element={<CreateListingPage />} />
            <Route path="/listings/:id/edit" element={<EditListingPage />} />
            <Route path="/exchange-thread" element={<ExchangeThreadPage />} />
          </Route>
          <Route path="/browse" element={<BrowsePage />} />
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
