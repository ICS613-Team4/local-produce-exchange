import { Link } from 'react-router'

function DashboardPage() {
  return (
    <section>
      <h1>Member Dashboard</h1>
      <ul>
        <li>
          <Link to="/listings/create">Create a listing</Link>
        </li>
        <li>
          <Link to="/invite">Invite a new member</Link>
        </li>
        <li>
          <Link to="/profile">View profile</Link>
        </li>
      </ul>
    </section>
  )
}

export default DashboardPage
