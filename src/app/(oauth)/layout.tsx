import React from 'react'
import styles from './oauth.module.css'

export const metadata = {
  title: 'Connect Claude to Billie CRM',
  robots: { index: false, follow: false },
}

/** Root layout for the OAuth sign-in page of the reporting MCP connector. */
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className={styles.body}>{children}</body>
    </html>
  )
}
