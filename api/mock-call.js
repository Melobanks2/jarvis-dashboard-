const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment variables' });
  }

  const {
    sellerName     = 'Denise',
    address        = '123 Main St',
    arv            = '320000',
    asking         = '265000',
    equity         = '38',
    timeline       = '30-60 days',
    condition      = 'Good',
    payoff         = '198000',
    persona        = 'Motivated',
    objectionLevel = 'Moderate',
  } = req.body || {};

  const arvNum       = parseInt(arv)     || 320000;
  const askingNum    = parseInt(asking)  || 265000;
  const payoffNum    = parseInt(payoff)  || 198000;
  const offer60      = Math.round(arvNum * 0.60);
  const offer65      = Math.round(arvNum * 0.65);
  const offer70      = Math.round(arvNum * 0.70);
  const novationOffer= Math.round(arvNum * 0.84);
  const gap          = askingNum - offer60;
  const novationQual = timeline === '60+ days' && condition !== 'Poor' && gap > 20000;

  const prompt = `You are simulating a realistic real estate wholesaling phone call. You will generate a complete call transcript between David (AI caller) and a seller named ${sellerName} about their property at ${address}.

LEAD DETAILS:
- ARV: $${arvNum.toLocaleString()}
- Seller asking: $${askingNum.toLocaleString()}
- Equity: ${equity}%
- Mortgage payoff: $${payoffNum.toLocaleString()}
- Timeline: ${timeline}
- Condition: ${condition}
- Novation qualified: ${novationQual ? 'YES' : 'NO (timeline too short or condition poor)'}

DAVID'S OFFER LADDER:
- Start: 60% = $${offer60.toLocaleString()}
- Step 2: 65% = $${offer65.toLocaleString()}
- Max: 70% = $${offer70.toLocaleString()}
${novationQual ? `- Novation offer: $${novationOffer.toLocaleString()} (if cash rejected)` : '- Novation: NOT available for this deal'}

SELLER PERSONA: ${persona}
- Cooperative: open to selling, just wants a fair number, responds positively to rapport
- Difficult: skeptical, short answers, needs extra warming up before presenting numbers
- Motivated: has urgency, more flexible on price, wants to move fast
- Testing: just seeing what you offer, not serious yet, likely to say they'll think about it

OBJECTION LEVEL: ${objectionLevel}
- Light: 1-2 minor pushbacks, accepts second offer
- Moderate: 3-4 objections, needs pull-down tactics and underwriter escalation
- Heavy: 5+ hard objections, multiple tactics required, may not close on this call

CALL FLOW DAVID MUST FOLLOW (in this order):
1. Warm re-intro
2. Re-confirm timeline and condition
3. Set up the offer (ask "if the price made sense today, are you in a position to move forward?")
4. Present offer (60% first, hold for 8+ seconds of silence)
5. Pull-down tactics if rejected ("Is that set in stone?", "What number were you hoping for?")
6. Underwriter escalation if seller shows movement (hold 60 seconds, come back at 65%)
7. Close or handle novation pivot if applicable

PULL-DOWN TACTICS (use in order):
1. "Is that number set in stone or is there some flexibility?"
2. "What number were you hoping for?"
3. "If we could get closer to your number, what would need to happen for you to sign today?"
4. "Let me take this back to my underwriting team" (go on hold 60 seconds, return at 65%)

FORMAT RULES:
- Write "DAVID:" for David's lines
- Write "${sellerName.toUpperCase()}:" for seller lines
- Write "[DECISION POINT — {brief internal reasoning}]" to show David's internal decisions at key moments
- Write "[HOLD — X seconds]" for underwriter holds
- Keep conversation natural and realistic — no perfect responses
- David should make some minor errors or hesitations for realism
- Seller responds according to their persona and objection level
- Include at least 6-8 decision points throughout the call
- End the call with a clear outcome (closed, warm follow-up, cold, or novation pivot)

After the transcript, output a JSON block on a new line in this exact format:
SCORE_JSON:{"offer_timing":X,"silence_after_offer":X,"pulldown_tactics":X,"objection_handling":X,"timeline_reconfirm":X,"close_probability":X,"suggestions":["suggestion 1","suggestion 2","suggestion 3"]}

Where X is a score from 1-10, and close_probability is a percentage 0-100.
Score honestly based on how well David executed each tactic.

Write the full transcript now:`;

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const fullText = message.content[0]?.text || '';

    // Split transcript from score JSON
    const scoreMarker = 'SCORE_JSON:';
    const scoreIdx    = fullText.lastIndexOf(scoreMarker);
    let transcript    = fullText;
    let score         = null;

    if (scoreIdx !== -1) {
      transcript = fullText.slice(0, scoreIdx).trim();
      try {
        const jsonStr = fullText.slice(scoreIdx + scoreMarker.length).trim();
        score = JSON.parse(jsonStr);
      } catch {
        // Score parse failed — ignore, transcript still valid
      }
    }

    return res.status(200).json({ transcript, score });

  } catch (err) {
    console.error('mock-call error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to generate mock call',
      transcript: `Error: ${err.message}\n\nMake sure ANTHROPIC_API_KEY is set in your Vercel environment variables.`,
      score: null,
    });
  }
};
