"""Opt-in integration test for the original HTML frontend, isolated Chromium only."""
import json
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect


def main():
    if "--allow-browser" not in sys.argv:
        raise SystemExit("Pass --allow-browser after obtaining permission for an isolated browser.")
    base = next((s for s in sys.argv[1:] if s.startswith("http")), "http://127.0.0.1:8012")
    output = Path("work/browser-original")
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--enable-webgl", "--use-angle=swiftshader"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            page.goto(base + "/new-scenario.html")
            page.locator("#advanced-population").wait_for(state="attached")
            page.locator("#input-name").fill('Original frontend QA <test>')
            page.locator("#input-duration").select_option("600")
            page.locator("#input-warning").fill("1")
            page.get_by_role("button", name="Next: City Configuration").click()
            page.get_by_text("Numerical model settings", exact=True).click()
            page.locator("#advanced-population").fill("32")
            page.locator("#advanced-mesh").fill("4")
            page.locator("#advanced-preparation").fill("1")
            page.get_by_role("button", name="Next: Resources").click()
            page.get_by_role("button", name="Next: Review").click()
            page.get_by_role("button", name="Create & Launch Simulation").click()
            page.wait_for_url("**/command-center.html?id=*", timeout=30000)
            page.wait_for_function("window.CrisisBackend?.state.run?.status === 'completed'", timeout=60000)
            page.wait_for_function("window.CrisisBackend?.state.frame === window.CrisisBackend?.state.run?.sequence")
            page.locator("#command-center-map-wrapper canvas").wait_for(timeout=30000)
            page.wait_for_function("window.CrisisBackend.state.maps[0].loaded")
            run = page.evaluate("window.CrisisBackend.state.run")
            snap = page.request.get(base + f"/api/v1/runs/{run['id']}/artifacts/snapshot-{run['sequence']}.json").json()
            expect(page.locator("#cc-metric-evac")).to_have_text(str(snap["metrics"]["safely_evacuated"]))
            assert snap["metrics"]["population"] == 32
            assert sum(snap["metrics"]["state_counts"].values()) == 32
            assert page.locator(".command-workspace > .panel-col").count() == 2
            page.screenshot(path=str(output / "command-desktop.png"), full_page=True)
            page.locator("#sim-time-scrubber").fill("1")
            page.locator("#sim-time-scrubber").dispatch_event("input")
            page.wait_for_function("window.CrisisBackend.state.frame === 1")
            page.get_by_text("Run history and backend controls", exact=True).click()
            page.get_by_role("button", name="Checkpoint", exact=True).click()
            expect(page.locator("#backend-message")).to_contain_text("Checkpoint recipe saved")
            page.get_by_role("button", name="Latest frame", exact=True).click()
            page.wait_for_function("!window.CrisisBackend.state.replay")
            page.get_by_role("button", name="2D map", exact=True).click()
            page.locator("#command-center-map-wrapper .map-3d-canvas svg").wait_for()
            page.get_by_role("button", name="Zoom in", exact=True).click()
            page.get_by_role("button", name="Reset view", exact=True).click()
            page.get_by_role("button", name="3D map", exact=True).click()
            page.locator("#command-center-map-wrapper canvas").wait_for()
            # The experiment observer must work with its own WebSocket path and
            # remain usable when WebSockets fail.
            page.add_init_script("""
                window.WebSocket = class {
                  constructor() { setTimeout(() => { this.onerror?.({}); this.onclose?.({}); }, 20); }
                  close() {}
                };
            """)
            page.goto(base + "/policy-lab.html")
            page.wait_for_function("window.CrisisBackend?.state.connected")
            page.get_by_role("button", name="Compare policies", exact=True).click()
            page.wait_for_function("window.CrisisBackend.state.experiment?.status === 'completed'", timeout=60000)
            expect(page.locator("main tbody tr")).to_have_count(3)
            assert page.locator("main [onclick^='selectPolicyCard']").count() == 5
            page.screenshot(path=str(output / "policy-desktop.png"), full_page=True)
            page.goto(base + "/uncertainty.html")
            page.wait_for_function("window.CrisisBackend?.state.connected")
            page.evaluate("setMCRuns(2)")
            page.get_by_role("button", name="Execute Monte Carlo Simulation", exact=True).click()
            page.wait_for_function("window.CrisisBackend.state.experiment?.spec.kind === 'monte_carlo' && window.CrisisBackend.state.experiment.status === 'completed'", timeout=60000)
            assert len(page.evaluate("window.CrisisBackend.state.experiment.result.quantiles")) == 3
            for route in ["index", "scenarios", "new-scenario", "city-model", "equity-analysis",
                          "system-dynamics", "reports", "settings", "methodology"]:
                page.goto(base + "/" + route + ".html")
                page.wait_for_function("window.CrisisBackend?.state.connected")
                if route == "system-dynamics":
                    expect(page.locator("#system-timeline")).not_to_contain_text("No recorded events")
                body = page.locator("main").inner_text()
                assert "12,480" not in body, (route, "mock population")
                assert "95% Confidence Interval" not in body, (route, "mock uncertainty")
                assert not page.locator('script[src="js/app.js"], script[src="js/data.js"]').count()
            page.goto(base + "/command-center.html")
            page.wait_for_function("window.CrisisBackend?.state.snapshot")
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(output / "command-mobile.png"), full_page=True)
            assert not errors, errors
            print(json.dumps({"pages_checked": 12, "browser_errors": errors, "run": run["id"],
                              "original_command_layout": True, "comparison_evaluations": 3,
                              "websocket_fallback": True, "monte_carlo_trials": 2}))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
