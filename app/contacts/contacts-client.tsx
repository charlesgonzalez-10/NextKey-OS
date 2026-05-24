'use client'

import { useState } from 'react'
import ColumnPicker, { useColumnPrefs, ColumnDef } from '@/components/ColumnPicker'

const CATEGORIES = ['All', 'Seller', 'Buyer', 'Investor', 'Wholesaler', 'Agent', 'Lender', 'Other']

const categoryColors: Record<string, string> = {
  Seller: '#4CAF9A',
  Buyer: '#7B8FD4',
  Investor: '#C9A84C',
  Wholesaler: '#E07B6A',
  Agent: '#6ABDE0',
  Lender: '#B06AE0',
  Other: '#888',
}

type ColKey =
  | 'name' | 'category' | 'phone' | 'email'
  | 'address' | 'source' | 'status' | 'tags' | 'added'

const COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'name',     label: 'Name',     locked: true },
  { key: 'category', label: 'Category', defaultVisible: true },
  { key: 'phone',    label: 'Phone',    defaultVisible: true },
  { key: 'email',    label: 'Email',    defaultVisible: false },
  { key: 'address',  label: 'Address',  defaultVisible: false },
  { key: 'source',   label: 'Source',   defaultVisible: true },
  { key: 'status',   label: 'Status',   defaultVisible: false },
  { key: 'tags',     label: 'Tags',     defaultVisible: false },
  { key: 'added',    label: 'Added',    defaultVisible: true },
]

interface Contact {
  id: string
  name: string
  phone: string
  email: string
  address: string
  category: string
  tags: string[]
  notes: string
  status: string
  source: string
  created_at: string
}

export default function ContactsClient({ contacts }: { contacts: Contact[] }) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const { visible, toggle, reset, isVisible } = useColumnPrefs('contacts', COLUMNS)

  const filtered = contacts.filter((c) => {
    const matchesSearch =
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase()) ||
      c.address?.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = activeCategory === 'All' || c.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ color: '#0A1F44' }} className="text-3xl font-bold">Contacts</h1>
          <p className="text-gray-400 mt-1">{contacts.length} total contacts</p>
        </div>
        <a
          href="/contacts/new"
          style={{ backgroundColor: '#0A1F44', color: '#C9A84C' }}
          className="flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Contact
        </a>
      </div>

      {/* Search + filter */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6">
        <input
          type="text"
          placeholder="Search by name, phone, email, or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-sm text-gray-800 placeholder-gray-300 focus:outline-none mb-4"
        />
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={activeCategory === cat ? { backgroundColor: '#0A1F44', color: '#C9A84C' } : {}}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                activeCategory === cat ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No contacts found.</p>
          <a href="/contacts/new" style={{ color: '#C9A84C' }} className="text-sm font-semibold mt-2 inline-block hover:underline">
            Add your first contact →
          </a>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {/* Table toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-50">
            <span className="text-xs text-gray-400">{filtered.length} contacts</span>
            <ColumnPicker
              columns={COLUMNS}
              visible={visible}
              onToggle={toggle}
              onReset={reset}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: '#F8F7F4' }}>
                  {/* Name always first */}
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
                  {isVisible('category') && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Category</th>}
                  {isVisible('phone')    && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Phone</th>}
                  {isVisible('email')    && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Email</th>}
                  {isVisible('address')  && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Address</th>}
                  {isVisible('source')   && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Source</th>}
                  {isVisible('status')   && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>}
                  {isVisible('tags')     && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tags</th>}
                  {isVisible('added')    && <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Added</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((contact) => (
                  <tr
                    key={contact.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => window.location.href = `/contacts/${contact.id}`}
                  >
                    <td className="px-6 py-4">
                      <p style={{ color: '#0A1F44' }} className="font-semibold text-sm">{contact.name}</p>
                      {!isVisible('address') && contact.address && (
                        <p className="text-gray-400 text-xs mt-0.5 truncate max-w-xs">{contact.address}</p>
                      )}
                    </td>
                    {isVisible('category') && (
                      <td className="px-6 py-4">
                        <span
                          style={{ backgroundColor: `${categoryColors[contact.category] || '#888'}20`, color: categoryColors[contact.category] || '#888' }}
                          className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        >
                          {contact.category || '—'}
                        </span>
                      </td>
                    )}
                    {isVisible('phone')   && <td className="px-6 py-4 text-sm text-gray-600">{contact.phone || '—'}</td>}
                    {isVisible('email')   && <td className="px-6 py-4 text-sm text-gray-600">{contact.email || '—'}</td>}
                    {isVisible('address') && <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">{contact.address || '—'}</td>}
                    {isVisible('source')  && <td className="px-6 py-4 text-xs text-gray-400">{contact.source || '—'}</td>}
                    {isVisible('status')  && <td className="px-6 py-4 text-xs text-gray-400">{contact.status || '—'}</td>}
                    {isVisible('tags') && (
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(contact.tags || []).slice(0, 3).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">{tag}</span>
                          ))}
                          {(contact.tags || []).length > 3 && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400">+{contact.tags.length - 3}</span>
                          )}
                        </div>
                      </td>
                    )}
                    {isVisible('added') && (
                      <td className="px-6 py-4 text-xs text-gray-400">
                        {new Date(contact.created_at).toLocaleDateString()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
