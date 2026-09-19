/**
 * BlueprintService tests.
 * Verifies atomic draft-field sync and version schema correctness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase-service', () => ({
  serviceClient: {
    from:  vi.fn(),
    rpc:   vi.fn(),
  },
}))

import { serviceClient } from '@/lib/supabase-service'
import { BlueprintService, type BuilderField } from '@/lib/documents/blueprintService'

const BLUEPRINT_ID = 'bp-111'
const USER_ID      = 'user-a'

const sampleFields: BuilderField[] = [
  { id: 'f1', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.04, variable: '{{Contact.FullName}}', label: 'Full Name', defaultValue: '', fontSize: 11, fieldType: 'merge_text', signerRoleId: null, required: true },
  { id: 'f2', page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.04, variable: '{{Property.State}}',   label: 'State',     defaultValue: '', fontSize: 11, fieldType: 'merge_text', signerRoleId: null, required: false },
]

function makeChain(result: unknown) {
  const c: Record<string, unknown> = {}
  const meths = ['select','insert','update','eq','in','is','single','maybeSingle','order','limit']
  for (const m of meths) c[m] = vi.fn(() => c)
  return Object.assign(c, result)
}

beforeEach(() => { vi.clearAllMocks() })

describe('syncDraftFields — atomicity via RPC', () => {
  it('calls rpc sync_blueprint_draft_fields, never from(template_fields).delete', async () => {
    ;(serviceClient.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: sampleFields.map((f, i) => ({
        id: `row-${i}`, field_key: f.id, blueprint_id: BLUEPRINT_ID, blueprint_version_id: null,
        merge_key: f.variable.replace(/^\{\{|\}\}$/g, ''), label: f.label, field_type: f.fieldType,
        page: f.page, x: f.x, y: f.y, width: f.w, height: f.h, font_size: f.fontSize,
        sort_order: i, signer_role_id: null, required: f.required,
      })),
      error: null,
    })

    const result = await BlueprintService.syncDraftFields(BLUEPRINT_ID, sampleFields, USER_ID)

    expect(serviceClient.rpc).toHaveBeenCalledWith('sync_blueprint_draft_fields', expect.objectContaining({
      p_blueprint_id: BLUEPRINT_ID,
    }))
    expect(serviceClient.from).not.toHaveBeenCalled()
    expect(result).toHaveLength(2)
  })

  it('propagates RPC errors', async () => {
    ;(serviceClient.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null, error: { message: 'RPC failed' },
    })

    await expect(BlueprintService.syncDraftFields(BLUEPRINT_ID, sampleFields, USER_ID))
      .rejects.toThrow('RPC failed')
  })
})

describe('publishVersion — schema correctness', () => {
  it('does NOT insert version_label (column does not exist)', async () => {
    const fromCalls: string[] = []
    let insertPayload: unknown = null

    ;(serviceClient.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      fromCalls.push(table)
      if (table === 'blueprint_versions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { version_number: 2 }, error: null }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          insert: vi.fn().mockImplementation((payload: unknown) => {
            insertPayload = payload
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'v-new', blueprint_id: BLUEPRINT_ID, version_number: 3, changelog: null, is_current: true, published_at: new Date().toISOString(), published_by: USER_ID, field_count: 0, group_count: 0 },
                  error: null,
                }),
              }),
            }
          }),
        }
      }
      if (table === 'template_fields') {
        return makeChain({ data: [], error: null })
      }
      if (table === 'contract_templates') {
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }
      }
      return makeChain({ data: null, error: null })
    })

    await BlueprintService.publishVersion(BLUEPRINT_ID, 'Test changelog', USER_ID)

    expect(insertPayload).not.toBeNull()
    expect(insertPayload).not.toHaveProperty('version_label')
    expect(insertPayload).toHaveProperty('version_number')
    expect(insertPayload).toHaveProperty('is_current', true)
  })
})
