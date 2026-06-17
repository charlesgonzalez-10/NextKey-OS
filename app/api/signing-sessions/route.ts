import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp         = req.nextUrl.searchParams
  const propertyId = sp.get('property_id')
  const docIds     = sp.get('document_ids')  // comma-separated list

  let query = serviceClient
    .from('signing_sessions')
    .select('id, title, status, document_id, signers, fields, created_at, completed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (propertyId) query = query.eq('property_id', propertyId)
  if (docIds) {
    const ids = docIds.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length) query = query.in('document_id', ids)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach live signer statuses
  const sessionIds = (data ?? []).map(s => s.id)
  let signerRows: Record<string, { status: string; signer_ref_id: string }[]> = {}
  if (sessionIds.length) {
    const { data: ss } = await serviceClient
      .from('session_signers')
      .select('session_id, signer_ref_id, status')
      .in('session_id', sessionIds)
    if (ss) {
      for (const row of ss) {
        if (!signerRows[row.session_id]) signerRows[row.session_id] = []
        signerRows[row.session_id].push(row)
      }
    }
  }

  const enriched = (data ?? []).map(s => ({
    ...s,
    signer_statuses: signerRows[s.id] ?? [],
  }))

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, pdf_path, fields, signers, property_id, lead_id, contact_id, deal_id, document_id } = body

  if (!title || !pdf_path) return NextResponse.json({ error: 'title and pdf_path required' }, { status: 400 })

  const { data, error } = await serviceClient
    .from('signing_sessions')
    .insert({
      user_id:     user.id,
      title,
      pdf_path,
      fields:      fields      ?? [],
      signers:     signers     ?? [],
      property_id: property_id ?? null,
      lead_id:     lead_id     ?? null,
      contact_id:  contact_id  ?? null,
      deal_id:     deal_id     ?? null,
      document_id: document_id ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
