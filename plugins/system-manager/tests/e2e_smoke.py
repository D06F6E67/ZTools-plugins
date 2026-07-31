from pathlib import Path
import os

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "screenshots" / "main.png"
BASE_URL = os.environ.get("SYSTEM_MANAGER_E2E_URL", "http://127.0.0.1:8877").rstrip("/")
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
MODULES = [
    "system-diagnostic-report",
    "application-uninstaller",
    "startup-manager",
    "system-cleaner",
    "lan-device-discovery",
]


def assert_no_overflow(page):
    dimensions = page.evaluate(
        """() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        })"""
    )
    assert dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1, dimensions


with sync_playwright() as playwright:
    launch = {"headless": True}
    if CHROME.exists():
        launch["executable_path"] = str(CHROME)
    browser = playwright.chromium.launch(**launch)

    page = browser.new_page(viewport={"width": 720, "height": 480}, color_scheme="light")
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("heading", name="系统管家", exact=True).wait_for()
    assert page.locator(".module-card").count() == 5
    assert len(page.locator(".module-grid").evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ')")) == 2
    assert_no_overflow(page)
    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOT), full_page=True)

    page.locator('[data-feature="application-uninstaller"]').click(modifiers=["Shift"])
    modified_home_link = page.get_by_role("link", name="返回系统管家首页")
    modified_home_link.wait_for()
    modified_home_link.click(button="middle")
    page.get_by_role("heading", name="系统管家", exact=True).wait_for()

    for module_id in MODULES:
        page.goto(f"{BASE_URL}/modules/{module_id}/index.html", wait_until="networkidle")
        home_link = page.get_by_role("link", name="返回系统管家首页")
        home_link.wait_for()
        assert home_link.get_attribute("href") == "../../index.html"
        assert_no_overflow(page)
        if module_id in {"system-diagnostic-report", "system-cleaner"}:
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            suite_box = page.locator(".system-manager-suitebar").bounding_box()
            topbar_box = page.locator(".topbar").first.bounding_box()
            assert suite_box and topbar_box, module_id
            assert topbar_box["y"] >= suite_box["height"] - 1, {
                "module": module_id,
                "suitebar": suite_box,
                "topbar": topbar_box,
            }
            page.evaluate("window.scrollTo(0, 0)")
        home_link.click()
        page.get_by_role("heading", name="系统管家", exact=True).wait_for()

    compact = browser.new_page(viewport={"width": 360, "height": 480}, color_scheme="dark")
    compact_errors = []
    compact.on("console", lambda message: compact_errors.append(message.text) if message.type == "error" else None)
    compact.goto(BASE_URL, wait_until="networkidle")
    compact.get_by_role("heading", name="系统管家", exact=True).wait_for()
    assert compact.locator(".module-card").count() == 5
    assert len(compact.locator(".module-grid").evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ')")) == 1
    assert_no_overflow(compact)
    compact.close()

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    assert not compact_errors, compact_errors
    browser.close()

print(f"System Manager E2E passed: {SCREENSHOT}")
