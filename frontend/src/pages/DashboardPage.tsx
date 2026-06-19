import { Link, useLocation } from 'react-router'

function DashboardPage() {
  // After a successful create, CreateListingPage redirects here with a flag in
  // the navigation state. Read it and show a one-line confirmation. When the
  // page is reached any other way, the state is absent and no note shows.
  const location = useLocation()
  let justCreated = false
  if (location.state !== null && typeof location.state === 'object') {
    const locationState = location.state as { created?: boolean }
    if (locationState.created === true) {
      justCreated = true
    }
  }

  // Build the confirmation note only when a listing was just created.
  let createdNote = <></>
  if (justCreated) {
    createdNote = <p role="status">Listing created.</p>
  }

  return (
    <>
      <h1>Member Dashboard</h1>
      {createdNote}
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
