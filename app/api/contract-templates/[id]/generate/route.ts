import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDocument } from '@/lib/documents/documentGenerationService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const {
    contact_id:       contactId,
    lead_id:          leadId,
    deal_id:          dealId,
    offer_id:         offerId,
    save_as_document: saveAsDocument,
  } = body as {
    contact_id?:       string
    lead_id?:          string
    deal_id?:          string
    offer_id?:         string
    save_as_document?: boolean
  }

  try {
    const result = await generateDocument({
      templateId:     id,
      userId:         user.id,
      contactId,
      leadId,
      dealId,
      offerId,
      saveAsDocument: saveAsDocument ?? false,
    })

    if (saveAsDocument) {
      return NextResponse.json({ id: result.documentId, name: result.documentName })
    }

    const tmplName = id // route has no name here; service already used it for filename
    return new NextResponse(Buffer.from(result.filledPdf), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="document_${tmplName}.pdf"`,
      },
    })
  } catch (err: unknown) {
    const msg = (err as Error).message
    const status = msg === 'Not found' || msg === 'Template not found' ? 404
                 : msg.includes('no field') ? 400
                 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
