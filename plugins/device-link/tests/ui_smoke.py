from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" and "favicon.ico" not in message.text else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.get_by_role("heading", name="发送给我的设备").wait_for()
    assert page.get_by_text("Harris 的 iPhone", exact=True).count() >= 1
    page.screenshot(path=str(ARTIFACTS / "desktop-main.png"), full_page=True)

    page.get_by_role("button", name="连接新设备").click()
    page.get_by_role("heading", name="连接一台新设备").wait_for()
    page.wait_for_timeout(250)
    assert page.get_by_text("834921", exact=False).count() >= 1
    page.screenshot(path=str(ARTIFACTS / "desktop-pairing.png"), full_page=True)
    page.get_by_role("button", name="关闭").click()

    page.get_by_role("button", name="设置与同步").click()
    page.get_by_role("heading", name="设置与同步").wait_for()
    page.wait_for_timeout(250)
    assert page.get_by_text("加密 WebDAV", exact=True).count() == 1
    page.screenshot(path=str(ARTIFACTS / "desktop-settings.png"), full_page=True)
    assert not errors, errors
    browser.close()
