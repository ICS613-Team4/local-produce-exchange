import { Link } from 'react-router'

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <span className="text-6xl mb-6">🍂</span>
      <h1 className="text-4xl font-bold text-text mb-3">Page not found</h1>
      <p className="text-text-muted mb-8">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="inline-flex items-center px-6 py-3 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
      >
        Go home
      </Link>
    </div>
  )
}

export default NotFoundPage
