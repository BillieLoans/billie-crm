import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Remove X-Powered-By header to reduce fingerprinting surface
  poweredByHeader: false,

  // OAuth discovery for the reporting MCP connector (src/server/reporting/mcp-oauth.ts).
  // `:path*` matches the root documents and the path-inserted ones
  // (`/.well-known/oauth-protected-resource/api/mcp`).
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/authorization-server',
      },
    ]
  },

  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
