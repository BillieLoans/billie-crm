import { UNKNOWN_USER_FALLBACK } from '@/lib/constants'

/** The parts of a staff user a display name is made from. */
export interface StaffNameParts {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

/**
 * A staff member's name as records show it: "First Last", "First" without a
 * last name, else the email, else "Unknown User".
 */
export function staffDisplayName(user: StaffNameParts): string {
  if (user.firstName) {
    return `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
  }
  return user.email || UNKNOWN_USER_FALLBACK
}
