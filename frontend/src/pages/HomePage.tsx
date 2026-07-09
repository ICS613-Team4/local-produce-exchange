import { Link } from 'react-router'

function HomePage() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero section */}
      <section className="w-full max-w-3xl text-center py-16 sm:py-24 px-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-50 text-primary-700 text-sm font-medium mb-6">
          <span>🌿</span>
          <span>Share what you grow</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text tracking-tight leading-tight mb-6">
          Welcome to <span className="text-primary-600">Surplus</span>
        </h1>
        <p className="text-lg sm:text-xl text-text-muted leading-relaxed max-w-2xl mx-auto mb-4">
          A local produce exchange that connects neighbors who have extra fruit,
          vegetables, and other homegrown food with people nearby who can use it
          — so good food gets shared instead of thrown away.
        </p>
        <p className="text-base text-text-muted leading-relaxed max-w-2xl mx-auto mb-10">
          Have a tree that makes more lemons than you can pick? Post them for
          someone down the street. Looking for fresh produce close to home?
          Browse what other members have shared and arrange a pickup.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-md hover:shadow-lg transition-all duration-200 w-full sm:w-auto"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-all duration-200 w-full sm:w-auto"
          >
            Register with an invite
          </Link>
        </div>
      </section>

      {/* Feature cards */}
      <section className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-3 gap-6 px-4 pb-16">
        <div className="bg-surface rounded-xl border border-border p-6 text-center shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="text-3xl mb-3">🍋</div>
          <h3 className="text-base font-semibold text-text mb-2">Post Surplus</h3>
          <p className="text-sm text-text-muted">
            List your extra produce so neighbors can find it.
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="text-3xl mb-3">🔍</div>
          <h3 className="text-base font-semibold text-text mb-2">Browse Nearby</h3>
          <p className="text-sm text-text-muted">
            Discover fresh food shared by people in your community.
          </p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 text-center shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="text-3xl mb-3">🤝</div>
          <h3 className="text-base font-semibold text-text mb-2">Arrange Pickup</h3>
          <p className="text-sm text-text-muted">
            Claim what you need and arrange a convenient pickup.
          </p>
        </div>
      </section>
    </div>
  )
}

export default HomePage
