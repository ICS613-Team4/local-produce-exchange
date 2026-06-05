import { BrowserRouter, Route, Routes } from 'react-router'
import HomePage from './pages/HomePage.tsx'
import SamplePage from './pages/SamplePage.tsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sample-page" element={<SamplePage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
