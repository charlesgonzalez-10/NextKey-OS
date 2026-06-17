import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'
import twilio from 'twilio'

export const dynamic = 'force-dynamic'

async function getDbStats() {
  const tables = [
    'contacts', 'deals', 'leads', 'properties',
    'scraper_leads', 'messages', 'communications',
    'distress_filings', 'search_cache', 'oauth_tokens',
  ] as const

  const counts: Record<string, number> = {}
  await Promise.all(tables.map(async (t) => {
    const { count } = await serviceClient.from(t).select('*', { count: 'exact', head: true })
    counts[t] = count ?? 0
  }))

  // Cache breakdown
  const { count: validCache } = await serviceClient
    .from('search_cache')
    .select('*', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString())

  const { count: expiredCache } = await serviceClient
    .from('search_cache')
    .select('*', { count: 'exact', head: true })
    .lt('expires_at', new Date().toISOString())

  return { ...counts, cache_valid: validCache ?? 0, cache_expired: expiredCache ?? 0 }
}

async function getTwilioStats() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null

  try {
    const client = twilio(sid, token)
    const [todayRecords, monthRecords] = await Promise.all([
      client.usage.records.today.list({ limit: 50 }),
      client.usage.records.thisMonth.list({ limit: 50 }),
    ])

    type UsageRecord = { category: string; count: string; price: string }
    const pick = (records: UsageRecord[], cat: string) => {
      const r = records.find(x => x.category === cat)
      return { count: parseInt(String(r?.count ?? '0'), 10), cost: parseFloat(String(r?.price ?? '0')) }
    }
    const sumCost = (records: UsageRecord[]) =>
      records.reduce((s, r) => s + parseFloat(String(r.price ?? '0')), 0)

    const today = todayRecords as unknown as UsageRecord[]
    const month = monthRecords as unknown as UsageRecord[]

    return {
      sms_outbound_today:  pick(today, 'sms-outbound'),
      sms_inbound_today:   pick(today, 'sms-inbound'),
      sms_outbound_month:  pick(month, 'sms-outbound'),
      sms_inbound_month:   pick(month, 'sms-inbound'),
      calls_today:         pick(today, 'calls'),
      total_cost_today:    sumCost(today),
      total_cost_month:    sumCost(month),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed' }
  }
}

async function getJobStats() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString()

  const [lastEnrich, enrichedToday, lastIngestion, ingestedToday, recentFailed] = await Promise.all([
    serviceClient.from('scraper_leads').select('enriched_at').not('enriched_at', 'is', null)
      .order('enriched_at', { ascending: false }).limit(1).single(),
    serviceClient.from('scraper_leads').select('*', { count: 'exact', head: true })
      .gte('enriched_at', todayIso),
    serviceClient.from('distress_filings').select('created_at')
      .order('created_at', { ascending: false }).limit(1).single(),
    serviceClient.from('distress_filings').select('*', { count: 'exact', head: true })
      .gte('created_at', todayIso),
    serviceClient.from('messages').select('*', { count: 'exact', head: true })
      .eq('status', 'failed').gte('created_at', todayIso),
  ])

  return {
    last_enrichment:      lastEnrich.data?.enriched_at ?? null,
    enriched_today:       enrichedToday.count ?? 0,
    last_distress_ingest: lastIngestion.data?.created_at ?? null,
    distress_today:       ingestedToday.count ?? 0,
    failed_sms_today:     recentFailed.count ?? 0,
  }
}

async function getGmailStatus() {
  const { data } = await serviceClient
    .from('oauth_tokens')
    .select('email, expires_at, updated_at, scope')
    .eq('provider', 'gmail')
    .limit(5)
  return data ?? []
}

async function getMessageStats() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [totalOut, totalIn, failed, aiReplies] = await Promise.all([
    serviceClient.from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'outbound').gte('created_at', thirtyDaysAgo),
    serviceClient.from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'inbound').gte('created_at', thirtyDaysAgo),
    serviceClient.from('messages').select('*', { count: 'exact', head: true })
      .eq('status', 'failed').gte('created_at', thirtyDaysAgo),
    serviceClient.from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'outbound').like('body', '%[AI]%').gte('created_at', thirtyDaysAgo),
  ])

  return {
    outbound_30d: totalOut.count ?? 0,
    inbound_30d:  totalIn.count ?? 0,
    failed_30d:   failed.count ?? 0,
    ai_replies_30d: aiReplies.count ?? 0,
  }
}

function getEnvStatus() {
  return {
    supabase:        !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    twilio:          !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    anthropic:       !!process.env.ANTHROPIC_API_KEY,
    reapi:           !!process.env.REAPI_KEY,
    rentcast:        !!process.env.RENTCAST_API_KEY,
    google_maps:     !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    gmail_oauth:     !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    oauth_encrypt:   !!process.env.OAUTH_ENCRYPT_KEY,
    cron_secret:     !!process.env.CRON_SECRET,
    twocaptcha:      !!process.env.TWOCAPTCHA_API_KEY,
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [db, twilio, jobs, gmail, sms] = await Promise.allSettled([
    getDbStats(),
    getTwilioStats(),
    getJobStats(),
    getGmailStatus(),
    getMessageStats(),
  ])

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    db:    db.status    === 'fulfilled' ? db.value    : { error: 'Failed' },
    twilio: twilio.status === 'fulfilled' ? twilio.value : { error: 'Failed' },
    jobs:  jobs.status  === 'fulfilled' ? jobs.value  : { error: 'Failed' },
    gmail: gmail.status === 'fulfilled' ? gmail.value : [],
    sms:   sms.status   === 'fulfilled' ? sms.value   : { error: 'Failed' },
    env:   getEnvStatus(),
  })
}
