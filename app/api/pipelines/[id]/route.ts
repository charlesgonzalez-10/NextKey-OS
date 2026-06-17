import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase-service'
import { getUserProfile, canAccessAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

async function requireAdmin(user: { id: string; email?: string }) {
  const profile = await getUserProfile(user.id)
  return canAccessAdmin(profile, user.email)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data, error } = await serviceClient
    .from('pipelines')
    .select('*, pipeline_stages(*)')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  const result = {
    ...data,
    pipeline_stages: (data.pipeline_stages ?? []).sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    ),
  }
  return NextResponse.json(result)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const pipelineUpdates: Record<string, unknown> = {}
  if (body.name        !== undefined) pipelineUpdates.name        = body.name.trim()
  if (body.description !== undefined) pipelineUpdates.description = body.description
  if (body.vertical_id !== undefined) pipelineUpdates.vertical_id = body.vertical_id
  if (body.is_default  !== undefined) pipelineUpdates.is_default  = body.is_default
  if (body.is_active   !== undefined) pipelineUpdates.is_active   = body.is_active
  if (body.position    !== undefined) pipelineUpdates.position    = body.position

  if (Object.keys(pipelineUpdates).length > 0) {
    const { error } = await serviceClient
      .from('pipelines')
      .update(pipelineUpdates)
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Handle stage upserts if provided
  if (body.stages) {
    for (const stage of body.stages) {
      if (stage.id) {
        // Update existing stage
        const stageUpdates: Record<string, unknown> = {}
        if (stage.name         !== undefined) stageUpdates.name         = stage.name
        if (stage.position     !== undefined) stageUpdates.position     = stage.position
        if (stage.color        !== undefined) stageUpdates.color        = stage.color
        if (stage.probability  !== undefined) stageUpdates.probability  = stage.probability
        if (stage.is_closed_won  !== undefined) stageUpdates.is_closed_won  = stage.is_closed_won
        if (stage.is_closed_lost !== undefined) stageUpdates.is_closed_lost = stage.is_closed_lost
        await serviceClient.from('pipeline_stages').update(stageUpdates).eq('id', stage.id)
      } else {
        // Insert new stage
        await serviceClient.from('pipeline_stages').insert({
          pipeline_id:    id,
          name:           stage.name,
          position:       stage.position ?? 999,
          color:          stage.color ?? '#6B7280',
          probability:    stage.probability ?? 0,
          is_closed_won:  stage.is_closed_won ?? false,
          is_closed_lost: stage.is_closed_lost ?? false,
        })
      }
    }
  }

  // Delete stages if requested
  if (body.delete_stage_ids?.length) {
    await serviceClient
      .from('pipeline_stages')
      .delete()
      .in('id', body.delete_stage_ids)
  }

  const { data } = await serviceClient
    .from('pipelines')
    .select('*, pipeline_stages(*)')
    .eq('id', id)
    .single()

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await requireAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Delete stages first (or rely on CASCADE if configured)
  await serviceClient.from('pipeline_stages').delete().eq('pipeline_id', id)
  const { error } = await serviceClient.from('pipelines').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
