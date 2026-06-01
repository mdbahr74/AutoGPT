from __future__ import annotations

import unittest

from bitunix_scanner.dashboard import build_impulse_history, render_home_html, render_symbol_html


class DashboardAssetTests(unittest.TestCase):
    def test_home_uses_versioned_static_assets(self) -> None:
        html = render_home_html()
        self.assertIn("/static/home.css?v=", html)
        self.assertIn("/static/home-widgets.js?v=", html)
        self.assertIn("/static/symbol-widgets.js?v=", html)
        self.assertIn("/static/home.js?v=", html)
        self.assertIn('id="workspaceBlank"', html)
        self.assertIn('id="workspaceDock"', html)
        self.assertIn('id="dockWidgetControls"', html)
        self.assertIn('id="dockSymbol"', html)
        self.assertIn('data-panel-id="metrics"', html)
        self.assertIn('data-panel-id="highWatch"', html)
        self.assertIn('class="control-alert-settings"', html)
        self.assertIn('Event Data Points', html)
        self.assertIn('id="alertSettingsTest"', html)
        self.assertIn('id="alertUniverse"', html)
        self.assertIn('id="alertDailyRangePct"', html)
        self.assertIn('id="alertMarketCap"', html)
        self.assertIn('class="panel alerts-panel"', html)
        self.assertIn('data-panel-id="alerts"', html)
        self.assertNotIn("__HOME_", html)

    def test_symbol_uses_external_assets_and_symbol_config(self) -> None:
        html = render_symbol_html("BTCUSDT")
        self.assertIn("BTCUSDT - Bitunix Perp Scanner", html)
        self.assertIn("window.BITUNIX_SYMBOL = \"BTCUSDT\";", html)
        self.assertIn("/static/symbol.css?v=", html)
        self.assertIn("/static/symbol-widgets.js?v=", html)
        self.assertIn("/static/symbol.js?v=", html)
        self.assertIn('data-panel-id="metrics"', html)
        self.assertIn('data-panel-id="tickerCard"', html)
        self.assertIn('id="tickerCardLast"', html)
        self.assertIn("Market Snapshot", html)
        self.assertIn('id="snapshotFrame"', html)
        self.assertIn('id="watchAddSymbol"', html)
        self.assertIn('id="watchListSelect"', html)
        self.assertIn('id="watchListSaveName"', html)
        self.assertIn('id="watchCols"', html)
        self.assertIn('id="watchRowMenu"', html)
        self.assertIn('data-panel-id="impulseHistory"', html)
        self.assertIn('data-panel-id="liquidityHeatmap"', html)
        self.assertIn('id="liquidityMode"', html)
        self.assertIn('id="liquidityBookTilt"', html)
        self.assertIn('id="liquidityNearestWall"', html)
        self.assertIn('id="liquidityHeatmapCanvas"', html)
        self.assertIn('id="liquidityTooltip"', html)
        self.assertNotIn("__SYMBOL_", html)

    def test_build_impulse_history_tracks_spike_and_retrace(self) -> None:
        rows = [
            {"time": 100, "open": "0.22", "high": "0.24", "low": "0.20", "close": "0.22"},
            {"time": 100 + 86400, "open": "0.22", "high": "28", "low": "0.21", "close": "20"},
            {"time": 100 + 2 * 86400, "open": "20", "high": "21", "low": "2.8", "close": "4"},
            {"time": 100 + 3 * 86400, "open": "4", "high": "8", "low": "3.4", "close": "6"},
        ]

        payload = build_impulse_history(rows, current_price=6, threshold_pct=25)

        best = payload["best"]
        self.assertIsNotNone(best)
        self.assertEqual(best["start_price"], 0.2)
        self.assertEqual(best["high_price"], 28)
        self.assertAlmostEqual(best["move_pct"], 13900)
        self.assertAlmostEqual(best["off_high_pct"], -78.5714285714)
        self.assertAlmostEqual(best["drawdown_pct"], -90)
        self.assertAlmostEqual(best["rebound_pct"], 114.2857142857)
        self.assertEqual(best["state"], "deep retrace")
        self.assertEqual(payload["active"]["start_price"], 3.4)


if __name__ == "__main__":
    unittest.main()
