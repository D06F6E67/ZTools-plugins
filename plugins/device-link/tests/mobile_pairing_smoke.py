import base64
import hashlib
import hmac
import json
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
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
    "manualKey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "expiresAt": "2099-01-01T00:00:00.000Z",
    "deviceName": "测试电脑",
    "serverDeviceId": "desktop-device",
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
resume_requests = []
message_requests = []
resume_secret_bytes = bytes(range(32))
session_key_bytes = bytes(range(32, 64))
resume_secret = base64.urlsafe_b64encode(resume_secret_bytes).decode().rstrip("=")
resume_challenge = {"challengeId": "resume-challenge-id", "challenge": "resume-challenge", "serverDeviceId": "desktop-device"}


def encrypted_json(key, value, aad):
    iv = bytes(range(12))
    encrypted = AESGCM(key).encrypt(iv, json.dumps(value).encode(), aad.encode())
    envelope = iv + encrypted[-16:] + encrypted[:-16]
    return base64.urlsafe_b64encode(envelope).decode().rstrip("=")


def route_request(route):
    global pairing_request_count
    request = route.request
    request_url = urlsplit(request.url)
    if request_url.netloc == "device.test" and request_url.path == "/":
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
    elif request.url == "http://device.test/api/resume/challenge" and request.method == "POST":
        resume_requests.append(request.post_data_json)
        route.fulfill(status=200, content_type="application/json", body=json.dumps(resume_challenge))
    elif request.url == "http://device.test/api/resume" and request.method == "POST":
        resume_requests.append(request.post_data_json)
        package = encrypted_json(resume_secret_bytes, {
            "token": "resumed-token",
            "sessionKey": base64.urlsafe_b64encode(session_key_bytes).decode().rstrip("="),
            "deviceId": "trusted-phone-1234",
            "serverDeviceId": "desktop-device",
            "expiresAt": "2099-01-01T00:00:00.000Z",
        }, "resume:trusted-phone-1234:resume-challenge-id")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"package": package}))
    elif request.url == "http://device.test/api/messages" and request.method == "GET":
        message_requests.append(request.headers)
        data = encrypted_json(session_key_bytes, [], "messages:trusted-phone-1234")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": data}))
    else:
        route.abort()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page()
    page.add_init_script("""
      (() => {
        window.__testSockets = []
        class TestWebSocket {
          constructor(url) {
            this.url = url
            this.readyState = 0
            window.__testSockets.push(this)
            setTimeout(() => {
              if (this.readyState !== 0) return
              this.readyState = 1
              this.onopen?.()
            }, 0)
          }
          send() {}
          close(code = 1000, reason = '') {
            if (this.readyState === 3) return
            this.readyState = 3
            this.onclose?.({ code, reason })
          }
        }
        TestWebSocket.OPEN = 1
        TestWebSocket.CLOSED = 3
        window.WebSocket = TestWebSocket
      })()
    """)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/*", route_request)
    page.goto("http://device.test/#pair=old-secret", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("二维码缺少配对会话标识，请重新扫描最新二维码", exact=True).wait_for()

    active_pairing = new_pairing
    pair_requests.clear()
    pairing_request_count = 0
    page.goto("http://device.test/?pairing=old-pairing-session#pair=old-secret", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("配对信息已过期，请在电脑端刷新二维码", exact=True).wait_for()
    assert not pair_requests

    pair_requests.clear()
    pairing_request_count = 0
    page.goto("http://device.test/", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("已提交最新配对代次", exact=True).wait_for()
    assert len(pair_requests) == 1
    assert pair_requests[0]["mode"] == "manual"

    pair_requests.clear()
    pairing_request_count = 0
    page.goto(f"http://device.test/?pairing={new_pairing['sessionId']}#pair=new-secret", wait_until="networkidle")
    page.get_by_text("测试电脑", exact=True).wait_for()
    page.get_by_label("匹配码").fill("592748")
    page.get_by_role("button", name="安全连接").click()
    page.get_by_text("已提交最新配对代次", exact=True).wait_for()

    assert pairing_request_count >= 1
    assert len(pair_requests) == 1
    assert pair_requests[0]["mode"] == "qr"
    assert pair_requests[0]["sessionId"] == new_pairing["sessionId"]
    assert "配对信息已过期" not in page.locator("#pairError").inner_text()

    page.evaluate("""
      ({ resumeSecret }) => {
        sessionStorage.clear()
        localStorage.setItem('deviceLinkTrustedDevice', JSON.stringify({
          deviceId: 'trusted-phone-1234', resumeSecret, serverDeviceId: 'desktop-device'
        }))
      }
    """, {"resumeSecret": resume_secret})
    page.goto("http://device.test/", wait_until="networkidle")
    page.locator("#chatApp").wait_for(state="visible")
    expected_proof = base64.urlsafe_b64encode(hmac.new(
        resume_secret_bytes,
        b"device-link-resume-v1:resume-challenge-id:resume-challenge",
        hashlib.sha256,
    ).digest()).decode().rstrip("=")
    assert resume_requests[0]["deviceId"] == "trusted-phone-1234"
    assert resume_requests[1]["proof"] == expected_proof
    assert message_requests[0]["authorization"] == "Bearer resumed-token"
    page.evaluate("window.__testSockets.at(-1).close(1001, 'server restart')")
    page.wait_for_function("window.__testSockets.length >= 2", timeout=5000)
    assert len(resume_requests) == 4
    assert len(message_requests) == 2
    assert not errors, errors
    browser.close()
