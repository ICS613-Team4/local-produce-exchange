import { Link } from 'react-router'

function AboutPage() {
  return (
    <>
      <h1>About page</h1>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
      <p>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae
        lorem at nulla facilisis pretium.
      </p>
    </>
  )
}

export default AboutPage
