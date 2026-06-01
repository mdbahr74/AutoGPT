from __future__ import annotations

import time
import unittest

from bitunix_scanner.alerts import evaluate_market_alerts
from bitunix_scanner.config import ScannerConfig
from bitunix_scanner.models import PerpMarket


class AlertTests(unittest.TestCase):
    def test_first_run_does_not_emit_listing_by_default(self) -> None:
        market = PerpMarket.from_api({"symbol": "TESTUSDT", "symbolStatus": "OPEN", "maxLeverage": 50})
        alerts = evaluate_market_alerts(market, None, initialized=False, config=ScannerConfig(), ts=int(time.time()))
        self.assertEqual(alerts, [])

    def test_initialized_new_symbol_emits_listing(self) -> None:
        market = PerpMarket.from_api({"symbol": "TESTUSDT", "symbolStatus": "OPEN", "maxLeverage": 50})
        alerts = evaluate_market_alerts(market, None, initialized=True, config=ScannerConfig(), ts=int(time.time()))
        self.assertEqual(alerts[0].kind, "new_listing")

    def test_parameter_change_is_detected(self) -> None:
        market = PerpMarket.from_api({"symbol": "BTCUSDT", "symbolStatus": "OPEN", "maxLeverage": 200})
        previous = {"pair": {"symbol": "BTCUSDT", "symbolStatus": "OPEN", "maxLeverage": 125}}
        alerts = evaluate_market_alerts(market, previous, initialized=True, config=ScannerConfig(), ts=int(time.time()))
        self.assertTrue(any(alert.kind == "parameter_change" for alert in alerts))

    def test_extreme_funding_is_detected(self) -> None:
        market = PerpMarket.from_api(
            {"symbol": "HOTUSDT", "symbolStatus": "OPEN"},
            {"symbol": "HOTUSDT", "open": "1", "lastPrice": "1.01"},
            {"symbol": "HOTUSDT", "fundingRate": "0.02", "fundingInterval": 4},
        )
        alerts = evaluate_market_alerts(market, {"pair": market.pair_payload}, True, ScannerConfig(), int(time.time()))
        self.assertTrue(any(alert.kind == "funding_extreme" for alert in alerts))


if __name__ == "__main__":
    unittest.main()
