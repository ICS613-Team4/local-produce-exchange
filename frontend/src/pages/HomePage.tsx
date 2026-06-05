import { Link } from 'react-router'

function HomePage() {
  return (
    <>
      <h1>Home page</h1>
      <p>
        <Link to="/sample-page">Go to sample page</Link>
      </p>
    </>
  )
}

export default HomePage
