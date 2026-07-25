import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(frontendRoot, "..");
const tempDir = resolve(workspaceRoot, "temps/visual-regression");
const shouldUpdate = process.argv.includes("--update");
const suppliedBaseUrl = process.env.VISUAL_BASE_URL;
const screenshotScenarios = [
  { key: "foundation-controls", theme: "light", colorScheme: "light" },
  { key: "foundation-controls-dark", theme: "dark", colorScheme: "dark" },
];

function screenshotPaths(key) {
  return {
    baselinePath: resolve(frontendRoot, `tests/visual/__screenshots__/${key}.png`),
    actualPath: resolve(tempDir, `${key}.actual.png`),
    diffPath: resolve(tempDir, `${key}.diff.png`),
  };
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite 尚未完成启动。
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`视觉回归服务未能在 30 秒内启动：${baseUrl}`);
}

function startVite() {
  const viteEntry = resolve(frontendRoot, "node_modules/vite/bin/vite.js");
  return spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
    cwd: frontendRoot,
    stdio: "ignore",
    windowsHide: true,
  });
}

function getExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return undefined;
}

async function compareScreenshots({ baselinePath, actualPath, diffPath }) {
  const [baselineBuffer, actualBuffer] = await Promise.all([readFile(baselinePath), readFile(actualPath)]);
  const baseline = PNG.sync.read(baselineBuffer);
  const actual = PNG.sync.read(actualBuffer);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(`视觉回归尺寸变化：基线 ${baseline.width}×${baseline.height}，当前 ${actual.width}×${actual.height}。`);
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.1, includeAA: false },
  );

  if (diffPixels > 0) {
    await writeFile(diffPath, PNG.sync.write(diff));
    throw new Error(`视觉回归发现 ${diffPixels} 个像素变化。差异图：${diffPath}`);
  }
}

let viteProcess;
let browser;

try {
  await mkdir(tempDir, { recursive: true });
  const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:4173";
  if (!suppliedBaseUrl) {
    viteProcess = startVite();
    await waitForServer(baseUrl);
  }

  const executablePath = getExecutablePath();
  browser = await chromium.launch(
    executablePath
      ? { executablePath, headless: true }
      : { channel: "chrome", headless: true },
  );
  for (const scenario of screenshotScenarios) {
    const paths = screenshotPaths(scenario.key);
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript((theme) => window.localStorage.setItem("theme", theme), scenario.theme);
    await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: "reduce" });
    await page.goto(`${baseUrl}/__visual-regression`, { waitUntil: "domcontentloaded" });
    await page.locator(`[data-theme="${scenario.theme}"]`).waitFor();
    await page.locator("[data-visual-regression]").waitFor();
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
    await page.locator("[data-visual-regression]").screenshot({ path: paths.actualPath });

    if (shouldUpdate) {
      await mkdir(dirname(paths.baselinePath), { recursive: true });
      await copyFile(paths.actualPath, paths.baselinePath);
      console.log(`视觉基线已更新：${paths.baselinePath}`);
    } else if (!(await pathExists(paths.baselinePath))) {
      throw new Error(`缺少视觉基线。请先运行：pnpm test:visual -- --update`);
    } else {
      await compareScreenshots(paths);
      console.log(`视觉截图回归通过：${scenario.key}`);
    }

    await page.close();
  }
} finally {
  await browser?.close();
  viteProcess?.kill();
}
