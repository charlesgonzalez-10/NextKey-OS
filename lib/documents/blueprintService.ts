import { serviceClient } from '@/lib/supabase-service'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BuilderField {
  id: string            // equals field_key — stable across versions
  page: number
  x: number
  y: number
  w: number             // width (fractional, 0–1)
  h: number             // height (fractional, 0–1)
  variable: string      // e.g. '{{Contact.FullName}}'
  label: string
  defaultValue: string
  fontSize: number
  fieldType: string     // 'merge_text' | 'signature' | 'initial' | 'date' | etc.
  signerRoleId: string | null
  required: boolean
}

export interface BlueprintVersion {
  id: string
  blueprint_id: string
  version_number: number
  version_label: string
  changelog: string | null
  is_current: boolean
  published_at: string
  published_by: string | null
  created_at: string
}

export interface SignerRole {
  id: string
  role_name: string
  display_name: string
  category: string
  sort_order: number
  auto_suggest: string | null
  description: string | null
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function rowToBuilderField(row: Record<string, unknown>): BuilderField {
  const mk = row.merge_key ? String(row.merge_key) : ''
  const variable = mk ? (mk.startsWith('{{') ? mk : `{{${mk}}}`) : ''
  return {
    id:           String(row.field_key ?? row.id),
    page:         Number(row.page ?? 1),
    x:            Number(row.x ?? 0),
    y:            Number(row.y ?? 0),
    w:            Number(row.width ?? 0.22),
    h:            Number(row.height ?? 0.04),
    variable,
    label:        String(row.label ?? ''),
    defaultValue: '',
    fontSize:     Number(row.font_size ?? 11),
    fieldType:    String(row.field_type ?? 'merge_text'),
    signerRoleId: (row.signer_role_id as string | null) ?? null,
    required:     Boolean(row.required ?? false),
  }
}

function builderFieldToRow(
  field: BuilderField,
  blueprintId: string,
  sortOrder: number,
  userId?: string,
): Record<string, unknown> {
  const mergeKey = field.variable.replace(/^\{\{|\}\}$/g, '') || null
  return {
    blueprint_id:         blueprintId,
    blueprint_version_id: null,
    field_key:            field.id,
    field_type:           field.fieldType || 'merge_text',
    page:                 field.page,
    x:                    field.x,
    y:                    field.y,
    width:                field.w,
    height:               field.h,
    merge_key:            mergeKey,
    label:                field.label || null,
    font_size:            field.fontSize || 11,
    sort_order:           sortOrder,
    signer_role_id:       field.signerRoleId || null,
    required:             field.required ?? false,
    ai_source:            'manual',
    created_by:           userId ?? null,
    last_modified_by:     userId ?? null,
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const BlueprintService = {

  async getBlueprint(id: string) {
    const { data, error } = await serviceClient
      .from('contract_templates')
      .select('id, name, description, category, file_path, page_count, is_archived, current_version_id, created_at, updated_at')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async getBlueprintVersions(blueprintId: string): Promise<BlueprintVersion[]> {
    const { data, error } = await serviceClient
      .from('blueprint_versions')
      .select('*')
      .eq('blueprint_id', blueprintId)
      .order('version_number', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as BlueprintVersion[]
  },

  async getDraftFields(blueprintId: string): Promise<BuilderField[]> {
    const { data, error } = await serviceClient
      .from('template_fields')
      .select('*')
      .eq('blueprint_id', blueprintId)
      .is('blueprint_version_id', null)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => rowToBuilderField(r as Record<string, unknown>))
  },

  async getVersionFields(versionId: string): Promise<BuilderField[]> {
    const { data, error } = await serviceClient
      .from('template_fields')
      .select('*')
      .eq('blueprint_version_id', versionId)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => rowToBuilderField(r as Record<string, unknown>))
  },

  async syncDraftFields(
    blueprintId: string,
    fields: BuilderField[],
    userId?: string,
  ): Promise<BuilderField[]> {
    const { error: delErr } = await serviceClient
      .from('template_fields')
      .delete()
      .eq('blueprint_id', blueprintId)
      .is('blueprint_version_id', null)
    if (delErr) throw new Error(delErr.message)

    if (fields.length === 0) return []

    const rows = fields.map((f, i) => builderFieldToRow(f, blueprintId, i, userId))

    const { data, error } = await serviceClient
      .from('template_fields')
      .insert(rows)
      .select('*')
    if (error) throw new Error(error.message)
    return (data ?? []).map(r => rowToBuilderField(r as Record<string, unknown>))
  },

  async publishVersion(
    blueprintId: string,
    changelog: string | null,
    userId?: string,
  ): Promise<BlueprintVersion> {
    // Determine next version number
    const { data: maxRow } = await serviceClient
      .from('blueprint_versions')
      .select('version_number')
      .eq('blueprint_id', blueprintId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextNumber = (maxRow?.version_number ?? 0) + 1

    // Unset is_current on all existing versions
    await serviceClient
      .from('blueprint_versions')
      .update({ is_current: false })
      .eq('blueprint_id', blueprintId)

    // Create the new version row
    const { data: version, error: vErr } = await serviceClient
      .from('blueprint_versions')
      .insert({
        blueprint_id:   blueprintId,
        version_number: nextNumber,
        version_label:  `v${nextNumber}.0`,
        changelog:      changelog ?? null,
        is_current:     true,
        published_at:   new Date().toISOString(),
        published_by:   userId ?? null,
      })
      .select('*')
      .single()
    if (vErr || !version) throw new Error(vErr?.message ?? 'Failed to create version')

    // Copy draft fields → published (same field_key, new blueprint_version_id)
    const { data: drafts, error: dErr } = await serviceClient
      .from('template_fields')
      .select('*')
      .eq('blueprint_id', blueprintId)
      .is('blueprint_version_id', null)
    if (dErr) throw new Error(dErr.message)

    if (drafts && drafts.length > 0) {
      const published = drafts.map(({ id: _id, blueprint_version_id: _bv, created_at: _ca, updated_at: _ua, ...rest }) => ({
        ...rest,
        blueprint_version_id: version.id,
        last_modified_by:     userId ?? rest.last_modified_by,
      }))
      const { error: insErr } = await serviceClient
        .from('template_fields')
        .insert(published)
      if (insErr) throw new Error(insErr.message)
    }

    // Point contract_templates to the new version
    await serviceClient
      .from('contract_templates')
      .update({ current_version_id: version.id })
      .eq('id', blueprintId)

    return version as unknown as BlueprintVersion
  },

  async getRoles(): Promise<SignerRole[]> {
    const { data, error } = await serviceClient
      .from('signer_roles')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as SignerRole[]
  },
}
