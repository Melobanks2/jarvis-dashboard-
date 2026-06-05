const { chromium } = require("playwright");
async function debug() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();

  // Login
  await page.goto("https://alphaleads-va.vercel.app/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill('input[type="text"]', "Azuallc2@gmail.com");
  await page.fill('input[type="password"]', "Sports@098");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  // Dismiss tour overlay if present
  const skipTour = page.locator('button:has-text("Skip")');
  if (await skipTour.count() > 0) {
    console.log("Dismissing tour...");
    await skipTour.click();
    await page.waitForTimeout(1000);
  }

  // Remove overlay via JS as fallback
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-test-id="overlay"]');
    if (overlay) overlay.remove();
    const portal = document.querySelector('#react-joyride-portal');
    if (portal) portal.remove();
  });
  await page.waitForTimeout(500);

  // Click first lead row
  console.log("Clicking first row...");
  await page.locator("table tbody tr").first().click({ force: true });
  await page.waitForTimeout(3000);

  // Get the expanded content
  const pageText = await page.evaluate(() => document.body.innerText?.substring(0, 5000));
  console.log("=== PAGE AFTER EXPAND ===\n", pageText);

  // Look for expanded row content
  const expandedHTML = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tbody tr");
    let html = "";
    rows.forEach((tr, i) => {
      html += `\n--- ROW ${i} ---\n` + tr.innerText;
    });
    return html.substring(0, 4000);
  });
  console.log("=== ALL ROW TEXT ===\n", expandedHTML);

  await browser.close();
}
debug().catch(e => { console.error(e); process.exit(1); });
