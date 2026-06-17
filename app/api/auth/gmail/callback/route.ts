import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCode, storeTokens, getOAuth2Client } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002'

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings?gmail_error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?gmail_error=missing_params`)
  }

  const storedState = req.cookies.get('gmail_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${appUrl}/settings?gmail_error=state_mismatch`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  try {
    const tokens = await exchangeCode(code)

    let email: string | undefined
    if (tokens.access_token) {
      try {
        const oauth2 = getOAuth2Client()
        oauth2.setCredentials({ access_token: tokens.access_token })
        const oauth2Api = (await import('googleapis')).google.oauth2({ version: 'v2', auth: oauth2 })
        const { data } = await oauth2Api.userinfo.get()
        email = data.email ?? undefined
      } catch {}
    }

    await storeTokens(user.id, {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date:   tokens.expiry_date,
      email,
      scope:         tokens.scope ?? undefined,
    })

    const res = NextResponse.redirect(`${appUrl}/settings?gmail_connected=1`)
    res.cookies.delete('gmail_oauth_state')
    return res
  } catch (err) {
    console.error('Gmail OAuth callback error:', err)
    return NextResponse.redirect(`${appUrl}/settings?gmail_error=token_exchange_failed`)
  }
}
