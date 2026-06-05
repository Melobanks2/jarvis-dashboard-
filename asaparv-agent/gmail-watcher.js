/**
 * gmail-watcher.js — Parses Alpha Leads emails and pushes ALL fields to GHL immediately
 *
 * When a "New Alpha Lead Alert" email arrives:
 *   1. Parse the full email body (name, phone, address, motivation, timeline, asking price, etc.)
 *   2. Create/update GHL contact with all extracted fields + contact custom fields
 *   3. Create GHL opportunity in New Lead stage
 *   4. Add formatted note to GHL contact card showing everything
 *   5. Send rich Telegram alert with AI-generated opener based on their specific situation
 *   6. ALSO trigger alpha-scraper.js as a backup (captures web-only fields)
 *
 * PM2: gmail-watcher — persistent, autorestart
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { aiChat } = require('./ai-router');
const { createClient } = require('@supabase/supabase-js');

const CREDENTIALS_PATH = path.join(__dirname, 'gmail-credentials.json');
const TOKEN_PATH       = path.join(__dirname, 'gmail-token.json');
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '8779808673:AAE-zueNHjTof5X7XjHhs7uadopcqBzvWh0';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '8105811341';
const SUBJECT_FILTER     = 'New Alpha Lead Alert';
const STL_SUBJECT_FILTER = 'Congratulations! You bought a lead!';
const POLL_MS            = 3 * 60 * 1000; // 3 minutes

const GHL_TOKEN    = process.env.GHL_API_TOKEN || 'pit-dada4af8-bbe3-4334-906b-361b9f03bffa';
const GHL_LOCATION = 'AymErWPrH9U1ddRouslC';
const GHL_PIPELINE = 'o4kqU2y8DYjA73aKUxNu';
const GHL_STAGE_NEW_LEAD = '92d0031c-00f8-4692-bc9f-235a76fa3201';

// CONTACT-level custom field IDs (separate from opportunity CFs)
const CONTACT_CF = {
  motivation: 'G5pRzYCCqoUPiRHR4zDV',
  timeline:   'r3CXuo6aNXETD59iCplA',
  condition:  'KTwE7WE69Qh3camwH4H5',
};

const GHL_HEADERS = {
  'Authorization': `Bearer ${GHL_TOKEN}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
};

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Auth ─────────────────────────────────────────────────────────────────────

function buildAuth() {
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH)).installed;
  const auth  = new google.auth.OAuth2(client_id, client_secret, 'http://localhost');
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  auth.setCredentials(token);
  auth.on('tokens', updated => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...updated }, null, 2));
  });
  return auth;
}

// ── Email body decoder ────────────────────────────────────────────────────────

function decodeEmailBody(payload) {
  // Try to get plain text first, then HTML
  function extractPart(part) {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      for (const p of part.parts) {
        const text = extractPart(p);
        if (text) return text;
      }
    }
    return '';
  }

  // Simple body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  // Multipart
  if (payload.parts) {
    // Prefer plain text
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body?.data) {
        return Buffer.from(p.body.data, 'base64').toString('utf-8');
      }
    }
    // Fall back to HTML
    for (const p of payload.parts) {
      const text = extractPart(p);
      if (text) return text;
    }
  }
  return '';
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// ── Email field parser ────────────────────────────────────────────────────────

function parseLeadFromEmail(rawBody) {
  const body = rawBody.includes('<') ? stripHtml(rawBody) : rawBody;
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  // Generic field extractor: looks for "Key: Value" or "Key\nValue" patterns
  function extract(keys, fallbackPatterns) {
    for (const key of (Array.isArray(keys) ? keys : [keys])) {
      // "Key: Value" on same line
      for (const line of lines) {
        const m = line.match(new RegExp(`^${key}\\s*[:\-]\\s*(.+)$`, 'i'));
        if (m) return m[1].trim();
      }
      // Key on one line, value on next
      const idx = lines.findIndex(l => new RegExp(`^${key}\\s*[:\-]?\\s*$`, 'i').test(l));
      if (idx >= 0 && lines[idx + 1]) return lines[idx + 1].trim();
    }
    // Regex fallback patterns
    for (const pat of (fallbackPatterns || [])) {
      const m = body.match(pat);
      if (m) return m[1].trim();
    }
    return null;
  }

  const name = extract(
    ['name', 'seller name', 'seller', 'contact name', 'homeowner', 'lead name'],
    [/(?:seller|name|contact)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i]
  );

  const phone = extract(
    ['phone', 'phone number', 'cell', 'mobile', 'contact phone'],
    [/(?:phone|cell|mobile)[:\s]*(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/i,
     /(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/]
  ) || lines.find(l => /^\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}$/.test(l)) || '';

  const email = extract(
    ['email', 'email address'],
    [/(?:email)[:\s]+([^\s@]+@[^\s@]+\.[^\s@]+)/i]
  ) || lines.find(l => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l)) || '';

  const address = extract(
    ['address', 'property address', 'property', 'location', 'home address'],
    [/(?:address|property)[:\s]+(\d+[^,\n]+,[^,\n]+,[^,\n]+\d{5})/i,
     /(\d+\s+\w+[^,\n]*,\s*\w[^,\n]*,\s*\w{2}\s+\d{5})/]
  ) || lines.find(l => /\d{5}/.test(l) && l.includes(',')) || '';

  const motivation = extract(
    ['motivation', 'reason for selling', 'reason', 'why selling', 'motivation for selling',
     'seller motivation', 'situation', 'notes', 'va notes', 'conversation notes'],
    [/(?:reason|motivation|why selling|situation)[:\s]+([^\n]{10,})/i]
  );

  const timeline = extract(
    ['timeline', 'closing timeline', 'time frame', 'timeframe', 'when', 'close by', 'urgency'],
    [/(?:timeline|time.?frame|close.?by|urgency)[:\s]+([^\n]+)/i]
  );

  const askingPrice = extract(
    ['asking price', 'price', 'asking', 'list price', 'requested price', 'seller price', 'expected price'],
    [/(?:asking|price|listed?)[:\s]*\$?([\d,]+(?:\.\d+)?(?:k|K)?)/i,
     /\$([\d,]+(?:k|K)?)\b/]
  );

  const condition = extract(
    ['condition', 'property condition', 'home condition', 'house condition', 'rehab', 'repairs'],
    [/(?:condition|rehab level)[:\s]+([^\n]+)/i]
  ) || lines.find(l => /(light|medium|heavy) rehab|turnkey/i.test(l)) || null;

  const mortgage = extract(['mortgage', 'mortgage payoff', 'loan balance', 'owed', 'payoff']);
  const occupancy = extract(['occupancy', 'occupied', 'vacancy', 'tenant']);
  const agentName = extract(['agent', 'va agent', 'caller', 'va name', 'representative']);
  const callbackTime = extract(['callback', 'best time', 'best time to call', 'call back time']);
  const marketValue = extract(['market value', 'arv', 'estimated value', 'home value']);

  // Grab all "VA notes" / conversation content after a notes header
  let vaNotes = null;
  const notesIdx = lines.findIndex(l => /^(?:va notes?|conversation notes?|call notes?|notes?)[:\-]?\s*$/i.test(l));
  if (notesIdx >= 0) {
    vaNotes = lines.slice(notesIdx + 1, notesIdx + 8).join(' ');
  }

  // Full body for the GHL note (clean)
  const fullNotes = lines.join('\n');

  return { name, phone, email, address, motivation, timeline, askingPrice, condition,
           mortgage, occupancy, agentName, callbackTime, marketValue, vaNotes, fullNotes };
}

// ── GHL API helpers ───────────────────────────────────────────────────────────

async function ghlPost(path, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method: 'POST', headers: GHL_HEADERS, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function ghlPut(path, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method: 'PUT', headers: GHL_HEADERS, body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function ghlGet(path) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, { headers: GHL_HEADERS });
  return res.json();
}

async function findContactByPhone(phone) {
  try {
    const clean = (phone || '').replace(/\D/g, '');
    if (!clean) return null;
    const d1 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&phone=${encodeURIComponent(phone)}&limit=5`);
    const list1 = d1.contacts || d1.data?.contacts || [];
    if (list1.length > 0) return list1[0].id;
    const d2 = await ghlGet(`/contacts/search?locationId=${GHL_LOCATION}&query=${clean}&limit=10`);
    const list2 = d2.contacts || d2.data?.contacts || [];
    const match = list2.find(c => (c.phone || '').replace(/\D/g, '') === clean);
    return match ? match.id : null;
  } catch { return null; }
}

async function upsertContact(lead) {
  const nameParts   = (lead.name || 'Unknown').trim().split(/\s+/);
  const firstName   = nameParts[0] || '';
  const lastName    = nameParts.slice(1).join(' ') || '';
  const addrParts   = (lead.address || '').split(',').map(s => s.trim());
  const stateZip    = (addrParts[2] || '').trim().split(/\s+/);
  const state       = stateZip.length >= 2 ? stateZip.slice(0, -1).join(' ') : stateZip[0] || '';
  const postalCode  = stateZip[stateZip.length - 1] || '';

  const tags = buildTags(lead);

  const payload = {
    locationId: GHL_LOCATION, firstName, lastName, phone: lead.phone || '',
    address1: addrParts[0] || '', city: addrParts[1] || '', state, postalCode,
    ...(lead.email ? { email: lead.email } : {}),
    source: 'Alpha Leads', tags,
    // Contact-level custom fields
    customFields: [
      lead.motivation && { id: CONTACT_CF.motivation, value: lead.motivation },
      lead.timeline   && { id: CONTACT_CF.timeline,   value: lead.timeline },
      lead.condition  && { id: CONTACT_CF.condition,  value: lead.condition },
    ].filter(Boolean),
  };

  const { status, data } = await ghlPost('/contacts/', payload);

  if (status === 200 || status === 201) {
    console.log(`  [GHL] Contact created: ${lead.name} (${data.contact?.id})`);
    return { id: data.contact?.id, isNew: true };
  }
  if (data.meta?.contactId) {
    const contactId = data.meta.contactId;
    // Update with all fields including custom fields
    const { firstName: _f, locationId: _l, ...putBody } = payload;
    await ghlPut(`/contacts/${contactId}`, { firstName, lastName, ...putBody });
    console.log(`  [GHL] Contact updated: ${lead.name} (${contactId})`);
    return { id: contactId, isNew: false };
  }
  console.error('  [GHL] Contact upsert error:', JSON.stringify(data).slice(0, 150));
  return { id: null, isNew: false };
}

async function findOrCreateOpportunity(contactId, lead) {
  try {
    const d = await ghlGet(`/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}&pipeline_id=${GHL_PIPELINE}&limit=5`);
    const existing = (d.opportunities || []).find(o => o.status === 'open');
    if (existing) { console.log(`  [GHL] Opportunity exists: ${existing.id}`); return existing.id; }
  } catch {}

  const { status, data } = await ghlPost('/opportunities/', {
    pipelineId:      GHL_PIPELINE,
    locationId:      GHL_LOCATION,
    name:            `${lead.name} - ${lead.address}`,
    pipelineStageId: GHL_STAGE_NEW_LEAD,
    status:          'open',
    contactId,
    source:          'Alpha Leads',
  });
  if (status === 200 || status === 201) {
    console.log(`  [GHL] Opportunity created: ${data.opportunity?.id}`);
    return data.opportunity?.id;
  }
  console.error('  [GHL] Opportunity error:', JSON.stringify(data).slice(0, 100));
  return null;
}

async function addGhlNote(contactId, lead) {
  const lines = [
    `📋 Alpha Leads VA Call Notes`,
    ``,
    `👤 Name: ${lead.name || '—'}`,
    `📞 Phone: ${lead.phone || '—'}`,
    lead.email       ? `📧 Email: ${lead.email}` : null,
    `📍 Address: ${lead.address || '—'}`,
    ``,
    `💡 Motivation: ${lead.motivation || '—'}`,
    `⏱ Timeline: ${lead.timeline || '—'}`,
    `💰 Asking Price: ${lead.askingPrice || '—'}`,
    `🏚 Condition: ${lead.condition || '—'}`,
    lead.mortgage    ? `🏦 Mortgage Payoff: ${lead.mortgage}` : null,
    lead.occupancy   ? `🏡 Occupancy: ${lead.occupancy}` : null,
    lead.marketValue ? `📊 Market Value: ${lead.marketValue}` : null,
    lead.callbackTime? `📞 Best Call Time: ${lead.callbackTime}` : null,
    lead.agentName   ? `👤 VA Agent: ${lead.agentName}` : null,
    lead.vaNotes     ? `\n📝 VA Notes: ${lead.vaNotes}` : null,
  ].filter(l => l !== null).join('\n');

  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body: lines, userId: null });
    console.log('  [GHL] Note added');
  } catch (e) { console.error('  [GHL] Note error:', e.message); }
}

// ── Lead scoring / tags ───────────────────────────────────────────────────────

function buildTags(lead) {
  const tags = ['alpha-leads'];
  const mot  = (lead.motivation || '').toLowerCase();
  if      (mot.includes('inherit'))                                  tags.push('🏃🏽‍♂️💨 Inherited');
  else if (mot.includes('tired') || mot.includes('landlord'))       tags.push('🏃🏽‍♂️💨 Tired Landlord');
  else if (mot.includes('moving') || mot.includes('relocat'))       tags.push('🏃🏽‍♂️💨 Moving');
  else if (mot.includes('financial') || mot.includes('foreclos'))   tags.push('🏃🏽‍♂️💨 Financial Stress');
  else if (mot.includes('divorce'))                                  tags.push('🏃🏽‍♂️💨 Divorce');
  else if (mot.includes('vacant') || mot.includes('empty'))         tags.push('🏃🏽‍♂️💨 Vacant Property');

  const tl = (lead.timeline || '').toLowerCase();
  if      (tl.includes('asap') || tl.includes('immediately') || tl.includes('1 week') || tl.includes('one week')) tags.push('⏳ ASAP');
  else if (tl.includes('30'))                                        tags.push('⏳ 30 Days');
  else if (tl.includes('60') || tl.includes('90'))                  tags.push('⏳ 60 to 90 Days');
  else if (tl.includes('3') && tl.includes('month'))                tags.push('⏳ 3 to 6 Months');
  else                                                               tags.push('⏳ No Timeline');

  return tags;
}

function scoreHotness(lead) {
  const tl = (lead.timeline || '').toLowerCase();
  const isUrgent = /asap|immediately|1 week|one week|30 day|this month/i.test(tl);
  const hasMot   = (lead.motivation || '').length > 10;
  const hasPrice = !!lead.askingPrice;
  if (isUrgent && hasMot) return 'hot';
  if (hasMot || hasPrice) return 'warm';
  return 'cold';
}

// ── AI opener generator ───────────────────────────────────────────────────────

async function generateOpener(lead) {
  try {
    const context = [
      lead.motivation  && `Motivation: ${lead.motivation}`,
      lead.timeline    && `Timeline: ${lead.timeline}`,
      lead.askingPrice && `Asking: $${lead.askingPrice}`,
      lead.condition   && `Condition: ${lead.condition}`,
      lead.vaNotes     && `VA notes: ${lead.vaNotes}`,
    ].filter(Boolean).join('. ');

    const res = await aiChat({
      system: 'You are a wholesale real estate acquisitions coach. Write natural, conversational call openers. Never sound scripted.',
      messages: [{
        role: 'user',
        content: `Write a specific 2-3 sentence call opener for Chris calling ${lead.name || 'this seller'} about their property at ${lead.address || 'their property'}. Context: ${context}. Start with "Hey ${lead.name?.split(' ')[0] || 'there'}" and reference their SPECIFIC situation. Do not use placeholder brackets.`,
      }],
      max_tokens: 120,
    });
    return res.text.trim();
  } catch {
    const firstName = (lead.name || 'there').split(' ')[0];
    return `Hey ${firstName}, this is Chris. I saw you were looking to sell your property on ${lead.address}. I wanted to reach out personally — tell me more about what's going on.`;
  }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

// ── STL Purchase Email Handler ────────────────────────────────────────────────
// NOTE: The purchase confirmation email does NOT contain lead details — only
// date, lead source, and provider. The webhook receiver (stl-webhook.js, port 3006)
// is the primary path. This handler fires a Telegram alert so Chris knows the
// webhook should have triggered. If webhook isn't configured yet, it alerts him to check.

async function processSTLPurchaseEmail(gmail, msgId) {
  const msg  = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
  const raw  = decodeEmailBody(msg.data.payload);
  const body = raw.includes('<') ? stripHtml(raw) : raw;

  const dateMatch    = body.match(/Date:\s*([A-Za-z]+ \d+(?:st|nd|rd|th) \d{4}[^)\n]*)/i);
  const sourceMatch  = body.match(/Lead source:\s*(.+)/i);
  const providerMatch= body.match(/Provider:\s*(.+)/i);

  const datePurchased = dateMatch?.[1]?.trim()  || new Date().toLocaleDateString();
  const leadSource    = sourceMatch?.[1]?.trim() || 'Unknown source';
  const provider      = providerMatch?.[1]?.trim()|| 'Unknown provider';

  console.log('[gmail-watcher] STL purchase email detected:', { datePurchased, leadSource, provider });

  // The webhook receiver handles the actual import. This is just a backup alert
  // in case the webhook is not yet configured in the STL dashboard.
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    TELEGRAM_CHAT_ID,
      parse_mode: 'HTML',
      text: `🔔 <b>STL Purchase Email Detected</b>\n\n` +
            `📅 ${datePurchased}\n` +
            `📋 Source: ${leadSource}\n` +
            `🏢 Provider: ${provider}\n\n` +
            `Lead details should arrive via webhook automatically.\n` +
            `If GHL import doesn't appear within 60s, check webhook config in STL dashboard.`,
    }),
  }).catch(() => {});
}

// ── Alpha Scraper trigger (backup) ────────────────────────────────────────────

function runScraper() {
  return new Promise(resolve => {
    const scraperPath = path.join(__dirname, 'alpha-scraper.js');
    exec(`"${process.execPath}" "${scraperPath}"`, { cwd: __dirname }, (err, stdout) => {
      if (err) console.error('[gmail-watcher] scraper error:', err.message);
      else     console.log('[gmail-watcher] scraper done:', stdout.slice(0, 200));
      resolve();
    });
  });
}

// ── Supabase log ──────────────────────────────────────────────────────────────

async function supabaseLog(lead, contactId, oppId) {
  try {
    await sb.from('jarvis_log').insert({
      type:         'new_lead',
      message:      JSON.stringify({ ...lead, contactId, oppId, source: 'alpha-email' }),
      contact_name: lead.name || null,
      source:       'alpha-leads',
      priority:     scoreHotness(lead) === 'hot' ? 'hot' : 'high',
      pipeline:     'VA♦️ Leads',
      stage:        'New Lead',
    });
  } catch (e) { console.error('  [Supabase] Log error:', e.message); }
}

// ── Core: process one lead email ─────────────────────────────────────────────

async function processLeadEmail(gmail, msgId) {
  // Get full email content
  const msg = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
  const rawBody = decodeEmailBody(msg.data.payload);

  console.log('[gmail-watcher] Parsing email body...');
  const lead = parseLeadFromEmail(rawBody);

  console.log('[gmail-watcher] Parsed lead:', JSON.stringify({
    name: lead.name, phone: lead.phone, address: lead.address,
    motivation: lead.motivation, timeline: lead.timeline, asking: lead.askingPrice,
  }, null, 2));

  if (!lead.name && !lead.phone && !lead.address) {
    console.log('[gmail-watcher] Could not parse lead from email — scraper will handle it');
    return null;
  }

  const hotness = scoreHotness(lead);
  const emoji   = hotness === 'hot' ? '🔥' : hotness === 'warm' ? '⚡' : '🔵';

  // 1. Upsert GHL contact with all fields + contact custom fields
  const { id: contactId, isNew } = await upsertContact(lead);
  if (!contactId) { console.log('[gmail-watcher] GHL upsert failed — scraper will handle it'); return null; }

  // 2. Create/find opportunity
  const oppId = await findOrCreateOpportunity(contactId, lead);

  // 3. Add formatted note to contact card
  await addGhlNote(contactId, lead);

  // 4. Generate AI opener
  const opener = await generateOpener(lead);

  // 5. Send rich Telegram alert
  const hotLabel = hotness === 'hot'  ? '🔥 HOT LEAD — call immediately'
                 : hotness === 'warm' ? '⚡ Warm lead — call within the hour'
                 : '🔵 New lead added';

  await sendTelegram(
    `${emoji} <b>New VA Lead: ${lead.name || 'Unknown'}</b>\n\n` +
    `📍 ${lead.address || '—'}\n` +
    `📞 ${lead.phone   || '—'}\n` +
    (lead.email       ? `📧 ${lead.email}\n`       : '') +
    `\n💡 <b>Motivation:</b> ${lead.motivation    || '—'}\n` +
    `⏱ <b>Timeline:</b> ${lead.timeline           || '—'}\n` +
    `💰 <b>Asking Price:</b> ${lead.askingPrice    || '—'}\n` +
    `🏚 <b>Condition:</b> ${lead.condition         || '—'}\n` +
    (lead.vaNotes     ? `📝 <b>VA Notes:</b> ${lead.vaNotes}\n` : '') +
    `\n<b>${hotLabel}</b>\n\n` +
    `🎯 <b>Suggested opener:</b>\n<i>${opener}</i>\n\n` +
    `<a href="https://app.gohighlevel.com/contacts/${contactId}">View in GHL →</a>`
  );

  // 6. Supabase log
  await supabaseLog(lead, contactId, oppId);

  console.log(`[gmail-watcher] ✅ Lead processed: ${lead.name} | ${hotness.toUpperCase()} | contact: ${contactId}`);
  return lead;
}

// ── Gmail poll ────────────────────────────────────────────────────────────────

async function checkMail(gmail) {
  // ── Alpha Leads emails ───────────────────────────────────────────────────────
  const alphaRes  = await gmail.users.messages.list({
    userId: 'me', q: `is:unread subject:"${SUBJECT_FILTER}"`, maxResults: 10,
  });
  const alphaMessages = alphaRes.data.messages || [];

  if (alphaMessages.length > 0) {
    console.log(`[gmail-watcher] ${alphaMessages.length} unread Alpha Lead email(s)`);
    let processedAny = false;
    for (const msg of alphaMessages) {
      try {
        const lead = await processLeadEmail(gmail, msg.id);
        if (lead) processedAny = true;
      } catch (e) {
        console.error(`[gmail-watcher] Error processing Alpha email ${msg.id}:`, e.message);
      }
      await gmail.users.messages.modify({
        userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] },
      }).catch(() => {});
    }
    console.log('[gmail-watcher] Running alpha-scraper as backup...');
    runScraper();
  }

  // ── iSpeedToLead purchase confirmation emails ────────────────────────────────
  const stlRes  = await gmail.users.messages.list({
    userId: 'me', q: `is:unread subject:"${STL_SUBJECT_FILTER}"`, maxResults: 10,
  });
  const stlMessages = stlRes.data.messages || [];

  if (stlMessages.length > 0) {
    console.log(`[gmail-watcher] ${stlMessages.length} unread STL purchase email(s)`);
    for (const msg of stlMessages) {
      try {
        await processSTLPurchaseEmail(gmail, msg.id);
      } catch (e) {
        console.error(`[gmail-watcher] Error processing STL email ${msg.id}:`, e.message);
      }
      await gmail.users.messages.modify({
        userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] },
      }).catch(() => {});
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const auth  = buildAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  console.log(`[gmail-watcher] Started — polling every 3 minutes for "${SUBJECT_FILTER}"`);
  console.log('[gmail-watcher] Parses full email body → GHL contact + custom fields + note + Telegram alert');

  await checkMail(gmail).catch(e => console.error('[gmail-watcher] poll error:', e.message));
  setInterval(() => {
    checkMail(gmail).catch(e => console.error('[gmail-watcher] poll error:', e.message));
  }, POLL_MS);
}

main().catch(e => { console.error('[gmail-watcher] Fatal:', e.message); process.exit(1); });
