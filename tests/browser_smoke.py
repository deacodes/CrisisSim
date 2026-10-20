"""Run against a running local API: python tests/browser_smoke.py [base URL]."""
import json
from pathlib import Path
import sys
import os
from playwright.sync_api import sync_playwright


def main():
    if "--allow-browser" not in sys.argv:
        raise SystemExit("Browser testing is opt-in. Obtain permission, then pass --allow-browser.")
    sys.argv.remove("--allow-browser")
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
    screenshots = Path("work/browser")
    screenshots.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.getenv("PLAYWRIGHT_CHROME"),
            headless=True, args=["--enable-webgl", "--use-angle=swiftshader"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base+"/new-scenario.html")
        page.locator('[name="name"]').fill("Browser verification")
        for name, value in (("population", "32"), ("duration", "600"),
                            ("warning", "1"), ("preparation", "1"), ("mesh", "4")):
            page.locator(f'[name="{name}"]').fill(value)
        page.get_by_role("button", name="Save scenario", exact=True).click()
        page.wait_for_url("**/scenarios.html")
        page.locator("[data-run]").first.click()
        page.wait_for_url("**/command-center.html")
        page.locator("#run-status").filter(has_text="completed").wait_for(timeout=60000)
        page.locator("#computed-map canvas").wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        page.screenshot(path=str(screenshots/"command-desktop.png"), full_page=True)
        page.locator("#map-mode").select_option("2d")
        page.locator("#computed-map svg").wait_for()
        page.get_by_role("button", name="Zoom in", exact=True).click()
        page.get_by_role("button", name="Pan left", exact=True).click()
        page.get_by_role("button", name="Reset view", exact=True).click()
        page.locator("#replay").fill("1")
        page.locator("#replay").dispatch_event("change")
        page.get_by_role("button", name="Save checkpoint", exact=True).click()
        page.get_by_role("button", name="Return to latest", exact=True).click()
        for route in ("index", "city-model", "equity-analysis", "system-dynamics",
                      "policy-lab", "uncertainty", "reports", "methodology", "settings"):
            page.goto(f"{base}/{route}.html")
            page.locator("#live-content h1").wait_for()
            page.wait_for_timeout(250)
            assert not page.locator("#live-error").inner_text(), (route, page.locator("#live-error").inner_text())
        page.goto(base+"/command-center.html")
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#computed-map svg").wait_for()
        page.screenshot(path=str(screenshots/"command-mobile.png"), full_page=True)
        overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        assert not overflow, "mobile horizontal overflow"
        browser.close()
    assert not errors, errors
    print(json.dumps({"browser_errors": errors, "pages_checked": 12, "mobile_overflow": overflow}))


if __name__ == "__main__":
    main()
