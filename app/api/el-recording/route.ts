import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${id}/audio`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } }
    );
    if (!r.ok) return NextResponse.json({ error: `ElevenLabs ${r.status}` }, { status: r.status });

    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type':        'audio/mpeg',
        'Content-Disposition': `attachment; filename="call-${id}.mp3"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
