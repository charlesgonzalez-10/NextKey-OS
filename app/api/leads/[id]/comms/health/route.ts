/**
 * GET /api/leads/[id]/comms/health
 *
 * Returns communication health metrics for a lead:
 *   emails sent, sms sent, calls logged, last contact date,
 *   next follow-up, open rate (estimated), response rate
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params

  const [notesRes, commsRes, scheduledRes] = await Promise.all([
    serviceClient
      .from('lead_notes')
      .select('id, note_type, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),

    serviceClient
      .from('communications')
      .select('id, type, direction, status, sent_at, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),

    serviceClient
      .from('lead_scheduled')
      .select('id, type, title, scheduled_at, status')
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(5),
  ])

  const notes = notesRes.data ?? []
  const comms = commsRes.data ?? []
  const scheduled = scheduledRes.data ?? []

  // Count by type from notes
  const callCount   = notes.filter(n => n.note_type === 'call_log').length
  const smsLogCount = notes.filter(n => n.note_type === 'sms_log').length
  const emailLogCount = notes.filter(n => n.note_type === 'email_log').length

  // Count from communications table
  const emailsSent = comms.filter(c => c.type === 'email' && c.direction === 'outbound').length
  const smsSent    = comms.filter(c => c.type === 'sms'   && c.direction === 'outbound').length
  const emailsReceived = comms.filter(c => c.type === 'email' && c.direction === 'inbound').length

  const totalCalls  = callCount
  const totalEmails = emailsSent + emailLogCount
  const totalSMS    = smsSent + smsLogCount

  // Last contact timestamp
  const allTimestamps = [
    ...notes.map(n => n.created_at),
    ...comms.map(c => c.sent_at ?? c.created_at),
  ].filter(Boolean).sort().reverse()
  const lastContact = allTimestamps[0] ?? null

  // Response / open rate (rough estimates from status fields)
  const emailsWithStatus = comms.filter(c => c.type === 'email' && c.direction === 'outbound')
  const emailsRead       = emailsWithStatus.filter(c => c.status === 'read').length
  const openRate         = emailsWithStatus.length > 0 ? Math.round((emailsRead / emailsWithStatus.length) * 100) : null
  const responseRate     = totalEmails > 0 ? Math.round((emailsReceived / totalEmails) * 100) : null

  // Days since last contact
  const daysSince = lastContact
    ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86_400_000)
    : null

  // AI recommendation
  let recommendation = ''
  if (daysSince === null) {
    recommendation = 'No contact logged. Send an initial outreach email or SMS.'
  } else if (daysSince > 14) {
    recommendation = `No contact in ${daysSince} days. Follow up now — leads go cold quickly.`
  } else if (daysSince > 7) {
    recommendation = `Last contact ${daysSince} days ago. Consider a check-in SMS.`
  } else if (totalCalls === 0 && totalEmails > 0) {
    recommendation = 'Emails sent but no calls logged. Try a phone call — it converts better.'
  } else if (totalEmails === 0 && totalCalls > 0) {
    recommendation = 'Calls logged but no emails sent. Follow up in writing.'
  } else {
    recommendation = 'Communication looks active. Keep the momentum going.'
  }

  return NextResponse.json({
    emails_sent:     totalEmails,
    sms_sent:        totalSMS,
    calls:           totalCalls,
    emails_received: emailsReceived,
    open_rate:       openRate,
    response_rate:   responseRate,
    last_contact:    lastContact,
    days_since:      daysSince,
    next_follow_ups: scheduled,
    recommendation,
    total_interactions: notes.length + comms.length,
  })
}
