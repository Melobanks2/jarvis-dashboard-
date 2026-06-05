---
name: jarvis-dashboard
description: Full context for the Jarvis dashboard at /Users/chrislovera/jarvis-dashboard. Use when working on dashboard UI, Supabase queries, Vercel deployment, GHL pipeline display, or adding new sections.
---

# Jarvis Dashboard — Complete Reference

## Locations
- **Local**: `/Users/chrislovera/jarvis-dashboard/`
- **GitHub**: `https://github.com/Melobanks2/jarvis-dashboard-`
- **Live URL**: Auto-deployed on Vercel (push to `main` = instant deploy)

## Deploy
```bash
cd /Users/chrislovera/jarvis-dashboard
git add -A && git commit -m "your message"
git push origin main    # Vercel picks this up automatically
```

---

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **Database**: Supabase JS (anon key, client-side reads only)
- **GHL data**: Proxied via Vercel serverless function at `/api/pipeline.js`

---

## File Structure
```
jarvis-dashboard/
├── app/
│   ├── page.tsx              — Main page, renders all sections via SectionsDrawer
│   └── layout.tsx            — Root layout
├── lib/
│   ├── supabase.ts           — Supabase client + todayStart() helper
│   ├── AppContext.tsx         — Global state (active section, refresh key)
│   └── hooks/
│       ├── useCalls.ts       — Today's calls, weekly chart, pending approvals
│       ├── useFeed.ts        — Live activity feed from jarvis_log
│       ├── usePipeline.ts    — GHL pipeline stages via /api/pipeline.js
│       ├── useProspects.ts   — Prospects data
│       ├── useAgents.ts      — PM2 agent status
│       └── useAsapCities.ts  — ASAP ARV city scraping status
├── components/
│   ├── layout/
│   │   ├── TopNav.tsx        — Top navigation bar
│   │   ├── SectionsDrawer.tsx — Slide-out section navigator
│   │   └── BottomTimeline.tsx — Call timeline at bottom
│   ├── panels/
│   │   ├── LeftIntelPanel.tsx  — Left intel panel
│   │   ├── CenterOrb.tsx       — Animated center orb
│   │   └── RightAnalyticsPanel.tsx
│   └── sections/
│       ├── DavidHQ.tsx         — David call stats, recent calls
│       ├── CallCenter.tsx      — Live call feed
│       ├── LeadIntelligence.tsx
│       ├── Pipeline.tsx        — GHL pipeline stages
│       ├── AIAgents.tsx        — PM2 process status
│       ├── AsapScraper.tsx     — ASAP ARV city status
│       ├── MissionControl.tsx  — KPIs and command center
│       └── ... (others)
└── api/
    └── pipeline.js           — Vercel serverless: proxies GHL API to avoid CORS
```

---

## Supabase Connection
- **File**: `lib/supabase.ts`
- Anon key (read-only, safe for client-side)
- All data is read directly in browser — no server-side rendering for data

### Tables Read by Dashboard
| Table | Used In | Data |
|---|---|---|
| `jarvis_calls` | useCalls, DavidHQ, CallCenter | All call logs, durations, stages |
| `david_pending_approvals` | useCalls | Count of pending hot lead approvals |
| `jarvis_log` | useFeed | Live activity feed |
| `asap_sold_properties` | AsapScraper | Sold comp data |
| `asap_cities` | useAsapCities | City scraping status |
| `jarvis_ideas` | IdeasLab | Ideas board |
| `county_leads` | LeadIntelligence | County scraper leads |

---

## GHL Pipeline Data
- Fetched via **Vercel serverless** at `/api/pipeline.js` (avoids CORS)
- GHL token hardcoded in `/api/pipeline.js`
- Pipeline VA♦️Leads: `o4kqU2y8DYjA73aKUxNu`
- Returns stage counts for Pipeline section

---

## Adding a New Section
1. Create `components/sections/YourSection.tsx`
2. Import in `app/page.tsx`
3. Add to `SECTION_TITLES` record in `app/page.tsx`
4. Add to `SectionsDrawer.tsx` navigation list
5. `git push origin main` to deploy

## Adding a New Supabase Query
1. Create or update a hook in `lib/hooks/`
2. Follow existing pattern: `useState` + `useEffect` + `supabase.from(...).select(...)`
3. Import hook in the relevant section component
4. Pass `refreshKey` prop for auto-refresh support

---

## Auto-Refresh
- Dashboard refreshes every **30 seconds** (configurable in AppContext)
- Manual refresh button in TopNav
- `refreshKey` is incremented on each refresh, passed to all hooks via `useEffect([refreshKey])`

---

## Key callOutcome Helper (useCalls.ts)
```typescript
function callOutcome(c: CallRecord): 'hot' | 'warm' | 'cold' | 'voicemail' {
  if (stage === 'Hot Follow Up') return 'hot';
  if (stage === 'Warm Follow Up') return 'warm';
  if (stage includes 'No Contact' || duration < 25) return 'voicemail';
  return 'cold';
}
```

---

## Common Mistakes to Avoid

1. **Never write API keys or secrets in dashboard code** — Supabase anon key is intentionally public (read-only). GHL token goes in `/api/pipeline.js` (server-only Vercel function), never in client components.

2. **Vercel environment variables** — Any `process.env.X` used in serverless functions must be added in Vercel dashboard → Settings → Environment Variables.

3. **`todayStart()` helper** — always use `import { todayStart } from '../supabase'` for consistent today-filtering. Don't manually construct date strings.

4. **App Router vs Pages Router** — This project uses Next.js 14 App Router (`app/` directory). All client components need `'use client'` at top.

5. **Framer Motion with dynamic import** — `MissionControl` uses `dynamic(..., { ssr: false })` because it has 3D/canvas. Follow this pattern for any WebGL or browser-only components.

6. **Push to `main` = live deploy** — there's no staging. Test locally with `npm run dev` first.

## Local Dev
```bash
cd /Users/chrislovera/jarvis-dashboard
npm run dev     # http://localhost:3001
```
