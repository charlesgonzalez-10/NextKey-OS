# NextKey OS

A business operating system and CRM built around how a real estate operation actually works — leads, property research, deal pipeline, communication, and documents in one workflow instead of scattered across separate tools.

**Status:** In development — the core loop (lead → property → pipeline → documents) runs end to end today; the platform is still being hardened and extended.

## Why I Built It

Over 10+ years across real estate research, operations, sales, investing, and running my own real estate business, I used a different tool for nearly every part of the job — a CRM for contacts, a separate service for property data, county sites for public records, another app for calls and texts, spreadsheets holding it all together, a separate platform for documents. Each tool did its job fine; nobody's job was the workflow that connected them.

Along the way I used and configured general-purpose real estate CRMs (including REI BlackBook) for my own operation — building automations, custom fields, and pipeline stages on top of them. That hands-on configuration work is what surfaced the gaps a purpose-built system would need to close, and is the direct motivation for NextKey OS.

## What It Does

- **CRM & Lead Management** — contacts and leads on a consistent relationship model, CSV import for bulk intake, a detailed workspace for daily lead triage.
- **Property Intelligence** — enrichment from county and paid data sources, with foreclosure status and comparable-property context surfaced directly on the property.
- **Deal Pipeline** — a configurable, drag-and-drop pipeline with custom stages, since different real estate strategies don't share one funnel shape.
- **Communication** — Gmail and SMS (Twilio) built into the workflow, with a unified inbox tied back to the lead or contact.
- **Documents & E-Signature** — contract templates generated from deal/contact/property data, routed through e-signature.
- **AI Assistance** — Claude supports lead analysis and communication drafting at specific points in the workflow, not the pipeline logic itself.
- **Reporting** — a dashboard of pipeline value, lead breakdowns, and activity.
- **Business Operations** — role-based access, scheduled background jobs, and internal cost tracking against the paid data providers the system depends on.

## Technical Architecture

Next.js handles both the frontend and the API layer, backed by Supabase for Postgres, authentication, and file storage. Authentication and role-based permissions run through Supabase Auth.

```
React / Next.js UI
        ↓
Application + API Layer
        ↓
Supabase / PostgreSQL
        ↓
External Services & Data Providers
  (Claude · Gmail · Twilio · County records ·
   Paid property-data providers · Document/e-sign · Scheduled jobs)
```

Real estate's specific data problems are first-class in the data model, not bolted on:

- County property-appraiser integrations (Broward, Palm Beach, Miami-Dade, Lee) pulling public records directly, with graceful fallback to a paid provider where a direct source isn't available.
- Foreclosure and distress-filing ingestion.
- Skip tracing to locate owner contact information from property records.
- "Driving for Dollars" tracking — a real estate-specific lead-sourcing workflow.
- A relationship model where a property can have multiple connected contacts, kept consistent across every workflow that touches it (skip trace, import, lead conversion, manual entry).

Implementation-level detail — schema internals, credentials, specific security configuration — is intentionally left out of this public writeup.

## Tech Stack

Next.js · TypeScript · Supabase (PostgreSQL, Auth, Storage) · Claude (Anthropic) · Twilio · Gmail API (Google) · Stripe · Resend · Vercel

## Engineering Challenges / Lessons

**A single source of truth for property relationships.** The same relationship — "this contact is connected to this property" — could originally be written from three different places in the app, so three code paths could each end up with a slightly different view of it. The fix was a single relationship service every workflow routes through, migrated one call site at a time. Data relationships that look simple in the UI can become some of the hardest architectural problems underneath it.

**Graceful fallbacks across data providers.** Not every county publishes property data the same way. Rather than fail for counties without a clean public source, the system tries a direct source first and falls back to a paid provider automatically. Thinking about external dependencies, failure modes, and cost together carries over directly from integrations and technical-support work generally.

## Project Links

- [Portfolio case study](https://charles-portfolio-weld.vercel.app/projects/nextkey-os)
- GitHub repository — this repo

## Current Status

NextKey OS currently runs as a single-business platform — proving the core workflows mattered more early on than building out multi-tenant SaaS infrastructure. Active work includes expanding automated test coverage, strengthening permissions, adding more configurable automation, extending integrations, and improving reliability across core workflows.
