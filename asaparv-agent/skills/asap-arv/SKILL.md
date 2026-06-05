---
name: asap-arv
description: Full context for the ASAP ARV scraper in /Users/chrislovera/asaparv-agent/asaparv-scraper.js. Use when working on ARV analysis, comp pulling, offer calculations, mid-call triggers, or the asap-worker PM2 processes.
---

# ASAP ARV Scraper — Complete Reference

## File & Process
- **Main file**: `/Users/chrislovera/asaparv-agent/asaparv-scraper.js`
- **PM2 processes**: `asap-worker-1` and `asap-worker-2` (persistent, autorestart)
  - Worker 1: odd city IDs (Orlando, Jacksonville, Fort Lauderdale, Houston, Phoenix)
  - Worker 2: even city IDs (Tampa, Miami, Atlanta, Dallas, Charlotte)
- **Legacy**: `asap-scraper` process (older, use workers instead)

## What It Does
Logs into `https://www.asaparv.com` using Playwright (headless Chromium), runs an ARV analysis for a given property address, extracts the ARV, repair estimate, and 60/65/70% offer prices, and returns structured data.

---

## Main Export
```javascript
const { runAsapArv } = require('./asaparv-scraper');

const result = await runAsapArv("123 Main St, Tampa FL 33601");
// Returns:
{
  success: boolean,
  arv: number | null,             // After Repair Value in dollars
  repairEstimate: number | null,  // Estimated repair cost
  offer60: number | null,         // ARV * 0.60 - repairs
  offer65: number | null,         // ARV * 0.65 - repairs
  offer70: number | null,         // ARV * 0.70 - repairs
  reportUrl: string | null,       // URL to the ASAP report page
  rawText: string,                // Raw text extracted from the page
  error: string | null,           // Error message if failed
  propertyDetails: object | null, // beds/baths/sqft/year built
}
```

## CLI Usage
```bash
cd /Users/chrislovera/asaparv-agent
node asaparv-scraper.js "123 Main St, Tampa FL 33601"
```

---

## How It Works (step by step)

1. **Login** — navigates to `https://www.asaparv.com/auth/login`, fills email + password, submits
2. **Navigate** — goes to `/dashboard/analyze`
3. **Enter address** — types address into search field, waits for autocomplete, selects first result
4. **Wait for analysis** — ASAP runs its comp analysis (can take 15-45 seconds)
5. **Extract data** — parses ARV, repair estimate, comp addresses + sale prices from the results page
6. **Screenshot** — saves debug screenshots to `debug-screenshots/` on each step
7. **Return** — structured result object

## Credentials (in .env)
```
ASAPARV_EMAIL=Chrislovera7@gmail.com
ASAPARV_PASSWORD=Sports098
```

---

## Integration with David Caller

### Mid-call Auto-trigger (jarvis-caller.js)
- After turn 3 of any real conversation, `runAsapArv(lead.address)` fires automatically in background
- Result stored in `state.arvData` on the call state
- When call ends and score ≥ 7, `triggerDealApproval()` uses `state.arvData` (no extra wait)

```javascript
// In processSellerSpeech (turn 3+):
if (state.turnNum >= 3 && !state.arvTriggered && lead.address) {
  state.arvTriggered = true;
  runAsapArv(lead.address).then(arv => {
    const s = callStore.get(callId);
    if (s) { s.arvData = arv; callStore.set(callId, s); }
  });
}

// In triggerDealApproval():
const arv = preloadedArv?.success ? preloadedArv : await runAsapArv(lead.address);
```

### Deal Approval Card Data (from ARV result)
The Telegram hot lead card shows:
- `💎 ARV: $X` — `arv.arv`
- `Repairs: $X` — `arv.repairEstimate`
- `60%: $X | 65%: $X | 70%: $X` — `arv.offer60 / offer65 / offer70`
- Approval buttons use these exact dollar amounts

---

## Supabase Tables Used
| Table | Purpose |
|---|---|
| `asap_sold_properties` | Sold comp data extracted from ASAP (address, sale price, date) |
| `asap_cities` | City scraping queue and status (city name, status, last_scraped) |

---

## Workers vs Single Run
| Mode | When to Use |
|---|---|
| `asap-worker-1` / `asap-worker-2` (PM2) | Background continuous city scraping |
| `runAsapArv(address)` (module call) | Single property ARV — used by David during calls |
| `node asaparv-scraper.js "address"` | Manual CLI test |

### Worker Args
```bash
source ~/.nvm/nvm.sh && pm2 start ecosystem.config.js --only asap-worker-1
source ~/.nvm/nvm.sh && pm2 start ecosystem.config.js --only asap-worker-2
```

---

## Debug Screenshots
If scraper fails, check `debug-screenshots/` in the project root:
```bash
ls /Users/chrislovera/asaparv-agent/debug-screenshots/
# Files named: asaparv-01-login-{timestamp}.png, asaparv-02-after-login-{timestamp}.png, etc.
```
Steps captured: login page, after login, analyze page, address entered, results page.

---

## Common Mistakes to Avoid

1. **Address format matters** — ASAP ARV autocomplete works best with full address including city + state + zip. `"123 Main St, Tampa FL 33601"` is ideal. Short addresses may not find a match.

2. **It uses Playwright (headless browser)** — not a REST API. Login session is created fresh each call. There's no auth token to cache.

3. **Takes 15-60 seconds** — don't await it synchronously on the main call path. Always run in background (`runAsapArv(addr).then(...)`) to avoid blocking the conversation.

4. **`result.success` check** — always check `arv.success` before using `arv.arv`. If login failed or address not found, `success: false` and values are null.

5. **`getSubjectPropertyDetails()`** — a separate module (`subject-property-lookup.js`) called in parallel with the browser session to get beds/baths/sqft. It can fail independently without failing the ARV scrape.

6. **Never run both workers on the same city** — worker 1 handles odd IDs, worker 2 handles even IDs. This prevents duplicate scraping.

7. **ASAP credentials are hardcoded as fallback** — `ASAPARV_EMAIL` / `ASAPARV_PASSWORD` in .env override the hardcoded values. If you see login failures, check that the .env values are correct.

---

## Manual Test
```bash
cd /Users/chrislovera/asaparv-agent
node -e "const { runAsapArv } = require('./asaparv-scraper'); runAsapArv('2847 Oakwood Dr, Orlando FL 32806').then(r => console.log(JSON.stringify(r, null, 2)))"
```

## Worker Status
```bash
source ~/.nvm/nvm.sh && pm2 logs asap-worker-1 --lines 20 --nostream
source ~/.nvm/nvm.sh && pm2 logs asap-worker-2 --lines 20 --nostream
```
