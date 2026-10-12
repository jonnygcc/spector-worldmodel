import { chromium } from "playwright-core";

const BROWSER_PATH =
  "C:/Users/user/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

export interface PageCapture {
  url: string;
  title: string;
  headings: string[];
  links: { text: string; href: string }[];
  buttons: string[];
  forms: number;
  images: { alt: string; src: string }[];
  metaDescription: string;
}

export async function capturePage(url: string): Promise<PageCapture> {
  const browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  const capture: PageCapture = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map(
      (el) => `${el.tagName}: ${el.textContent?.trim()}`
    );

    const links = Array.from(document.querySelectorAll("a"))
      .slice(0, 30)
      .map((el) => ({
        text: el.textContent?.trim() || "",
        href: el.href || "",
      }));

    const buttons = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='submit']")
    ).map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || "unnamed");

    const forms = document.querySelectorAll("form").length;

    const images = Array.from(document.querySelectorAll("img"))
      .slice(0, 20)
      .map((el) => ({
        alt: el.alt || "",
        src: el.src || "",
      }));

    const metaDescription =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") || "";

    return {
      url: window.location.href,
      title: document.title,
      headings,
      links,
      buttons,
      forms,
      images,
      metaDescription,
    };
  });

  await browser.close();
  return capture;
}