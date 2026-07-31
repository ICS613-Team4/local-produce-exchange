import { describe, expect, test } from 'vitest'

import {
  DEFAULT_PAGE_SIZE,
  buildPageList,
  clampPage,
  countPages,
  describeShownRange,
  readPageParam,
} from './pagination'

// --- the shared page size ---

test('the default page size is 12 for every paged page', () => {
  // The backend keeps its own copy of this number in backend/app/pagination.py.
  expect(DEFAULT_PAGE_SIZE).toBe(12)
})

// --- readPageParam: the URL is the only place the current page lives ---

describe('readPageParam', () => {
  test('reads a whole page number from the URL', () => {
    expect(readPageParam(new URLSearchParams('page=3'), 'page')).toBe(3)
  })

  test('reads the named param, so sections on one page do not collide', () => {
    const params = new URLSearchParams('pending_page=2&denied_page=5')
    expect(readPageParam(params, 'pending_page')).toBe(2)
    expect(readPageParam(params, 'denied_page')).toBe(5)
    // A section with no param of its own stays on page 1.
    expect(readPageParam(params, 'approved_page')).toBe(1)
  })

  test('a missing page reads as 1', () => {
    expect(readPageParam(new URLSearchParams(''), 'page')).toBe(1)
  })

  test('an empty page reads as 1', () => {
    expect(readPageParam(new URLSearchParams('page='), 'page')).toBe(1)
  })

  test('a non-numeric page reads as 1', () => {
    expect(readPageParam(new URLSearchParams('page=abc'), 'page')).toBe(1)
    // parseInt would take this as 2; the whole value has to be a number.
    expect(readPageParam(new URLSearchParams('page=2abc'), 'page')).toBe(1)
  })

  test('a decimal page reads as 1', () => {
    expect(readPageParam(new URLSearchParams('page=1.5'), 'page')).toBe(1)
  })

  test('a zero or negative page reads as 1', () => {
    expect(readPageParam(new URLSearchParams('page=0'), 'page')).toBe(1)
    expect(readPageParam(new URLSearchParams('page=-4'), 'page')).toBe(1)
  })
})

// --- countPages ---

describe('countPages', () => {
  test('an exact multiple of the page size fills whole pages', () => {
    expect(countPages(24, 12)).toBe(2)
  })

  test('a remainder needs one more page', () => {
    expect(countPages(25, 12)).toBe(3)
  })

  test('a list that fits in one window is one page', () => {
    expect(countPages(12, 12)).toBe(1)
    expect(countPages(1, 12)).toBe(1)
  })

  test('an empty list is one empty page, not zero pages', () => {
    expect(countPages(0, 12)).toBe(1)
  })
})

// --- clampPage ---

describe('clampPage', () => {
  test('a page inside the range is left alone', () => {
    expect(clampPage(2, 5)).toBe(2)
  })

  test('a page past the end becomes the last page', () => {
    expect(clampPage(99, 5)).toBe(5)
  })

  test('a page below the first becomes 1', () => {
    expect(clampPage(0, 5)).toBe(1)
  })
})

// --- describeShownRange: the "Showing X-Y of N" line ---

describe('describeShownRange', () => {
  test('names the first window', () => {
    expect(describeShownRange(1, 12, 40)).toBe('Showing 1-12 of 40')
  })

  test('names a middle window', () => {
    expect(describeShownRange(2, 12, 40)).toBe('Showing 13-24 of 40')
  })

  test('the last window stops at the total, not at page times page size', () => {
    expect(describeShownRange(4, 12, 40)).toBe('Showing 37-40 of 40')
  })

  test('a single short page counts what is there', () => {
    expect(describeShownRange(1, 12, 3)).toBe('Showing 1-3 of 3')
  })

  test('an empty list has nothing to show', () => {
    expect(describeShownRange(1, 12, 0)).toBe('Showing 0 of 0')
  })
})

// --- buildPageList: numbers and gaps ---

describe('buildPageList', () => {
  test('a short list shows every page', () => {
    expect(buildPageList(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  test('seven pages still fit without a gap', () => {
    expect(buildPageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test('a current page in the middle gets a gap on each side', () => {
    expect(buildPageList(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20])
  })

  test('a current page at the start keeps the first numbers together', () => {
    expect(buildPageList(1, 20)).toEqual([1, 2, 3, 4, 'gap', 20])
  })

  test('a current page at the end keeps the last numbers together', () => {
    expect(buildPageList(20, 20)).toEqual([1, 'gap', 17, 18, 19, 20])
  })

  test('a single hidden page is shown instead of a gap that would replace it', () => {
    // With the window at 3-5 of 8, only page 2 is missing on the left, so its
    // number is drawn rather than a gap that stands in for one page.
    expect(buildPageList(4, 8)).toEqual([1, 2, 3, 4, 5, 'gap', 8])
    expect(buildPageList(5, 8)).toEqual([1, 'gap', 4, 5, 6, 7, 8])
  })

  test('the current page is always in the list', () => {
    for (let page = 1; page <= 20; page = page + 1) {
      expect(buildPageList(page, 20)).toContain(page)
    }
  })

  test('the numbers always climb, so no page is repeated or out of order', () => {
    for (let page = 1; page <= 20; page = page + 1) {
      const numbers = buildPageList(page, 20).filter((entry) => entry !== 'gap') as number[]
      for (let index = 1; index < numbers.length; index = index + 1) {
        expect(numbers[index]).toBeGreaterThan(numbers[index - 1])
      }
    }
  })
})
