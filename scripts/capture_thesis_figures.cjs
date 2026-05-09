// Capture thesis figure panels from the OcularClaw frontend at 2x DPI.
// Usage: node scripts/capture_thesis_figures.js
// Requires the dev server already running on http://localhost:5173.
//
// Outputs PNGs to artifacts/figures/live_session/.

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

const OUT_DIR = path.resolve(__dirname, "..", "artifacts", "figures", "live_session");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = "http://localhost:5173";

async function gotoLive(page, demo) {
  await page.goto(`${BASE}/?demo=${demo}`, { waitUntil: "networkidle0" });
  // Click the Live Session toggle
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(
      (b) => b.textContent.trim() === "Live Session",
    );
    btns[0]?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
}

// Walk up from a node until we find an ancestor with a rounded card class.
async function findCard(page, matchText) {
  return page.evaluateHandle((needle) => {
    const all = [...document.querySelectorAll("h2, h3, h4, p, span")];
    const node = all.find((el) => {
      return [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.includes(needle),
      );
    });
    if (!node) return null;
    let cur = node;
    while (cur && cur.parentElement) {
      const cls = cur.className || "";
      if (typeof cls === "string" && /rounded-2xl|rounded-xl/.test(cls)) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return node.closest("section, div");
  }, matchText);
}

async function shotByText(page, matchText, filename) {
  const handle = await findCard(page, matchText);
  const el = handle.asElement();
  if (!el) {
    console.warn(`MISS: ${matchText}`);
    return;
  }
  await el.scrollIntoView();
  await new Promise((r) => setTimeout(r, 200));
  const out = path.join(OUT_DIR, filename);
  await el.screenshot({ path: out, omitBackground: false });
  console.log(`  ${filename}`);
}

(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();

  // Panel (a): Scenario briefing card from User Study mode
  await gotoLive(page, "exit"); // exit also lands in User Study with S1 selected
  await shotByText(page, "Scenario Briefing", "panel_a_scenario_briefing.png");

  // Panel (b): Active recommendation card during running session
  await gotoLive(page, "active");
  await shotByText(page, "Clarify project scope", "panel_b_recommendation_card.png");
  // Also a wide variant: full transcript + card region
  {
    const wide = await page.evaluateHandle(() => {
      const node = [...document.querySelectorAll("*")].find((el) =>
        /Clarify project scope/.test(el.textContent || ""),
      );
      return node ? node.closest("[class*='rounded-2xl'], [class*='border']") : null;
    });
    const el = wide.asElement();
    if (el) {
      await el.scrollIntoView();
      await new Promise((r) => setTimeout(r, 200));
      await el.screenshot({
        path: path.join(OUT_DIR, "panel_b_card_only.png"),
      });
      console.log("  panel_b_card_only.png");
    }
  }
  // Full live session view (header + transcript + card + speaker bar)
  await page.screenshot({
    path: path.join(OUT_DIR, "panel_b_full_live_view.png"),
    fullPage: false,
  });
  console.log("  panel_b_full_live_view.png");

  // Panel (c): Post-scenario instrument
  await gotoLive(page, "ended");
  await shotByText(page, "Session Review", "panel_c_session_review.png");

  // Panel (d): Exit survey
  await gotoLive(page, "exit");
  await shotByText(page, "Exit Survey — Final Thoughts", "panel_d_exit_survey.png");

  await browser.close();
  console.log(`\nDone — see ${OUT_DIR}`);
})();
