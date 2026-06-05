require("dotenv").config({ path: "/root/asaparv-agent/.env" });

const GHL_TOKEN    = "pit-dada4af8-bbe3-4334-906b-361b9f03bffa";
const GHL_LOCATION = "AymErWPrH9U1ddRouslC";
const GHL_API      = "https://services.leadconnectorhq.com";
const HEADERS      = { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28", "Content-Type": "application/json" };

// OPPORTUNITY-level custom field IDs
const CF = {
  motivation:   "8iQ5bTtag1FoawrSJunx",
  condition:    "Lji5u2shyhw8OJDJEY8b",
  timeline:     "4oI5ZS8uRSw2FtOFPE0K",
  mortgage:     "hsI5aCkN2rkKukwF7WVM",
  occupancy:    "saOCIAWeKyrHgdYndtxS",
  askingPrice:  "iTdV1YDnBY23ZstRHQ1Z",
  marketValue:  "nrf56A59NAxgmkNxfOye",
  rehabCost:    "YZjGRzhqk8CTMJhE1Yr0",
  arv:          "n0v6O9y0BkMoiW8AURtn",
  ownerName:    "iH4GqPMkAy5VnnQvL9Gz",
};

const ALPHA_IDS = [
  "iH9yJzG4fCQ1YhquA1Ev","h9Rrv0p1H3RZpl9rOThW","uj2DN6M9665YJKJzyxlF",
  "YGSSRRMUEw3tzi0syBkJ","4EYNBRraFDB9Hcj8qC0r","nxYY1R6URCSyBkvs66O4",
  "dMbIFWFHIqUI5cmVS9u2","XvTxSl8Nm0cIkfAb1Pr7","Oq3redw2yVnlj0E9QIr8",
  "SU1MMC2hX2IJ0flnp8Vo","urTlsk20vRMDSrMH17zp","M27RXJ90P04EKjU6NylW",
  "MU9HCvwYCg1AqIxJLN6K"
];

async function ghlGet(path) {
  const r = await fetch(GHL_API + path, { headers: HEADERS });
  return r.json();
}
async function ghlPut(path, body) {
  const r = await fetch(GHL_API + path, { method: "PUT", headers: HEADERS, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

function parseNote(text, key) {
  const m = text.match(new RegExp(key + "\\s*:?\\s*([^\\n\\r]+)", "i"));
  if (!m) return null;
  const val = m[1].replace(/^[—\-]\s*/, "").trim();
  return (val === "—" || val === "") ? null : val;
}

async function processContact(contactId, name) {
  // Get notes
  const notesData = await ghlGet(`/contacts/${contactId}/notes`);
  const notes = notesData.notes || [];
  const alphaNote = notes.find(n => n.body && n.body.includes("Alpha Lead"));
  const callNote  = notes.find(n => n.body && (n.body.includes("QUALIFYING INFO") || n.body.includes("Motivation:")));
  if (!alphaNote && !callNote) return { skip: "no note" };

  const text = [alphaNote?.body || "", callNote?.body || ""].join("\n");

  const motivation  = parseNote(text, "Reason For Selling") || parseNote(text, "Motivation");
  const condition   = parseNote(text, "Condition");
  const timeline    = parseNote(text, "Timeline");
  const mortgage    = parseNote(text, "Mortgage");
  const occupancy   = parseNote(text, "Occupancy");
  const askingPrice = parseNote(text, "Asking Price");
  const marketValue = parseNote(text, "Market Value");
  const repairs     = parseNote(text, "Repairs Needed") || parseNote(text, "Rehab");

  const fields = [];
  if (motivation)  fields.push({ id: CF.motivation,  value: motivation });
  if (condition)   fields.push({ id: CF.condition,   value: condition });
  if (timeline)    fields.push({ id: CF.timeline,    value: timeline });
  if (mortgage)    fields.push({ id: CF.mortgage,    value: mortgage });
  if (occupancy)   fields.push({ id: CF.occupancy,   value: occupancy });
  if (askingPrice) fields.push({ id: CF.askingPrice, value: askingPrice });
  if (marketValue) fields.push({ id: CF.marketValue, value: marketValue });
  if (repairs)     fields.push({ id: CF.rehabCost,   value: repairs });
  // Always write owner name
  fields.push({ id: CF.ownerName, value: name });

  if (fields.length <= 1) return { skip: "no data in note" };

  // Get the contact's opportunity
  const oppData = await ghlGet(`/opportunities/search?location_id=${GHL_LOCATION}&contact_id=${contactId}`);
  const opp = oppData.opportunities?.[0];
  if (!opp) return { skip: "no opportunity" };

  const { status } = await ghlPut(`/opportunities/${opp.id}`, { customFields: fields });
  return { ok: status === 200 || status === 201, oppId: opp.id, fields: fields.length };
}

(async () => {
  console.log(`\nBackfilling OPPORTUNITY custom fields for ${ALPHA_IDS.length} contacts...\n`);
  let updated = 0;
  for (const id of ALPHA_IDS) {
    const cd = await ghlGet(`/contacts/${id}`);
    const name = `${cd.contact?.firstName || ""} ${cd.contact?.lastName || ""}`.trim() || id;
    process.stdout.write(`${name}... `);
    const result = await processContact(id, name);
    if (result.skip) { console.log(`⚠️  skipped (${result.skip})`); }
    else if (result.ok) { console.log(`✅ (${result.fields} fields → opp ${result.oppId})`); updated++; }
    else { console.log(`❌ failed`); }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\nDone: ${updated}/${ALPHA_IDS.length} opportunities updated`);
})();
