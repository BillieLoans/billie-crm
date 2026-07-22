import Image from 'next/image'
import React from 'react'

import billieLogo from './billie_logo.png'

/**
 * Custom admin logo shown on the Payload login / create-first-user screens,
 * replacing Payload's default wordmark. Registered via
 * `admin.components.graphics.Logo` in payload.config.ts.
 *
 * Uses a static image import (processed into `.next/static`, which the Docker
 * build copies) rather than a `public/` asset — this project ships no `public/`
 * folder in its standalone image.
 */
export const BillieLogo: React.FC = () => (
  <Image
    alt="Billie"
    height={80}
    priority
    src={billieLogo}
    style={{ height: 'auto', maxWidth: '220px', width: '100%' }}
    width={200}
  />
)
