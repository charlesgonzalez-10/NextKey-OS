import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: pipelines, error } = await serviceClient
    .from('pipelines')
    .select(`
      *,
      pipeline_stages (
        id, name, position, color, probability, is_closed_won, is_closed_lost
      )
    `)
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sort stages within each pipeline
  const result = (pipelines ?? []).map(p => ({
    ...p,
    pipeline_stages: (p.pipeline_stages ?? []).sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    ),
  }))

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getUserProfile(user.id)
  if (!canAccessAdmin(profile, user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const { data: maxPos } = await serviceClient
    .from('pipelines')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const { data: pipeline, error } = await serviceClient
    .from('pipelines')
    .insert({
      name:        body.name.trim(),
      description: body.description ?? null,
      vertical_id: body.vertical_id ?? null,
      is_default:  body.is_default ?? false,
      is_active:   body.is_active ?? true,
      position:    (maxPos?.position ?? 0) + 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create default stages if provided
  if (body.stages?.length) {
    const stageRows = body.stages.map((s: { name: string; color?: string; probability?: number }, i: number) => ({
      pipeline_id:     pipeline.id,
      name:            s.name,
      position:        i + 1,
      color:           s.color ?? '#6B7280',
      probability:     s.probability ?? 0,
      is_closed_won:   false,
      is_closed_lost:  false,
    }))
    await serviceClient.from('pipeline_stages').insert(stageRows)
  }

  // Return pipeline with stages
  const { data: full } = await serviceClient
    .from('pipelines')
    .select('*, pipeline_stages(*)')
    .eq('id', pipeline.id)
    .single()

  return NextResponse.json(full)
}
