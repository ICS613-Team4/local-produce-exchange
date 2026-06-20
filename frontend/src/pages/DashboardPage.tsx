import { Link } from 'react-router'

function DashboardPage() {
  return (
    <>
      <h1>Member Dashboard</h1>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
      <p>
        <Link to="/about">Go to about page</Link>
      </p>
      <ul>
        <li>
          <Link to="/listings/create">Create a listing</Link>
        </li>
      </ul>
    </>
  )
}

export default DashboardPage
