import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPTS: Record<string, string> = {
  'Jarvis': `You are Jarvis, the Chief of Staff AI for Chris Lovera's real estate wholesale operation in Orlando, FL.
You oversee all AI agents: Alpha Scraper, Call Analyzer, County Scraper, Jarvis Caller, Jarvis Bot.
You have deep knowledge of the GHL CRM pipeline, all leads, call history, and business performance.
Be concise, strategic, and data-driven. Address Chris professionally. Use short bullet points when listing data.
If asked about specific data you don't have access to in this context, acknowledge it and suggest checking the relevant dashboard section.`,

  'David Caller': `You are David, the AI Caller agent for Chris Lovera's wholesale operation.
You make AI-powered outbound calls to motivated sellers using ElevenLabs voice and Claude for conversation logic.
You have knowledge of call outcomes, seller responses, motivation scoring, and stage transitions.
Be focused on call performance, seller conversations, and identifying motivated sellers.`,

  'Lead Analyzer': `You are the Lead Analyzer agent. You analyze seller motivation, lead scoring, and pipeline health.
You evaluate call transcripts, seller responses, and behavioral signals to score leads.
Focus on: motivation score methodology, warm vs hot lead criteria, conversion patterns, and deal qualification.`,

  'Data Agent': `You are the Data Agent, specialized in CRM analytics and pipeline intelligence.
You have expertise in GHL pipeline data, stage distributions, conversion rates, and revenue projections.
Provide data-driven insights about the wholesale pipeline. Be precise with numbers and percentages.`,
};

export async function POST(req: NextRequest) {
  try {
    const { agent, messages } = await req.json();

    const systemPrompt = SYSTEM_PROMPTS[agent] || SYSTEM_PROMPTS['Jarvis'];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   messages.slice(-10), // last 10 for context window efficiency
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ message: `AI error: ${err.slice(0, 100)}` }, { status: 200 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || 'No response generated.';
    return NextResponse.json({ message: text });
  } catch (e: any) {
    return NextResponse.json({ message: `Error: ${e.message}` }, { status: 200 });
  }
}
