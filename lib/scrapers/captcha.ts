/**
 * 2captcha REST API helper
 * https://2captcha.com/api
 *
 * Cost: ~$2.99 / 1,000 solves ≈ $0.003 each
 * Expected usage: ~3–5 solves/week across all counties ≈ $0.01–$0.02/week
 */

const BASE = 'https://2captcha.com'

export interface CaptchaOptions {
  apiKey: string
  siteKey: string
  pageUrl: string
  type: 'v2' | 'v3'
  /** v3 only — action name passed to grecaptcha.execute() */
  action?: string
  /** v3 only — minimum acceptable score (default 0.3) */
  minScore?: number
}

/**
 * Submits a reCAPTCHA challenge to 2captcha and polls until solved.
 *
 * Typical solve times:
 *   v2 → 20–40s
 *   v3 → 10–25s
 *
 * Throws on submission error or if the captcha isn't solved within ~120s.
 */
export async function solveCaptcha(opts: CaptchaOptions): Promise<string> {
  const { apiKey, siteKey, pageUrl, type, action = 'verify', minScore = 0.3 } = opts

  // ── Submit ─────────────────────────────────────────────────────────────────
  const params = new URLSearchParams({
    key:       apiKey,
    method:    'userrecaptcha',
    googlekey: siteKey,
    pageurl:   pageUrl,
  })
  if (type === 'v3') {
    params.set('version',   'v3')
    params.set('action',    action)
    params.set('min_score', String(minScore))
  }

  const submitRes  = await fetch(`${BASE}/in.php`, {
    method: 'POST',
    body:   params,
    signal: AbortSignal.timeout(15_000),
  })
  const submitText = (await submitRes.text()).trim()
  console.log(`[2captcha] submit (${type}) → ${submitText}`)

  if (!submitText.startsWith('OK|')) {
    throw new Error(`2captcha submit failed: ${submitText}`)
  }
  const taskId = submitText.slice(3)

  // ── Poll ───────────────────────────────────────────────────────────────────
  // Wait before first poll — v3 tends to come back faster
  await sleep(type === 'v3' ? 15_000 : 20_000)

  const pollUrl = `${BASE}/res.php?key=${apiKey}&action=get&id=${taskId}`

  for (let i = 0; i < 20; i++) {
    const res  = await fetch(pollUrl, { signal: AbortSignal.timeout(10_000) })
    const text = (await res.text()).trim()
    console.log(`[2captcha] poll #${i + 1} → ${text.slice(0, 60)}`)

    if (text === 'CAPCHA_NOT_READY') {
      await sleep(5_000)
      continue
    }

    if (text.startsWith('OK|')) {
      const token = text.slice(3)
      console.log(`[2captcha] solved (${type}): token.length=${token.length}`)
      return token
    }

    // Any other response is an error code from 2captcha
    throw new Error(`2captcha error: ${text}`)
  }

  throw new Error('2captcha timeout: not solved within ~120s')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
