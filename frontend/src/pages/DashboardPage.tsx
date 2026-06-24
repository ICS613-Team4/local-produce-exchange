import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

function DashboardPage() {
  // The logged-in member id, read once from localStorage. An empty value means
  // nobody is logged in, so the preview fetch below is skipped.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Holds the preview response (the five newest active listings). null means it
  // has not loaded yet.
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
  // The note that tells the viewer the times on this page are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

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
        const postedText = formatTimestamp(listing.created_at)
        previewItems.push(
          <li key={listing.id}>
            <Link to={'/listings/' + listing.id}>{listing.title}</Link> (posted on: {postedText})
          </li>,
        )
      }
      previewArea = (
        <>
          <ul>{previewItems}</ul>
          <p>
            <small>{timeZoneNote}</small>
          </p>
        </>
      )
    }
  } else {
    previewArea = <p role="alert">Could not load the latest listings.</p>
  }

  return (
    <section>
      <h1>Member Dashboard</h1>
      <ul>
        <li>
          <Link to="/browse">Browse All Listings</Link>
        </li>
        <li>
          <Link to="/listings/create">Create a Listing</Link>
        </li>
        <li>
          <Link to="/invite">Invite a New Member</Link>
        </li>
        <li>
          <Link to="/profile">View Your Profile</Link>
        </li>
        <li>
          <Link to="/requests">See All Requests from Other Members</Link>
        </li>
        <li>
          <Link to="/my-requests">See All Your Requests</Link>
        </li>
      </ul>
      <section>
        <h2>Latest Community Listings</h2>
        {previewArea}
      </section>
    </section>
  )
}

export default DashboardPage
