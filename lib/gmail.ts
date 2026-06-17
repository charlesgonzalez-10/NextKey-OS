import { google, gmail_v1 } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from './oauth-crypto'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
]

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  )
}

export function getAuthUrl(state: string): string {
  const oauth2 = getOAuth2Client()
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state,
    prompt: 'consent',
  })
}

export async function exchangeCode(code: string) {
  const oauth2 = getOAuth2Client()
  const { tokens } = await oauth2.getToken(code)
  return tokens
}

export async function storeTokens(userId: string, tokens: {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
  email?: string
  scope?: string
}) {
  if (!tokens.access_token) throw new Error('access_token is required')
  const supabase = service()
  await supabase.from('oauth_tokens').upsert({
    user_id: userId,
    provider: 'gmail',
    access_token: encrypt(tokens.access_token),
    refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    email: tokens.email ?? null,
    scope: tokens.scope ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })
}

export async function getTokenRecord(userId: string) {
  const { data } = await service()
    .from('oauth_tokens')
    .select('email, scope, expires_at, updated_at')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .single()
  return data
}

export async function deleteTokens(userId: string) {
  await service()
    .from('oauth_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'gmail')
}

export async function getGmailClient(userId: string): Promise<gmail_v1.Gmail | null> {
  const supabase = service()
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .single()

  if (error || !data) return null

  const oauth2 = getOAuth2Client()
  oauth2.setCredentials({
    access_token: decrypt(data.access_token),
    refresh_token: data.refresh_token ? decrypt(data.refresh_token) : undefined,
    expiry_date: data.expires_at ? new Date(data.expires_at).getTime() : undefined,
  })

  oauth2.on('tokens', async (tokens) => {
    const updates: Record<string, string> = { updated_at: new Date().toISOString() }
    if (tokens.access_token) updates.access_token = encrypt(tokens.access_token)
    if (tokens.expiry_date) updates.expires_at = new Date(tokens.expiry_date).toISOString()
    await supabase
      .from('oauth_tokens')
      .update(updates)
      .eq('user_id', userId)
      .eq('provider', 'gmail')
  })

  return google.gmail({ version: 'v1', auth: oauth2 })
}

// ── Body extraction ────────────────────────────────────────────────────────────

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined, prefer: 'html' | 'plain' = 'html'): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }
  if (payload.parts) {
    const target = prefer === 'html' ? 'text/html' : 'text/plain'
    const fallback = prefer === 'html' ? 'text/plain' : 'text/html'
    const preferred = payload.parts.find(p => p.mimeType === target)
    if (preferred) return extractBody(preferred, prefer)
    const fb = payload.parts.find(p => p.mimeType === fallback)
    if (fb) return extractBody(fb, prefer)
    for (const part of payload.parts) {
      const body = extractBody(part, prefer)
      if (body) return body
    }
  }
  return ''
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): { filename: string; mimeType: string; attachmentId: string }[] {
  if (!payload) return []
  const atts: { filename: string; mimeType: string; attachmentId: string }[] = []
  if (payload.filename && payload.body?.attachmentId) {
    atts.push({ filename: payload.filename, mimeType: payload.mimeType ?? 'application/octet-stream', attachmentId: payload.body.attachmentId })
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      atts.push(...extractAttachments(part))
    }
  }
  return atts
}

// ── Raw message builder ────────────────────────────────────────────────────────

function buildRawMessage(opts: {
  to: string
  from: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  replyToMessageId?: string
  attachments?: { filename: string; mimeType: string; data: string }[]
}): string {
  const boundary = `nk_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const hasAtt = (opts.attachments?.length ?? 0) > 0

  const headers: string[] = [
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString('base64')}?=`,
    ...(opts.cc  ? [`Cc: ${opts.cc}`]  : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    ...(opts.replyToMessageId ? [
      `In-Reply-To: ${opts.replyToMessageId}`,
      `References: ${opts.replyToMessageId}`,
    ] : []),
    'MIME-Version: 1.0',
  ]

  if (!hasAtt) {
    headers.push('Content-Type: text/html; charset=utf-8')
    return Buffer.from([...headers, '', opts.body].join('\r\n')).toString('base64url')
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  const lines = [...headers, '']
  lines.push(`--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', opts.body, '')
  for (const att of opts.attachments!) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      att.data,
      ''
    )
  }
  lines.push(`--${boundary}--`)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function sendEmail(userId: string, opts: {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  replyToMessageId?: string
  threadId?: string
  attachments?: { filename: string; mimeType: string; data: string }[]
}) {
  const gmail = await getGmailClient(userId)
  if (!gmail) throw new Error('Gmail not connected')

  const { data: token } = await service()
    .from('oauth_tokens')
    .select('email')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .single()

  const raw = buildRawMessage({ ...opts, from: token?.email ?? 'me' })
  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) },
  })
  return data
}

export interface ThreadSummary {
  id: string
  snippet: string
  subject: string
  from: string
  to: string
  date: string
  unread: boolean
  messageCount: number
}

export async function listThreadsWithSummary(userId: string, opts: {
  maxResults?: number
  pageToken?: string
  q?: string
  labelIds?: string[]
} = {}): Promise<{ threads: ThreadSummary[]; nextPageToken: string | null }> {
  const gmail = await getGmailClient(userId)
  if (!gmail) return { threads: [], nextPageToken: null }

  const { data: listData } = await gmail.users.threads.list({
    userId: 'me',
    maxResults: opts.maxResults ?? 20,
    pageToken: opts.pageToken,
    q: opts.q,
    labelIds: opts.labelIds,
  })

  const rawThreads = listData.threads ?? []

  const threads = await Promise.all(
    rawThreads.map(async (t) => {
      try {
        const { data } = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        })
        const msgs = data.messages ?? []
        const last = msgs[msgs.length - 1]
        const headers = last?.payload?.headers ?? []
        const getH = (n: string) => headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? ''
        return {
          id: data.id!,
          snippet: data.snippet ?? '',
          subject: getH('Subject'),
          from: getH('From'),
          to: getH('To'),
          date: getH('Date'),
          unread: msgs.some(m => m.labelIds?.includes('UNREAD')),
          messageCount: msgs.length,
        }
      } catch {
        return { id: t.id!, snippet: t.snippet ?? '', subject: '', from: '', to: '', date: '', unread: false, messageCount: 1 }
      }
    })
  )

  return { threads, nextPageToken: listData.nextPageToken ?? null }
}

export interface MessageDetail {
  id: string
  threadId: string
  from: string
  to: string
  cc: string
  subject: string
  date: string
  body: string
  attachments: { filename: string; mimeType: string; attachmentId: string }[]
  labelIds: string[]
}

export async function getThreadMessages(userId: string, threadId: string): Promise<MessageDetail[]> {
  const gmail = await getGmailClient(userId)
  if (!gmail) return []

  const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
  const msgs = data.messages ?? []

  return msgs.map(msg => {
    const headers = msg.payload?.headers ?? []
    const getH = (n: string) => headers.find(h => h.name?.toLowerCase() === n.toLowerCase())?.value ?? ''
    return {
      id: msg.id!,
      threadId: msg.threadId!,
      from: getH('From'),
      to: getH('To'),
      cc: getH('Cc'),
      subject: getH('Subject'),
      date: getH('Date'),
      body: extractBody(msg.payload),
      attachments: extractAttachments(msg.payload),
      labelIds: msg.labelIds ?? [],
    }
  })
}
