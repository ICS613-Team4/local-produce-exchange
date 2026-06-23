import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'

function DashboardPage() {
  // No server session yet, so read the logged-in member's id from localStorage.
  // An empty value means nobody is logged in, so the preview is skipped.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Holds the preview response. null means it has not loaded yet.
  const [previewResult, setPreviewResult] = useState<ListingResult | null>(null)

  // Load a small preview of the five newest active listings when logged in.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    async function loadPreview() {
      const loadedResult = await sendBrowseListingsRequest(memberId, { limit: 5 })
      setPreviewResult(loadedResult)
    }
    loadPreview()
  }, [memberId])

  // Build the preview area with a plain if/else chain, checked in a set order.
  let previewArea
  if (memberId === '') {
    previewArea = null
  } else if (previewResult === null) {
    previewArea = <p>Loading latest listings...</p>
  } else if (previewResult.errorMessage !== '') {
    previewArea = <p role="alert">{previewResult.errorMessage}</p>
  } else if (previewResult.ok) {
    const listings = previewResult.data as ListingDetail[]
    if (listings.length === 0) {
      previewArea = <p>No listings yet.</p>
    } else {
      const previewItems = []
      for (let index = 0; index < listings.length; index = index + 1) {
        const listing = listings[index]
        previewItems.push(
          <li key={listing.id}>
            <Link to={'/listings/' + listing.id}>{listing.title}</Link>
          </li>,
        )
      }
      previewArea = <ul>{previewItems}</ul>
    }
  } else {
    previewArea = <p role="alert">Could not load the latest listings.</p>
  }

  return (
    <section>
      <h1>Member Dashboard</h1>
      <ul>
        <li>
          <Link to="/browse">Browse listings</Link>
        </li>
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
      <section>
        <h2>Recently posted</h2>
        {previewArea}
      </section>
    </section>
  )
}

export default DashboardPage
