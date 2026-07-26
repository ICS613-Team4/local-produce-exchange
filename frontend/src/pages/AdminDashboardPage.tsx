import { Link } from 'react-router'

// The landing page for admin-only tooling (/admin), one card per destination.
// Each card is its own <Link>, the same clickable-card pattern the Quick
// actions row on DashboardPage uses, sized for a description line since there
// are only three destinations here rather than a row of small icons.
function AdminDashboardPage() {
  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Admin Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Link
          to="/admin/members"
          className="bg-surface rounded-xl border border-border p-6 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group"
        >
          <div aria-hidden="true" className="text-3xl mb-3 group-hover:scale-110 transition-transform inline-block">
            👤
          </div>
          <h2 className="text-base font-semibold text-text mb-2 group-hover:text-primary-600">Manage Members</h2>
          <p className="text-sm text-text-muted">
            Search members, view full account details, and suspend or reinstate accounts.
          </p>
        </Link>
        <Link
          to="/admin/listings"
          className="bg-surface rounded-xl border border-border p-6 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group"
        >
          <div aria-hidden="true" className="text-3xl mb-3 group-hover:scale-110 transition-transform inline-block">
            🥬
          </div>
          <h2 className="text-base font-semibold text-text mb-2 group-hover:text-primary-600">Manage Listings</h2>
          <p className="text-sm text-text-muted">
            Review every listing and deactivate or reactivate one.
          </p>
        </Link>
        <Link
          to="/admin/reports"
          className="bg-surface rounded-xl border border-border p-6 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group"
        >
          <div aria-hidden="true" className="text-3xl mb-3 group-hover:scale-110 transition-transform inline-block">
            📊
          </div>
          <h2 className="text-base font-semibold text-text mb-2 group-hover:text-primary-600">Activity Report</h2>
          <p className="text-sm text-text-muted">
            Generate a basic report of listings, requests, members, and completed exchanges.
          </p>
        </Link>
      </div>
    </section>
  )
}

export default AdminDashboardPage
