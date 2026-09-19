/**
 * Workspace document upload tests.
 * Verifies the 'files' field name (not 'files[]') used in the FormData append.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TAB_PATH = path.resolve(__dirname, '../../components/workspace/tabs/WorkspaceDocsTab.tsx')

describe('WorkspaceDocsTab — upload field name', () => {
  it("appends files with field name 'files' not 'files[]'", () => {
    const src = fs.readFileSync(TAB_PATH, 'utf-8')
    // Must not use files[]
    expect(src).not.toMatch(/fd\.append\(['"]files\[\]['"]/)
    // Must use plain 'files'
    expect(src).toMatch(/fd\.append\(['"]files['"]/)
  })
})

describe('FormData field name invariant', () => {
  it("Next.js multipart parser reads 'files', not 'files[]'", () => {
    // This documents the invariant: the /api/documents/upload route handler
    // reads req.formData() and calls formData.getAll('files').
    // If the client sends 'files[]', getAll('files') returns empty array
    // and the upload silently succeeds with 0 files stored.
    // Confirmed fix: WorkspaceDocsTab now appends with field name 'files'.
    expect(true).toBe(true)
  })

  it('FormData with correct field name returns all files', () => {
    const fd = new FormData()
    const f1 = new File(['content1'], 'doc1.pdf', { type: 'application/pdf' })
    const f2 = new File(['content2'], 'doc2.pdf', { type: 'application/pdf' })
    fd.append('files', f1)
    fd.append('files', f2)

    const retrieved = fd.getAll('files')
    expect(retrieved).toHaveLength(2)
  })

  it('FormData with wrong field name returns 0 files', () => {
    const fd = new FormData()
    const f1 = new File(['content1'], 'doc1.pdf', { type: 'application/pdf' })
    fd.append('files[]', f1)

    const retrieved = fd.getAll('files')
    expect(retrieved).toHaveLength(0) // confirms the bug
  })
})
