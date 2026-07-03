// Normalized models for skip trace data — provider-agnostic.
// All providers must map their raw responses into these shapes.

export interface SkipTracePhone {
  phone_number:  string
  phone_type:    'mobile' | 'landline' | 'voip' | 'other'
  is_mobile:     boolean
  is_landline:   boolean
  is_voip:       boolean
  is_dnc:        boolean
  carrier:       string | null
  priority:      number
  confidence:    number | null
  last_verified: string | null
}

export interface SkipTraceEmail {
  email:         string
  confidence:    number | null
  is_primary:    boolean
  last_verified: string | null
}

export interface SkipTraceContact {
  full_name:           string | null
  confidence_score:    number | null
  provider_contact_id: string | null
  age:                 number | null
  phones:              SkipTracePhone[]
  emails:              SkipTraceEmail[]
  relatives:           string[]
  address_history:     string[]
}

export interface SkipTraceProviderResult {
  provider:         string
  contacts:         SkipTraceContact[]
  credits_used:     number
  cost_cents:       number | null
  response_time_ms: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw:              any
}

// Input passed to every provider
export interface SkipTraceInput {
  first_name?:  string | null
  last_name?:   string | null
  address:      string
  city:         string
  state:        string
  zip:          string
}

// Shape returned from GET /api/properties/[id]/skiptrace
export interface SkipTraceStoredResult {
  request: {
    id:              string
    provider:        string
    status:          string
    credits_used:    number | null
    cost_cents:      number | null
    response_time_ms: number | null
    requested_at:    string
    completed_at:    string | null
  }
  results: Array<{
    id:                  string
    full_name:           string | null
    confidence_score:    number | null
    provider_contact_id: string | null
    age:                 number | null
    relatives:           string[] | null
    address_history:     string[] | null
    phones: SkipTracePhone[]
    emails: SkipTraceEmail[]
  }>
  days_since: number | null
  is_fresh:   boolean
}
