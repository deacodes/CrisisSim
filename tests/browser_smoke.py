"""Run against a running local API: python tests/browser_smoke.py [base URL]."""
import json
from pathlib import Path
import sys
import os
from playwright.sync_api import sync_playwright, expect


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
        page.locator("#connection-state").filter(has_text="Backend connected").wait_for()
        page.locator('[name="name"]').fill("Browser verification")
        for name, value in (("duration", "600"), ("warning", "1"), ("preparation", "1")):
            page.locator(f'[name="{name}"]').fill(value)
        page.locator('[data-action="step-2"]:visible').click()
        page.locator('[name="population"]').fill("32")
        page.locator('[name="mesh"]').fill("4")
        page.locator('[data-action="step-3"]:visible').click()
        page.locator('[data-action="step-4"]').click()
        page.get_by_role("button", name="Save scenario", exact=True).click()
        page.wait_for_url("**/scenarios.html")
        page.locator('[data-action="scenario-run"]').first.click()
        page.wait_for_url("**/command-center.html")
        page.locator("#run-status").filter(has_text="completed").wait_for(timeout=60000)
        page.locator("#computed-map canvas").wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        page.screenshot(path=str(screenshots/"command-desktop.png"), full_page=True)
        page.locator("[data-map-mode]").select_option("2d")
        page.locator("#computed-map svg").wait_for()
        page.get_by_role("button", name="Zoom in", exact=True).click()
        page.get_by_role("button", name="Pan left", exact=True).click()
        page.get_by_role("button", name="Reset", exact=True).click()
        page.locator("#replay").fill("1")
        page.locator("#replay").dispatch_event("change")
        page.get_by_role("button", name="Save checkpoint", exact=True).click()
        page.get_by_role("button", name="Return to latest", exact=True).click()
        # Numerical UI values must match the saved backend snapshot.
        rid = page.evaluate("localStorage.getItem('crisissim_run_id')")
        run = page.request.get(base+f"/api/v1/runs/{rid}").json()
        snap = page.request.get(base+f"/api/v1/runs/{rid}/artifacts/snapshot-{run['sequence']}.json").json()
        expect(page.locator('[data-metric="safe"]')).to_have_text(str(snap["metrics"]["safely_evacuated"]))
        assert snap["metrics"]["safely_evacuated"] + snap["metrics"]["incomplete_count"] == 32
        # Policy Lab must track experiment jobs, including with WebSockets unavailable.
        page.add_init_script("""
          window.WebSocket = class {
            constructor() { setTimeout(() => { this.onerror?.({}); this.onclose?.({}); }, 30); }
            close() {}
          };
        """)
        page.goto(base+"/policy-lab.html")
        page.locator("#experiment-select").wait_for()
        page.locator('[data-action="compare"]').click()
        page.locator("#experiment-status").filter(has_text="completed").wait_for(timeout=60000)
        assert page.locator('[data-view="experiment-table"] tbody tr').count() == 3
        assert "Vulnerability-prioritized" in page.locator('[data-view="experiment-table"]').inner_text()
        page.screenshot(path=str(screenshots/"policy-desktop.png"), full_page=True)
        page.goto(base+"/uncertainty.html")
        page.locator("#trial-count").fill("2")
        page.locator('[data-action="monte_carlo"]').click()
        page.locator("#experiment-status").filter(has_text="completed").wait_for(timeout=60000)
        assert page.locator('[data-view="quantiles"] tbody tr').count() == 3
        overflows = []
        for route in ("index", "city-model", "equity-analysis", "system-dynamics",
                      "policy-lab", "uncertainty", "reports", "methodology", "settings"):
            page.goto(f"{base}/{route}.html")
            page.locator("#app-content h1").wait_for()
            page.wait_for_timeout(400)
            assert not page.locator("#app-error").inner_text(), (route, page.locator("#app-error").inner_text())
            assert page.locator('script[src="js/state.js"], script[src="js/data.js"]').count() == 0
            page.set_viewport_size({"width": 390, "height": 844})
            if page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"):
                overflows.append(route)
            page.set_viewport_size({"width": 1440, "height": 1000})
        page.goto(base+"/command-center.html")
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#computed-map svg").wait_for()
        page.screenshot(path=str(screenshots/"command-mobile.png"), full_page=True)
        overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        assert not overflow, "mobile horizontal overflow"
        assert not overflows, f"mobile overflow on {overflows}"
        browser.close()
    assert not errors, errors
    print(json.dumps({"browser_errors": errors, "pages_checked": 12, "mobile_overflow": overflow}))


if __name__ == "__main__":
    main()
