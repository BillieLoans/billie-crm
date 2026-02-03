/** Address shape used for building map link (matches customer residentialAddress). */
export interface ResidentialAddressLike {
  fullAddress?: string | null
  street?: string | null
  suburb?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
}

/**
 * Build the fullest possible address string for a map search.
 * Prefers joining street, suburb/city, state, postcode so we pass a complete address to Maps;
 * falls back to fullAddress (which may be stored as just street in some systems).
 */
export function getAddressForMapLink(address: ResidentialAddressLike | null): string {
  if (!address) return ''
  const parts: string[] = []
  if (address.street) parts.push(address.street)
  const locality = address.suburb ?? address.city
  if (locality) parts.push(locality)
  if (address.state && address.postcode) {
    parts.push(`${address.state} ${address.postcode}`)
  } else if (address.state) {
    parts.push(address.state)
  } else if (address.postcode) {
    parts.push(address.postcode)
  }
  if (parts.length > 0) return parts.join(', ')
  return address.fullAddress ?? ''
}

/**
 * Build a Google Maps search URL for a given address string.
 * Opens in Maps with the address as the search query.
 */
export function getGoogleMapsUrl(address: string): string {
  if (!address.trim()) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`
}
