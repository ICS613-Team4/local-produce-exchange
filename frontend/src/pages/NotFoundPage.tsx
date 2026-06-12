import { Link } from 'react-router'

function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <p>The page you asked for does not exist.</p>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
    </>
  )
}

export default NotFoundPage
