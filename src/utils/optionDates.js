/**
 * Returns the third Friday of a given month/year.
 * Standard monthly equity options expire on the 3rd Friday.
 */
export function thirdFriday(year, month) {
  // Find day-of-week for the 1st of the month (0=Sun … 6=Sat)
  const firstDow = new Date(year, month, 1).getDay()
  // Days until first Friday (could be 0 if the 1st is already a Friday)
  const toFirstFriday = (5 - firstDow + 7) % 7
  const firstFridayDay = 1 + toFirstFriday
  return new Date(year, month, firstFridayDay + 14) // +14 = 3rd Friday
}

/**
 * Returns the next standard monthly expiration date that is strictly
 * more than `minDte` calendar days from today.
 */
export function nextStandardExpiry(minDte = 25) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let offset = 0; offset <= 24; offset++) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1)
    const expiry = thirdFriday(d.getFullYear(), d.getMonth())
    const dte = Math.round((expiry - today) / 86_400_000)
    if (dte > minDte) return expiry
  }
  return null
}

/** Format a Date as YYYY-MM-DD for <input type="date"> */
export function toInputDate(date) {
  return date.toISOString().slice(0, 10)
}

/** Calendar days between today (midnight) and a date string YYYY-MM-DD */
export function calcDte(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / 86_400_000)
}
