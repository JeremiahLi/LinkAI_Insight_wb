import pw from "file:///C:/Users/Lenovo/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js";
const { chromium } = pw;

const exe = "C:/Users/Lenovo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3002/user-stats", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: ".tmp-shots/user-board-7d.png", fullPage: true });

// 切到近30天
await page.getByText("近30天", { exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: ".tmp-shots/user-board-30d.png", fullPage: true });

// 侧栏
await page.screenshot({ path: ".tmp-shots/sidebar.png", clip: { x: 0, y: 0, width: 300, height: 500 } });

console.log("errors:", JSON.stringify(errors, null, 2));
await browser.close();
