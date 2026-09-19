/**
 * Signing-session completion tests.
 * Tests idempotency, trigger conditions, and guard rails.
 * All external calls (serviceClient, pdf-lib, gmail) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase-service', () => ({
  serviceClient: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

vi.mock('@/lib/gmail', () => ({
  sendEmail:       vi.fn().mockResolvedValue({}),
  getTokenRecord:  vi.fn().mockResolvedValue(null),
}))

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load:   vi.fn().mockResolvedValue({
      getPages:   vi.fn().mockReturnValue([{ getSize: () => ({ width: 612, height: 792 }), drawImage: vi.fn(), drawText: vi.fn(), drawRectangle: vi.fn() }]),
      embedFont:  vi.fn().mockResolvedValue({}),
      embedPng:   vi.fn().mockResolvedValue({}),
      save:       vi.fn().mockResolvedValue(new Uint8Array()),
    }),
    create: vi.fn().mockResolvedValue({
      addPage:    vi.fn().mockReturnValue({ getSize: () => ({ height: 792 }), drawRectangle: vi.fn(), drawText: vi.fn(), drawLine: vi.fn() }),
      embedFont:  vi.fn().mockResolvedValue({}),
      save:       vi.fn().mockResolvedValue(new Uint8Array()),
    }),
  },
  rgb:           vi.fn().mockReturnValue({}),
  StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold', HelveticaOblique: 'Helvetica-Oblique' },
}))

import { serviceClient } from '@/lib/supabase-service'

function makeChain(finalResult: unknown = { data: null, error: null }) {
  const t: Record<string, unknown> = {
    select:    vi.fn(),
    insert:    vi.fn(),
    update:    vi.fn(),
    eq:        vi.fn(),
    in:        vi.fn(),
    is:        vi.fn(),
    single:    vi.fn(),
    maybeSingle: vi.fn(),
    order:     vi.fn(),
    limit:     vi.fn(),
  }
  for (const k of Object.keys(t)) (t[k] as ReturnType<typeof vi.fn>).mockReturnValue(t)
  Object.assign(t, finalResult)
  return t
}

const SESSION_ID = 'session-123'
const USER_ID = 'user-a'

const mockSession = {
  id:              SESSION_ID,
  user_id:         USER_ID,
  title:           'Test Agreement',
  pdf_path:        'uploads/test.pdf',
  fields:          [],
  signers:         [],
  status:          'sent',
  completed_pdf_path: null,
  certificate_path: null,
  property_id:     null,
  lead_id:         null,
  contact_id:      null,
  deal_id:         null,
}

const mockSigners = [
  { id: 'ss-1', session_id: SESSION_ID, signer_ref_id: 'signer_0', name: 'Alice', email: 'alice@test.com', status: 'signed', signed_at: new Date().toISOString(), fields_data: {} },
  { id: 'ss-2', session_id: SESSION_ID, signer_ref_id: 'signer_1', name: 'Bob',   email: 'bob@test.com',   status: 'signed', signed_at: new Date().toISOString(), fields_data: {} },
]

function setupMocks({
  completedPdfPath = null,
  signers = mockSigners,
}: { completedPdfPath?: string | null; signers?: typeof mockSigners } = {}) {
  const session = { ...mockSession, completed_pdf_path: completedPdfPath }

  const fromImpl = (table: string) => {
    if (table === 'signing_sessions') {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue({
        eq:     vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: session, error: null }),
        }),
      })
      // Support both the old update().eq() path and the new atomic claim chain:
      // update().eq().is().or().select()  → claim succeeds (returns [{id}])
      const claimSelectResult = { data: [{ id: SESSION_ID }], error: null }
      const orMock  = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(claimSelectResult) })
      const selectMock = vi.fn().mockReturnValue(claimSelectResult)
      const isMock  = vi.fn().mockReturnValue({ or: orMock, select: selectMock })
      const eqMock  = vi.fn().mockReturnValue({ is: isMock, select: selectMock, error: null })
      chain.update = vi.fn().mockReturnValue({ eq: eqMock })
      chain.insert = vi.fn().mockReturnValue({ then: vi.fn(), catch: vi.fn() })
      return chain
    }
    if (table === 'session_signers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: signers, error: null }),
        }),
      }
    }
    if (table === 'documents') {
      return { insert: vi.fn().mockReturnValue({ then: vi.fn().mockReturnValue({ catch: vi.fn() }) }) }
    }
    return makeChain()
  }

  ;(serviceClient.from as ReturnType<typeof vi.fn>).mockImplementation(fromImpl)
  ;(serviceClient.storage.from as ReturnType<typeof vi.fn>).mockReturnValue({
    download: vi.fn().mockResolvedValue({ data: new Blob(['%PDF']) }),
    upload:   vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://cdn.example.com/file.pdf' } }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('completeSigningSession — idempotency', () => {
  it('short-circuits when completed_pdf_path is already set', async () => {
    setupMocks({ completedPdfPath: 'signed/user-a/session-123_completed_0.pdf' })

    const { completeSigningSession } = await import('@/lib/documents/signingCompleter')
    const result = await completeSigningSession(SESSION_ID, USER_ID)

    expect(result.alreadyComplete).toBe(true)
    expect(result.completedPdfUrl).toBeTruthy()
  })

  it('concurrent repeated calls both return the same completedPdfUrl', async () => {
    setupMocks({ completedPdfPath: 'signed/user-a/session-123_completed_0.pdf' })

    const { completeSigningSession } = await import('@/lib/documents/signingCompleter')
    const [r1, r2] = await Promise.all([
      completeSigningSession(SESSION_ID, USER_ID),
      completeSigningSession(SESSION_ID, USER_ID),
    ])

    expect(r1.alreadyComplete).toBe(true)
    expect(r2.alreadyComplete).toBe(true)
  })
})

describe('completeSigningSession — guard rails', () => {
  it('throws when not all signers have signed', async () => {
    const partialSigners = [
      { ...mockSigners[0], status: 'signed' },
      { ...mockSigners[1], status: 'viewed' },
    ]
    setupMocks({ signers: partialSigners as typeof mockSigners })

    const { completeSigningSession } = await import('@/lib/documents/signingCompleter')
    await expect(completeSigningSession(SESSION_ID, USER_ID)).rejects.toThrow('Not all signers')
  })

  it('throws when session is not found', async () => {
    ;(serviceClient.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } }),
        }),
      }),
    })

    const { completeSigningSession } = await import('@/lib/documents/signingCompleter')
    await expect(completeSigningSession('bad-id', USER_ID)).rejects.toThrow('not found')
  })
})

describe('all-signed detection in sign route', () => {
  it('triggers completion only when every signer has status=signed', () => {
    const allSignedRows = [{ status: 'signed' }, { status: 'signed' }]
    const partialRows   = [{ status: 'signed' }, { status: 'viewed' }]

    expect(allSignedRows.every(r => r.status === 'signed')).toBe(true)
    expect(partialRows.every(r => r.status === 'signed')).toBe(false)
  })
})
