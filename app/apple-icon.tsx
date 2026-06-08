import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0A1F44',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 40,
        }}
      >
        <span
          style={{
            color: '#C9A84C',
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: '-2px',
            fontFamily: 'sans-serif',
          }}
        >
          NK
        </span>
      </div>
    ),
    { ...size }
  )
}
