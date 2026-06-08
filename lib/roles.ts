/**
 * Role definitions for NextKey OS.
 * Add emails to OWNER_EMAILS to grant full access (including Scraper).
 * Everyone else gets the standard partner view.
 */

export const OWNER_EMAILS = [
  'crgonz10@gmail.com',
  'charlesgonzalez@nextkeyps.com',
]

export function isOwner(email: string | undefined | null): boolean {
  if (!email) return false
  return OWNER_EMAILS.includes(email.toLowerCase().trim())
}
