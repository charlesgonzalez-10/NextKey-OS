import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: 6,
        }}
      >
        <span
          style={{
            color: '#C9A84C',
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '-0.5px',
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
