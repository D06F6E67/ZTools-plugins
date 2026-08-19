import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOBILE_HTML = (ROOT / "public" / "web" / "index.html").read_text()
MOBILE_APP = (ROOT / "public" / "web" / "app.js").read_text()
FALLBACK_CRYPTO = (ROOT / "public" / "web" / "crypto-fallback.js").read_text()

old_pairing = {
    "version": 1,
    "sessionId": "old-pairing-session",
    "salt": "AAAAAAAAAAAAAAAAAAAAAA",
    "challenge": "old-challenge",
    "expiresAt": "2099-01-01T00:00:00.000Z",
    "deviceName": "测试电脑",
    "iterations": 210000,
}
new_pairing = {
    **old_pairing,
    "sessionId": "new-pairing-session",
    "challenge": "new-challenge",
}
active_pairing = old_pairing
pair_requests = []
pairing_request_count = 0


def route_request(route):
    global pairing_request_count
    request = route.request
    if request.url == "http://device.test/":
        route.fulfill(status=200, content_type="text/html", body=MOBILE_HTML)
    elif request.url == "http://device.test/crypto-fallback.js":
        route.fulfill(status=200, content_type="application/javascript", body=FALLBACK_CRYPTO)
    elif request.url == "http://device.test/app.js":
        route.fulfill(status=200, content_type="application/javascript", body=MOBILE_APP)
    elif request.url == "http://device.test/api/pairing":
        pairing_request_count += 1
        route.fulfill(status=200, content_type="application/json", body=json.dumps(active_pairing))
    elif request.url == "http://device.test/api/pair" and request.method == "POST":
        pair_requests.append(request.post_data_json)
        route.fulfill(status=418, content_type="application/json", body=json.dumps({"error": "已提交最新配对代次"}))
    else:
        route.abort()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/*", route_request)
    page.goto("http://device.test/#pair=old-secret", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("二维码缺少配对会话标识", exact=True).wait_for()

    active_pairing = new_pairing
    pair_requests.clear()
    pairing_request_count = 0
    page.goto(f"http://device.test/?pairing={new_pairing['sessionId']}#pair=new-secret", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("已提交最新配对代次", exact=True).wait_for()

    assert pairing_request_count >= 1
    assert len(pair_requests) == 1
    assert pair_requests[0]["sessionId"] == new_pairing["sessionId"]
    assert "配对信息已过期" not in page.locator("#pairError").inner_text()
    assert not errors, errors
    browser.close()
