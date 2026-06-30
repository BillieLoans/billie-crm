import React from 'react'

/**
 * Custom logout button that replaces Payload's built-in one.
 *
 * Points at the CRM's custom logout route (/api/auth/logout) instead of
 * Payload's /admin/logout. The custom route deterministically expires the
 * `payload-token` cookie set by the Google OAuth callback — Payload's built-in
 * client `logOut()` swallows POST failures and redirects regardless, which can
 * leave the session cookie alive (the "logout returns to dashboard" bug).
 *
 * Rendered as a plain <a> (not a client-routed Link) so the click performs a
 * full top-level navigation that hits the route handler, follows its redirect,
 * and applies the cookie-clearing Set-Cookie. Reuses the default button's
 * `nav__log-out` class and icon markup so it looks identical in the sidebar.
 *
 * Registered via admin.components.logout.Button in payload.config.ts.
 */
export function LogoutButton({ tabIndex = 0 }: { tabIndex?: number }) {
  return (
    // A plain <a> is intentional: /api/auth/logout is a route handler, not a
    // page, and we need a full top-level navigation so the browser hits it,
    // follows the redirect, and applies the cookie-clearing Set-Cookie. next/link
    // would do a client-side transition and never run the handler.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      aria-label="Log out"
      className="nav__log-out"
      href="/api/auth/logout"
      tabIndex={tabIndex}
      title="Log out"
    >
      <svg
        className="icon icon--logout"
        fill="none"
        height="20"
        viewBox="0 0 20 20"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="stroke"
          d="M12 16H14.6667C15.0203 16 15.3594 15.8595 15.6095 15.6095C15.8595 15.3594 16 15.0203 16 14.6667V5.33333C16 4.97971 15.8595 4.64057 15.6095 4.39052C15.3594 4.14048 15.0203 4 14.6667 4H12M7.33333 13.3333L4 10M4 10L7.33333 6.66667M4 10H12"
          strokeLinecap="square"
        />
      </svg>
    </a>
  )
}

export default LogoutButton
