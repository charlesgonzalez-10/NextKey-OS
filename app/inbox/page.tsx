import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '../layout-dashboard'
import InboxClient from './inbox-client'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>
}) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const params = await searchParams
    const selectedContactId = params?.contact ?? null

    // Messages — fall back to empty if table doesn't exist yet
    let messages: { id: string; body: string; direction: string; status: string; created_at: string; contact_id: string }[] = []
    try {
      const { data } = await supabase
        .from('messages')
        .select('id, body, direction, status, created_at, contact_id')
        .order('created_at', { ascending: false })
      messages = (data ?? []).filter((m): m is NonNullable<typeof m> => m != null)
    } catch { /* table might not exist yet */ }

    // Unique contact IDs
    const contactIds = [...new Set(messages.filter(m => m?.contact_id).map(m => m.contact_id))]

    // Fetch contacts
    let contactMap: Record<string, { id: string; name: string; phone: string }> = {}
    if (contactIds.length > 0) {
      try {
        const { data } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .in('id', contactIds)
        contactMap = Object.fromEntries(
          (data ?? [])
            .filter((c): c is NonNullable<typeof c> => c != null && c.id != null)
            .map(c => [c.id, c])
        )
      } catch { /* ignore */ }
    }

    // Build conversation list (one per contact, latest message)
    const seen = new Set<string>()
    const convos: {
      contactId: string
      contactName: string
      contactPhone: string
      lastMessage: string
      lastDirection: string
      lastAt: string
      unread: boolean
    }[] = []

    for (const msg of messages) {
      if (!msg) continue
      const cid = msg.contact_id
      if (!cid || seen.has(cid)) continue
      seen.add(cid)
      const c = contactMap[cid]
      convos.push({
        contactId: cid,
        contactName: c?.name ?? 'Unknown',
        contactPhone: c?.phone ?? '',
        lastMessage: msg.body ?? '',
        lastDirection: msg.direction ?? '',
        lastAt: msg.created_at ?? new Date().toISOString(),
        unread: msg.direction === 'inbound',
      })
    }

    // Load thread for selected contact
    let thread: { id: string; direction: string; body: string; status: string; created_at: string }[] = []
    let selectedContact: { id: string; name: string; phone: string } | null = null

    if (selectedContactId) {
      try {
        const { data } = await supabase
          .from('messages')
          .select('id, direction, body, status, created_at')
          .eq('contact_id', selectedContactId)
          .order('created_at', { ascending: true })
        thread = (data ?? []).filter((m): m is NonNullable<typeof m> => m != null)
      } catch { /* ignore */ }

      try {
        const { data: c } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('id', selectedContactId)
          .single()
        selectedContact = c
      } catch { /* ignore */ }
    }

    return (
      <DashboardLayout>
        <InboxClient
          conversations={convos}
          selectedContactId={selectedContactId}
          selectedContact={selectedContact}
          thread={thread}
        />
      </DashboardLayout>
    )
  } catch (err) {
    // Surface the real error message instead of a generic crash
    throw err
  }
}
