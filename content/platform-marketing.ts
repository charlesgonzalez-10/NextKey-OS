// Central product-marketing configuration.
// Changing productName here propagates to all marketing surfaces.
// Do NOT hardcode "NextKey OS" in marketing components — import from here.

export const platform = {
  productName:      'NextKey OS',
  companyName:      'NextKey Property Solutions',
  tagline:          'Find the opportunity. Understand the property. Work the deal.',
  shortDescription:
    'One workspace for property intelligence, relationship management, and deal execution — from initial search to close.',
  loginHref:        '/login',
  dashboardHref:    '/dashboard',
  contactEmail:     'hello@nextkeyproperty.com',
}

export type PlatformConfig = typeof platform
