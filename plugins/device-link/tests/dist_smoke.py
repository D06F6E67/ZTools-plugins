import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
URL = os.environ.get("DEVICE_LINK_TEST_URL", "http://127.0.0.1:4173")

STATE = {
    "settings": {
        "deviceName": "测试电脑",
        "port": 32125,
        "pairingCodeMode": "random",
        "customPairingCodeSet": False,
        "autoAcceptTrustedText": True,
        "autoAcceptTrustedFiles": False,
        "maxIncomingFileBytes": 10 * 1024**3,
        "webdav": {
            "enabled": False,
            "baseUrl": "",
            "username": "",
            "hasPassword": False,
            "hasSyncPassword": False,
            "status": "disabled",
        },
    },
    "server": {
        "running": True,
        "port": 32125,
        "lanIPs": ["192.168.1.2"],
        "selectedIP": "192.168.1.2",
        "accessUrl": "http://192.168.1.2:32125",
        "pairingUrl": "http://192.168.1.2:32125/#pair=test",
        "pairingCode": "123456",
        "pairingExpiresAt": "2099-01-01T00:00:00.000Z",
        "qrDataUrl": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
    "devices": [],
    "messages": [],
}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 820})
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        f"""
        (() => {{
          const state = {json.dumps(STATE)};
          const clone = value => JSON.parse(JSON.stringify(value));
          window.ztools = {{ onPluginEnter() {{}} }};
          window.deviceLink = {{
            async getState() {{ return clone(state); }},
            subscribe() {{ return () => {{}}; }}
          }};
        }})()
        """
    )
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("heading", name="发送给我的设备").wait_for()
    assert page.locator("#app > .app-shell").count() == 1
    assert not errors, errors
    page.screenshot(path=str(ARTIFACTS / "dist-main.png"), full_page=True)
    browser.close()
