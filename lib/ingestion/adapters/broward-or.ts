/**
 * Broward County OR Index Adapter — SFTP flat-file feed
 *
 * Broward County Recorder's office publishes daily Official Records index files
 * on a public SFTP server. We connect with the published anonymous credentials,
 * find yesterday's delta file, and parse it line-by-line.
 *
 * Connection details (public, published by Broward County):
 *   Host : BCFTP.Broward.org
 *   Port : 22
 *   User : crpublic
 *   Pass : crpublic
 *
 * File naming convention (confirmed from Broward's developer documentation):
 *   OR_YYYYMMDD.txt  — daily OR index for that recording date
 *   Files live in the root directory of the SFTP share.
 *
 * Record format — pipe-delimited ASCII, one instrument per line:
 *   0  CFN             (Clerk File Number — this is our case_number)
 *   1  RecordedDate    (MM/DD/YYYY)
 *   2  BookType
 *   3  Book
 *   4  Page
 *   5  NumPages
 *   6  DocType         (LP, LIS, etc.)
 *   7  Grantor         (lender / plaintiff — may be multi-value, joined by &)
 *   8  Grantee         (borrower / defendant)
 *   9  LegalDesc
 *   10 Consideration   (numeric string, may be empty)
 *   11 DocStamp
 *   12 IntangTax
 *
 * NOTE: If the actual column layout differs from the above when you gain access,
 *       update BROWARD_COLS below without touching any other logic.
 */

import SftpClient from 'ssh2-sftp-client'
import { isDistressType, classifyDocType } from './types'
import type { CountyAdapter, ORRecord, AdapterResult } from './types'

// ─── SFTP credentials (public, published by Broward County) ──────────────────

const SFTP_CONFIG = {
  host:     'BCFTP.Broward.org',
  port:     22,
  username: 'crpublic',
  password: 'crpublic',

  // Conservative timeouts — the server is public but can be slow
  readyTimeout: 30_000,
  retries:      2,
  retry_factor: 2,
  retry_minTimeout: 2_000,
}

// ─── Column index map ─────────────────────────────────────────────────────────
// Update these if Broward changes their field layout.

const BROWARD_COLS = {
  cfn:           0,   // Clerk File Number = our case_number
  recorded_date: 1,   // MM/DD/YYYY
  book_type:     2,
  book:          3,
  page:          4,
  num_pages:     5,
  doc_type:      6,
  grantor:       7,   // lender / plaintiff
  grantee:       8,   // borrower / defendant
  legal_desc:    9,
  consideration: 10,
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns YYYYMMDD for the last business day (Mon–Fri) in local time */
function lastBusinessDayYYYYMMDD(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)           // start at yesterday
  const dow = d.getDay()               // 0=Sun, 6=Sat
  if (dow === 0) d.setDate(d.getDate() - 2)  // Sunday  → back to Friday
  if (dow === 6) d.setDate(d.getDate() - 1)  // Saturday → back to Friday
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** Parse Broward's MM/DD/YYYY date string → ISO YYYY-MM-DD */
function parseBrowardDate(raw: string): string {
  const [m, d, y] = raw.trim().split('/')
  if (!m || !d || !y) return raw
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * Parse a single line from the Broward OR index file.
 * Returns null if the line is malformed, a header row, or not a LP filing.
 */
function parseLine(line: string, sourceFile: string): ORRecord | null {
  const trimmed = line.trim()

  // Skip blank lines and comment/header rows
  if (!trimmed || trimmed.startsWith('#') || /^CFN|^InstrumentNum/i.test(trimmed)) {
    return null
  }

  // Support both pipe and tab delimiters
  const delimiter = trimmed.includes('|') ? '|' : '\t'
  const cols = trimmed.split(delimiter)

  const docType = (cols[BROWARD_COLS.doc_type] ?? '').trim()
  if (!isDistressType(docType)) return null

  const cfn       = (cols[BROWARD_COLS.cfn]       ?? '').trim()
  const grantor   = (cols[BROWARD_COLS.grantor]    ?? '').trim()
  const grantee   = (cols[BROWARD_COLS.grantee]    ?? '').trim()
  const legalDesc = (cols[BROWARD_COLS.legal_desc] ?? '').trim()
  const rawConsid = (cols[BROWARD_COLS.consideration] ?? '').replace(/[$,\s]/g, '')
  const considAmt = rawConsid ? parseFloat(rawConsid) : undefined

  if (!cfn) return null   // malformed row — no instrument ID

  return {
    case_number:       cfn,
    recording_date:    parseBrowardDate(cols[BROWARD_COLS.recorded_date] ?? ''),
    doc_type:          docType,
    lead_category:     classifyDocType(docType),
    plaintiff:         grantor,
    defendant:         grantee,
    legal_description: legalDesc || undefined,
    consideration:     isNaN(considAmt!) ? undefined : considAmt,
    county:            'broward',
    source_file:       sourceFile,
    raw:               cols,
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class BrowardORAdapter implements CountyAdapter {
  readonly county = 'broward' as const

  async fetchYesterdaysRecords(): Promise<ORRecord[]> {
    const result = await this._fetch()
    return result.records
  }

  /** Full result with metadata — used by the engine for run accounting */
  async fetch(): Promise<AdapterResult> {
    return this._fetch()
  }

  private async _fetch(): Promise<AdapterResult> {
    const dateStr  = lastBusinessDayYYYYMMDD()
    const fileName = `OR_${dateStr}.txt`
    const sftp     = new SftpClient('broward-or-adapter')

    let fileContent = ''
    let fetched     = 0

    try {
      await sftp.connect(SFTP_CONFIG)

      // Try multiple directories — Broward's SFTP root layout can vary
      const SEARCH_PATHS = ['/', '/OR/', '/ORIndex/', '/data/', '/public/']
      let target: { name: string; path: string } | undefined

      for (const dir of SEARCH_PATHS) {
        let listing: Awaited<ReturnType<typeof sftp.list>>
        try { listing = await sftp.list(dir) } catch { continue }

        const variants = [
          fileName,
          `OR_${dateStr}.TXT`,
          `BCPUB_${dateStr}.txt`,
          `BCPUB_${dateStr}.TXT`,
        ]
        const found = listing.find(f => f.type === '-' && variants.includes(f.name))
        if (found) {
          target = { name: found.name, path: `${dir}${found.name}` }
          console.log(`[Broward OR] Found ${found.name} in ${dir}`)
          break
        }
        console.log(`[Broward OR] dir=${dir} — ${listing.filter(f=>f.type==='-').length} files, no match for ${dateStr}`)
      }

      if (!target) {
        await sftp.end()
        return {
          county: 'broward', records: [], fetched: 0, filtered: 0,
          source: `SFTP:${fileName} (not found)`,
        }
      }

      // Stream file into memory. OR index files are large-ish but manageable
      // (~5–50 MB for a busy day). If size ever becomes a concern, switch to
      // createReadStream + readline for line-by-line processing.
      const buffer = await sftp.get(target.path)
      fileContent  = buffer.toString('utf-8')
    } catch (err) {
      const msg = `SFTP connection/read failed: ${String(err)}`
      console.error(`[Broward OR] ${msg}`)
      try { await sftp.end() } catch { /* ignore cleanup error */ }
      return { county: 'broward', records: [], fetched: 0, filtered: 0, source: fileName, error: msg }
    }

    await sftp.end()

    // Parse line by line
    const lines   = fileContent.split(/\r?\n/)
    const records: ORRecord[] = []

    for (const line of lines) {
      fetched++
      const record = parseLine(line, fileName)
      if (record) records.push(record)
    }

    console.log(`[Broward OR] ${fileName}: ${fetched} rows total, ${records.length} distress filings`)

    return {
      county:   'broward',
      records,
      fetched,
      filtered: records.length,
      source:   `SFTP:${fileName}`,
    }
  }
}
