-- ─── Additional email templates: Seller, Buyer, General ─────────────────────
-- Uses WHERE NOT EXISTS to avoid needing a unique constraint

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Probate Follow-Up', 'seller',
  'Following Up — Estate Property at {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I wanted to follow up on my previous message about the estate property at {{property_address}}. I understand this can be a difficult time, and I am here to make the process as smooth as possible.</p><p>I buy probate properties for cash, AS-IS, with no agents, no commissions, and no delays. I can work directly with the estate attorney and close on your timeline.</p><p>Please reach out whenever you are ready — there is absolutely no pressure.</p><p>Respectfully,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Probate Follow-Up');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Pre-Foreclosure Follow-Up', 'seller',
  'I Can Help — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I wanted to follow up and let you know my offer to purchase {{property_address}} is still available. I understand time is of the essence when facing foreclosure.</p><p>I can close quickly — sometimes in as little as 7 days — and a cash sale could help you avoid foreclosure, protect your credit, and walk away with cash in hand.</p><p>Please call or text me at {{my_phone}} so we can talk through your options. There is no cost or obligation.</p><p>Best,<br>{{my_name}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Pre-Foreclosure Follow-Up');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Reverse Mortgage Follow-Up', 'seller',
  'Re: Property at {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I am following up about the property at {{property_address}}. I have experience working with sellers in reverse mortgage situations and can help navigate the process with the lender.</p><p>I buy cash, AS-IS, and can coordinate directly with the servicer to ensure a smooth closing. This can often resolve the situation quickly and put proceeds in your hands without the hassle of a traditional sale.</p><p>I would love to connect — please reply or call me at {{my_phone}}.</p><p>Best,<br>{{my_name}}<br>{{company_name}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Reverse Mortgage Follow-Up');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Contract Sent', 'seller',
  'Purchase Contract Sent — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>I have just sent over the purchase contract for {{property_address}} for your review. The key terms are:</p><ul><li><strong>Purchase Price:</strong> {{offer_amount}}</li><li><strong>Closing Date:</strong> {{closing_date}}</li><li><strong>AS-IS, all cash, no financing contingency</strong></li></ul><p>Please review, sign, and return at your earliest convenience. If you have any questions or would like to discuss anything, do not hesitate to reach out at {{my_phone}}.</p><p>Best,<br>{{my_name}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Contract Sent');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Contract Reminder', 'seller',
  'Reminder: Contract Awaiting Signature — {{property_address}}',
  '<p>Hi {{seller_name}},</p><p>Just a friendly reminder that the purchase contract for {{property_address}} is still awaiting your signature. I want to make sure you have everything you need to feel comfortable moving forward.</p><p>Please let me know if you have any questions or concerns — I am happy to walk through the contract with you. You can reach me at {{my_phone}}.</p><p>Best,<br>{{my_name}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Contract Reminder');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Showing Confirmation', 'buyer',
  'Confirmed: Property Showing — {{property_address}}',
  '<p>Hi {{buyer_name}},</p><p>This confirms your showing for <strong>{{property_address}}</strong> on <strong>{{showing_date}}</strong> at <strong>{{showing_time}}</strong>.</p><p>Please reply if you need to reschedule. Looking forward to showing you the property!</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Showing Confirmation');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Offer Submitted', 'buyer',
  'Your Offer Has Been Submitted — {{property_address}}',
  '<p>Hi {{buyer_name}},</p><p>I wanted to let you know that your offer for <strong>{{property_address}}</strong> has been submitted to the seller. Here is a quick summary:</p><ul><li><strong>Offer Price:</strong> {{offer_amount}}</li><li><strong>Closing Date:</strong> {{closing_date}}</li><li><strong>Earnest Money:</strong> {{earnest_amount}}</li></ul><p>I will follow up as soon as I hear back from the seller. Please do not hesitate to reach out if you have any questions.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Offer Submitted');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Under Contract', 'buyer',
  'We Are Under Contract! — {{property_address}}',
  '<p>Hi {{buyer_name}},</p><p>Great news — we are officially under contract for <strong>{{property_address}}</strong>!</p><p>Here are the next steps:</p><ol><li>Earnest money deposit due by {{earnest_deadline}}</li><li>Inspection period: {{inspection_period}} days</li><li>Target closing date: {{closing_date}}</li></ol><p>I will keep you updated every step of the way. Please let me know if you have any questions.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Under Contract');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Closing Instructions', 'buyer',
  'Closing Instructions — {{property_address}}',
  '<p>Hi {{buyer_name}},</p><p>We are almost there! Here are the final closing instructions for <strong>{{property_address}}</strong>:</p><ul><li><strong>Closing Date:</strong> {{closing_date}}</li><li><strong>Closing Location:</strong> {{closing_location}}</li><li><strong>Funds Due:</strong> {{funds_due}} (wire transfer or cashier''s check)</li><li>Bring a valid government-issued photo ID</li></ul><p>Please confirm receipt of these instructions and let me know if you have any questions.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Closing Instructions');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Referral Request', 'general',
  'Quick Favor — Do You Know Anyone Looking to Sell?',
  '<p>Hi {{name}},</p><p>I hope you are doing well! I wanted to reach out because I am actively looking for properties to purchase in your area.</p><p>If you know anyone who is thinking about selling their home — especially as-is or in a hurry — I would love an introduction. I pay cash, close fast, and make the process completely hassle-free.</p><p>If you send me a referral that results in a purchase, I will send you a <strong>$500 referral fee</strong> as my thank you.</p><p>Thanks so much for thinking of me!</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Referral Request');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'Thank You', 'general',
  'Thank You — {{subject_topic}}',
  '<p>Hi {{name}},</p><p>I just wanted to take a moment to say thank you. I genuinely appreciate your time and I look forward to working with you.</p><p>Please do not hesitate to reach out at any time — I am always happy to help.</p><p>Best,<br>{{my_name}}<br>{{my_phone}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Thank You');

INSERT INTO email_templates (name, category, subject, body, is_builtin)
SELECT 'General Follow-Up', 'general',
  'Following Up — {{subject_topic}}',
  '<p>Hi {{name}},</p><p>I wanted to follow up on our recent conversation. I am still very interested and would love to connect when you have a few minutes.</p><p>Please feel free to reply or give me a call at {{my_phone}} at your convenience.</p><p>Best,<br>{{my_name}}</p>',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'General Follow-Up');
