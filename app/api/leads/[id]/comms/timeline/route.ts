/**
 * GET /api/leads/[id]/comms/timeline
 *
 * Returns a unified chronological timeline for a lead:
 *   - lead_notes (call logs, sms logs, email logs, notes, tasks)
 *   - communications (Gmail emails, logged comms)
 *   - messages (Twilio SMS — for linked contacts)
 *   - tasks (lead tasks)
 *
 * Response: { events: TimelineEvent[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: leadId } = await params
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10)

  const [notesRes, commsRes, tasksRes] = await Promise.all([
    // Notes — all types (call_log, sms_log, email_log, note, task)
    serviceClient
      .from('lead_notes')
      .select('id, body, author, note_type, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(limit),

    // Communications — linked emails/SMS sent via send routes
    serviceClient
      .from('communications')
      .select('id, type, direction, subject, body_preview, from_email, to_email, status, sent_at, created_at, thread_id')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50),

    // Tasks linked to this lead
    serviceClient
      .from('tasks')
      .select('id, title, description, due_date, priority, status, completed_at, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // Merge and sort all events chronologically
  const events: {
    id: string
    event_type: string
    subtype: string
    title: string
    body: string | null
    author: string | null
    direction: string | null
    status: string | null
    thread_id: string | null
    due_date: string | null
    priority: string | null
    completed: boolean
    timestamp: string
    source: string
  }[] = []

  // Notes
  for (const n of notesRes.data ?? []) {
    events.push({
      id:         n.id,
      event_type: 'note',
      subtype:    n.note_type ?? 'note',
      title:      noteTitle(n.note_type ?? 'note'),
      body:       n.body,
      author:     n.author,
      direction:  null,
      status:     null,
      thread_id:  null,
      due_date:   null,
      priority:   null,
      completed:  false,
      timestamp:  n.created_at,
      source:     'lead_notes',
    })
  }

  // Communications
  for (const c of commsRes.data ?? []) {
    events.push({
      id:         c.id,
      event_type: c.type === 'email' ? 'email' : c.type === 'sms' ? 'sms' : c.type,
      subtype:    c.direction ?? 'outbound',
      title:      c.subject ?? commTitle(c.type, c.direction),
      body:       c.body_preview,
      author:     c.from_email,
      direction:  c.direction,
      status:     c.status,
      thread_id:  c.thread_id,
      due_date:   null,
      priority:   null,
      completed:  false,
      timestamp:  c.sent_at ?? c.created_at,
      source:     'communications',
    })
  }

  // Tasks
  for (const t of tasksRes.data ?? []) {
    events.push({
      id:         t.id,
      event_type: 'task',
      subtype:    t.status,
      title:      t.title,
      body:       t.description,
      author:     null,
      direction:  null,
      status:     t.status,
      thread_id:  null,
      due_date:   t.due_date,
      priority:   t.priority,
      completed:  t.status === 'completed',
      timestamp:  t.completed_at ?? t.created_at,
      source:     'tasks',
    })
  }

  // Sort descending by timestamp
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return NextResponse.json({ events: events.slice(0, limit) })
}

function noteTitle(type: string): string {
  switch (type) {
    case 'call_log':   return 'Call Logged'
    case 'sms_log':    return 'SMS Logged'
    case 'email_log':  return 'Email Logged'
    case 'task':       return 'Task Note'
    default:           return 'Note'
  }
}

function commTitle(type: string, direction: string | null): string {
  const dir = direction === 'inbound' ? 'Received' : 'Sent'
  switch (type) {
    case 'email': return `Email ${dir}`
    case 'sms':   return `SMS ${dir}`
    case 'call':  return `Call ${dir}`
    default:      return `${type} ${dir}`
  }
}
