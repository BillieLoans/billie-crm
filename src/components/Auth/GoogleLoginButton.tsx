'use client'

import { useState } from 'react'

export const GoogleLoginButton = () => {
  const [loading, setLoading] = useState(false)

  const handleClick = () => {
    setLoading(true)
    window.location.href = '/api/auth/google'
  }

  return (
    <div style={{ width: '100%', marginTop: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ flex: 1, height: '1px', background: 'var(--theme-elevation-300)' }} />
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-elevation-500)' }}>or</span>
        <div style={{ flex: 1, height: '1px', background: 'var(--theme-elevation-300)' }} />
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--theme-text)',
          backgroundColor: 'var(--theme-elevation-100)',
          border: '1px solid var(--theme-elevation-300)',
          borderRadius: '4px',
          cursor: loading ? 'wait' : 'pointer',
          opacity: loading ? 0.7 : 1,
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!loading) e.currentTarget.style.backgroundColor = 'var(--theme-elevation-200)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--theme-elevation-100)'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4" />
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853" />
          <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" fill="#FBBC05" />
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58Z" fill="#EA4335" />
        </svg>
        {loading ? 'Redirecting...' : 'Sign in with Google'}
      </button>
    </div>
  )
}
