-- Seed the "Client" signer role if it doesn't already exist.
-- Used for service agreements, representation contracts, and any document where
-- the counterparty does not map cleanly to Buyer or Seller.
INSERT INTO signer_roles (name, description, color, sort_order, auto_suggest, is_active)
SELECT
  'Client',
  'Generic client role for service agreements and representation contracts',
  '#9B7FE8',
  15,
  'manual',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM signer_roles WHERE lower(name) = 'client'
);
