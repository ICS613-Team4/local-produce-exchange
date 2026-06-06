import { BrowserRouter, Route, Routes } from 'react-router'
import AboutPage from './pages/AboutPage.tsx'
import HomePage from './pages/HomePage.tsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
