/**
 * POST /api/mock-call
 * Generates a full realistic mock call transcript with David's internal decision points,
 * scores, and coaching suggestions. Supports: offer_call, qual_call, foreclosure, follow_up.
 */

const Anthropic = require('@anthropic-ai/sdk');

const DAVID_TACTICS = `
PULL-DOWN TACTICS (David uses in order before climbing the offer ladder):
1. "Is that number set in stone or is there some flexibility?"
2. "The closer we get to what my team approved, the easier it is to push this through for you."
3. "Even if you came down [amount] I think I could make this work today."
4. "Let me show you how this math works: similar property 3 months ago — $30/sqft repairs, 10% selling costs. Before any profit. We only need 10-12% because we do volume."
5. "What number were you hoping I'd say?" (anchor reversal)

OFFER LADDER RULE: Always open at 60%. Never start higher. Pull down before going up.
Round 1: 60% — then SILENCE. Never fill the silence.
Round 2: 65% — only after pull-down tactics fail. Must "go to underwriter" theatrically first (60-sec hold).
Round 3: 70% — last resort. Only if deal still pencils AND seller is moving.

NOVATION: Only pitch if owner approves via Telegram. All 5 criteria must be true: good condition, tight equity, gap over $20k, 60+ day timeline, genuine motivation.

QUALIFICATION STEPS (in order):
1. Pull-away intro ("you're probably not the owner?")
2. Set expectations ("qualifies for an offer")
3. Pen & paper technique (name, company, phone, BBB, website)
4. Motivation opener ("catch me up — what had you considering selling?") — DIG DEEP
5. Decision makers + veto power
6. Property condition: Big tickets first (roof, HVAC, electrical, plumbing, foundation) then cosmetics (kitchen, bath, flooring, windows, paint, HOA)
7. Mortgage naturally ("roughly what's still owed?") — never reveal ASAP ARV data
8. Timeline (30 days / 2-3 months / 60+)
9. Roadblocks ("if the price made sense, what would you have to figure out next?")
10. Price discovery ("what were you hoping to walk away with?") + anchoring if dodging
11. Qualify/set callback

TONE RULES:
• Sound like neighbor next door — NOT a call center
• 80% seller, 20% house
• ONE question at a time, acknowledge before moving on
• Mirror emotion: "it sounds like / it feels like / it seems like"
• Third-party stories to normalize situations
• Silence is a weapon — especially after presenting offers
• Confidence closes — never pressure
• Assume they're moving forward until they say otherwise
`;

const SELLER_PERSONAS = {
  Cooperative:  'Open to selling, wants a fair number. Responds well to rapport. Gives info freely. Minor price objection only.',
  Difficult:    'Skeptical, short answers, guarded. Needs extra warming before going anywhere. Pushes back hard on price. May have trust issues.',
  Motivated:    'Has real urgency (divorce/financial/inherited). More flexible on price. Wants this done. Emotional at points.',
  Testing:      'Just seeing what they could get. Not serious yet. Will likely say they need to think about it. No strong motivation revealed.',
  Foreclosure:  'Behind on payments, scared, defensive. Mix of shame and desperation. Needs to feel educated, not sold. Multiple objections.',
  Landlord:     'Tired landlord, problem tenant. Not emotional about the house. Business-minded. Wants clean close. Moderately flexible.',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const {
    callType       = 'offer_call',   // offer_call | qual_call | foreclosure | follow_up
    sellerName     = 'Denise',
    address        = '123 Main St, Tampa FL 33601',
    arv            = '320000',
    asking         = '265000',
    equity         = '38',
    timeline       = '30-60 days',
    condition      = 'Good',
    payoff         = '198000',
    motivation     = 'Divorce',
    persona        = 'Motivated',
    objectionLevel = 'Moderate',     // Light | Moderate | Heavy
    foreclosureStatus = 'active',    // active | pre (for foreclosure callType)
    auctionDate    = '',
  } = req.body || {};

  const arvNum    = parseInt(arv)    || 320000;
  const askingNum = parseInt(asking) || 265000;
  const payoffNum = parseInt(payoff) || 198000;
  const equityPct = parseInt(equity) || 38;

  // Calculated offer ladder
  const offer60   = Math.round(arvNum * 0.60);
  const offer65   = Math.round(arvNum * 0.65);
  const offer70   = Math.round(arvNum * 0.70);
  const novation  = Math.round(arvNum * 0.84);
  const gap       = askingNum - offer60;
  const novQual   = (timeline === '60+ days') && (condition === 'Good' || condition === 'Fair') && gap > 20000 && equityPct < 40;

  // Use odd numbers for offer
  const oddOffer60 = offer60 - 100; // e.g. $191,900 instead of $192,000
  const oddOffer65 = offer65 - 300;
  const oddOffer70 = offer70 + 200;

  const personaDesc = SELLER_PERSONAS[persona] || SELLER_PERSONAS.Motivated;

  // ── Build prompt based on call type ──────────────────────────────────────────
  let callInstructions = '';

  if (callType === 'qual_call') {
    callInstructions = `
CALL TYPE: QUALIFICATION CALL (first touch — David is calling cold to qualify this lead)

David MUST follow this exact sequence:
1. Pull-away intro ("you're probably not the owner?")
2. Set expectations frame ("qualifies for an offer from our specialist")
3. Pen & paper technique (give name, company, phone — have them repeat it back)
4. Motivation opener FIRST ("catch me up — what had you considering selling?") — dig deep here
5. Decision makers ("anyone with veto power?")
6. Property condition (big tickets: roof, HVAC, electrical, plumbing, foundation — then cosmetics)
7. Mortgage naturally ("roughly what's still owed?")
8. Timeline
9. Roadblocks ("if the price made sense, what would you figure out next?")
10. Price discovery + anchoring if dodging
11. Callback setup ("I'll send this to finance — are you available in 30 minutes?")

GOAL: Qualify motivation + condition + price, then book the callback with all decision makers present.

Seller motivation: ${motivation}
Property condition: ${condition}
Mortgage payoff: ~$${payoffNum.toLocaleString()}
Timeline: ${timeline}
`;
  } else if (callType === 'foreclosure') {
    callInstructions = `
CALL TYPE: FORECLOSURE OUTREACH (${foreclosureStatus === 'active' ? 'ACTIVE FORECLOSURE — sale date set' : 'PRE-FORECLOSURE — Notice of Default filed'})
${foreclosureStatus === 'active' && auctionDate ? `Auction date: ${auctionDate}` : ''}

David's approach:
- Lead with education, not pressure ("I want to make sure you understand your options")
- Present the 5 options framework: reinstatement, loan modification, ${foreclosureStatus === 'pre' ? 'forbearance, ' : ''}bankruptcy, selling, letting bank take it
- Stress-test whatever plan they claim to have: "Is that in writing? Is the auction officially paused?"
- Third-party story: "I had someone who thought their modification was under review but the auction was never paused..."
- Position selling as ONE of their options, not the only one
- Ultimate goal: get a sit-down ("I'd love to just go over your full situation — no obligation — would [time] or [time] work?")

Seller persona for foreclosure: ${personaDesc}
`;
  } else if (callType === 'follow_up') {
    callInstructions = `
CALL TYPE: FOLLOW-UP CALL (David is calling back a lead we couldn't close previously)

Opening: "Hey [Name], it's David — we spoke [X] ago about your property on [address]. I told my team where you were at and they've been thinking about it. Are you still open to a quick conversation? I think we might be closer than you think." — NEVER open with the number. Open with movement.

David re-qualifies: has anything changed? Timeline shifted? Motivation increased?
Then proceeds to offer if still warm, or books another callback.
Previous context: motivation was ${motivation}, they were asking ~$${askingNum.toLocaleString()}.
`;
  } else {
    // offer_call (default)
    callInstructions = `
CALL TYPE: OFFER CALL (David is calling back with approved numbers after qualification)

David has the full pre-call brief:
- ARV: $${arvNum.toLocaleString()}
- Mortgage payoff: ~$${payoffNum.toLocaleString()}
- Equity: ~${equityPct}%
- Seller asking: $${askingNum.toLocaleString()}
- Offer ladder: 60%=$${oddOffer60.toLocaleString()} | 65%=$${oddOffer65.toLocaleString()} | 70%=$${oddOffer70.toLocaleString()}
- Novation qualified: ${novQual ? `YES — offer $${novation.toLocaleString()}` : 'NO'}
- Seller motivation from qual call: ${motivation}
- Condition: ${condition}, Timeline: ${timeline}

David MUST follow this sequence:
1. Warm re-intro (60 sec, match energy, sound like you already know them)
2. Re-confirm ONLY 3 things: condition, timeline, decision maker
3. Get YES to moving forward BEFORE presenting number
4. Theatrical 60-second hold ("let me pull up what they sent...")
5. Present offer at 60% using ODD number ($${oddOffer60.toLocaleString()}) — then GO SILENT
6. Pull-down tactics before climbing (try to bring them DOWN first)
7. Go to underwriter (60-sec hold) → come back at 65% if needed
8. 70% is last resort — only if deal still makes sense and seller is moving
9. If counter outside range → Telegram fires to owner, David waits
10. Verbal agreement → Telegram fires → contract sends
`;
  }

  const objectionGuide = {
    Light:    '1-2 minor pushbacks ("that seems low"), accepts second offer after one pull-down tactic',
    Moderate: '3-4 objections ("that\'s too low", "I need to think", "I can get more on MLS"), needs pull-down + underwriter hold',
    Heavy:    '5+ hard objections, challenges the math, threatens to list, may bring up a family member who disagrees. David must work very hard. May not close this call.',
  };

  const prompt = `You are simulating a realistic real estate wholesaling phone call for training purposes.
Generate a COMPLETE, DETAILED call transcript between David (AI acquisition specialist) and a seller named ${sellerName} about their property at ${address}.

${callInstructions}

SELLER PERSONA: ${persona}
${personaDesc}

OBJECTION LEVEL: ${objectionLevel}
${objectionGuide[objectionLevel] || objectionGuide.Moderate}

DAVID'S TACTICS (he must use these — this is what's being tested):
${DAVID_TACTICS}

TRANSCRIPT FORMAT RULES:
- Write "DAVID:" for David's lines
- Write "${sellerName.toUpperCase()}:" for seller lines
- Write "[DECISION POINT — {David's internal reasoning, 1-2 sentences}]" to show his thinking at KEY moments (minimum 6-8 throughout)
- Write "[HOLD — X seconds — {reason}]" for any holds
- Write "[TELEGRAM TRIGGER — {what gets sent to owner}]" when Telegram would fire
- Keep conversation natural — real people stumble, use filler words, don't say perfect things
- Seller responds authentically to their persona and objection level
- David makes a real effort to close — this is not a demo, it's a real training simulation
- End with clear outcome label: [OUTCOME: CLOSED AT $X | WARM FOLLOW UP | COLD | NOVATION PIVOT | BOOKING CALLBACK]

After the transcript, output on a new line:
SCORE_JSON:{"offer_timing":X,"silence_discipline":X,"pulldown_tactics":X,"objection_handling":X,"rapport_building":X,"motivation_depth":X,"close_execution":X,"overall":X,"close_probability":X,"suggestions":["suggestion 1","suggestion 2","suggestion 3","suggestion 4"]}

Scores 1-10. close_probability is 0-100 (likelihood deal closes within 2 calls based on this performance).
Score honestly. Be critical where David could improve. The owner uses this to coach David.

Write the full transcript now:`;

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const fullText   = message.content[0]?.text || '';
    const scoreMarker = 'SCORE_JSON:';
    const scoreIdx   = fullText.lastIndexOf(scoreMarker);

    let transcript = fullText;
    let score      = null;

    if (scoreIdx !== -1) {
      transcript = fullText.slice(0, scoreIdx).trim();
      try {
        score = JSON.parse(fullText.slice(scoreIdx + scoreMarker.length).trim());
      } catch {}
    }

    return res.status(200).json({
      transcript,
      score,
      meta: {
        callType,
        sellerName,
        address,
        arv: arvNum,
        offer60: oddOffer60,
        offer65: oddOffer65,
        offer70: oddOffer70,
        novation: novQual ? novation : null,
        novationQualified: novQual,
        persona,
        objectionLevel,
      },
    });

  } catch (err) {
    console.error('mock-call error:', err);
    return res.status(500).json({
      error:      err.message || 'Failed to generate mock call',
      transcript: `Error: ${err.message}\n\nMake sure ANTHROPIC_API_KEY is set in Vercel environment variables.`,
      score:      null,
    });
  }
};
