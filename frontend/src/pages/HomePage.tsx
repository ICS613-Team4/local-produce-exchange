import { Link } from 'react-router'

function HomePage() {
  return (
    <section>
      <h1>Welcome to Surplus</h1>
      <p>
        Surplus is a local produce exchange. It connects neighbors who have extra
        fruit, vegetables, and other homegrown food with people nearby who can use
        it, so good food gets shared instead of thrown away.
      </p>
      <p>
        Have a tree that makes more lemons than you can pick? Post them for someone
        down the street. Looking for fresh produce close to home? Browse what other
        members have shared and arrange a pickup.
      </p>
      <p>
        <Link to="/login">Log in</Link> to post a listing or claim what others
        have offered. New here?{' '}
        <Link to="/register">Register with an invite from a current member</Link>{' '}
        to join the community.
      </p>
    </section>
  )
}

export default HomePage
