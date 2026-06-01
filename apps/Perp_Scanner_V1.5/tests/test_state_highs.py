from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from bitunix_scanner.models import PerpMarket
from bitunix_scanner.state import ScannerStore


class StateHighTests(unittest.TestCase):
    def test_latest_markets_include_scanner_high_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ScannerStore(Path(temp_dir) / "scanner.sqlite3")
            first = PerpMarket.from_api(
                {"symbol": "TESTUSDT", "symbolStatus": "OPEN"},
                {"symbol": "TESTUSDT", "lastPrice": "1", "open": "0.9", "high": "1", "low": "0.8"},
            )
            second = PerpMarket.from_api(
                {"symbol": "TESTUSDT", "symbolStatus": "OPEN"},
                {"symbol": "TESTUSDT", "lastPrice": "1.2", "open": "0.9", "high": "1.2", "low": "0.8"},
            )
            store.record_market_snapshot(first, 100)
            store.record_market_snapshot(second, 200)

            [market] = store.latest_markets()

            self.assertEqual(market["scanner_ath_price"], 1.2)
            self.assertEqual(market["scanner_ath_ts"], 200)
            self.assertEqual(market["scanner_ath_distance_pct"], 0.0)
            self.assertTrue(market["scanner_ath_new"])
            self.assertTrue(market["scanner_ath_today"])
            self.assertEqual(market["scanner_ath_streak_days"], 1)

    def test_latest_markets_include_post_high_lifecycle_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ScannerStore(Path(temp_dir) / "scanner.sqlite3")
            high = PerpMarket.from_api(
                {"symbol": "AIUSDT", "symbolStatus": "OPEN"},
                {"symbol": "AIUSDT", "lastPrice": "10", "open": "1", "high": "10", "low": "1"},
            )
            crash = PerpMarket.from_api(
                {"symbol": "AIUSDT", "symbolStatus": "OPEN"},
                {"symbol": "AIUSDT", "lastPrice": "1", "open": "10", "high": "10", "low": "1"},
            )
            rebound = PerpMarket.from_api(
                {"symbol": "AIUSDT", "symbolStatus": "OPEN"},
                {"symbol": "AIUSDT", "lastPrice": "2", "open": "1", "high": "2", "low": "1"},
            )
            store.record_market_snapshot(high, 100)
            store.record_market_snapshot(crash, 200)
            store.record_market_snapshot(rebound, 100 + 86400)

            [market] = store.latest_markets()

            self.assertEqual(market["scanner_ath_price"], 10)
            self.assertEqual(market["scanner_ath_low_price"], 1)
            self.assertEqual(market["scanner_ath_distance_pct"], -80)
            self.assertEqual(market["scanner_ath_drawdown_pct"], -90)
            self.assertEqual(market["scanner_ath_rebound_pct"], 100)
            self.assertGreaterEqual(market["scanner_ath_age_days"], 1)
            self.assertGreaterEqual(len(market["scanner_ath_days"]), 2)
            self.assertFalse(market["scanner_ath_today"])
            self.assertEqual(market["scanner_ath_streak_days"], 0)

    def test_latest_markets_tracks_consecutive_ath_days_and_longer_moves(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ScannerStore(Path(temp_dir) / "scanner.sqlite3")
            day_zero = 10
            day_one = 86410
            first = PerpMarket.from_api(
                {"symbol": "FOMOUSDT", "symbolStatus": "OPEN"},
                {"symbol": "FOMOUSDT", "lastPrice": "1", "open": "1", "high": "1", "low": "1"},
            )
            second = PerpMarket.from_api(
                {"symbol": "FOMOUSDT", "symbolStatus": "OPEN"},
                {"symbol": "FOMOUSDT", "lastPrice": "2", "open": "1", "high": "2", "low": "1"},
            )
            third = PerpMarket.from_api(
                {"symbol": "FOMOUSDT", "symbolStatus": "OPEN"},
                {"symbol": "FOMOUSDT", "lastPrice": "3", "open": "2", "high": "3", "low": "2"},
            )
            store.record_market_snapshot(first, day_zero)
            store.record_market_snapshot(second, day_zero + 30)
            store.record_market_snapshot(third, day_one)

            [market] = store.latest_markets()

            self.assertTrue(market["scanner_ath_new"])
            self.assertTrue(market["scanner_ath_today"])
            self.assertEqual(market["scanner_ath_streak_days"], 2)
            self.assertEqual(market["scanner_move_30d_pct"], 200)
            self.assertEqual(market["scanner_move_90d_pct"], 200)

    def test_latest_markets_detects_flush_reclaim_setup(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ScannerStore(Path(temp_dir) / "scanner.sqlite3")
            now = int(time.time())
            high = PerpMarket.from_api(
                {"symbol": "LABUSDT", "symbolStatus": "OPEN"},
                {"symbol": "LABUSDT", "lastPrice": "4", "open": "4", "high": "4", "low": "4"},
            )
            flush = PerpMarket.from_api(
                {"symbol": "LABUSDT", "symbolStatus": "OPEN"},
                {"symbol": "LABUSDT", "lastPrice": "2.8", "open": "4", "high": "4", "low": "2.8"},
            )
            reclaim = PerpMarket.from_api(
                {"symbol": "LABUSDT", "symbolStatus": "OPEN"},
                {"symbol": "LABUSDT", "lastPrice": "5.6", "open": "2.8", "high": "5.6", "low": "2.8"},
            )
            store.record_market_snapshot(high, now - 3600)
            store.record_market_snapshot(flush, now - 3300)
            store.record_market_snapshot(reclaim, now - 3000)

            [market] = store.latest_markets()

            self.assertAlmostEqual(market["scanner_flush_drop_pct"], -30)
            self.assertAlmostEqual(market["scanner_flush_rebound_pct"], 100)
            self.assertAlmostEqual(market["scanner_flush_score"], 130)
            self.assertTrue(market["scanner_flush_active"])

    def test_latest_markets_scores_ai_cycle_reset_and_bid_days(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ScannerStore(Path(temp_dir) / "scanner.sqlite3")
            base_day = int(time.time()) // 86400

            def ts(days_ago: int, offset: int = 60) -> int:
                return (base_day - days_ago) * 86400 + offset

            def snapshot(price: float) -> PerpMarket:
                return PerpMarket.from_api(
                    {"symbol": "AIUSDT", "symbolStatus": "OPEN"},
                    {
                        "symbol": "AIUSDT",
                        "lastPrice": str(price),
                        "open": str(price),
                        "high": str(price),
                        "low": str(price),
                    },
                )

            store.record_market_snapshot(snapshot(1), ts(30))
            store.record_market_snapshot(snapshot(14), ts(6))
            store.record_market_snapshot(snapshot(1.4), ts(5))
            store.record_market_snapshot(snapshot(1.5), ts(4, 60))
            store.record_market_snapshot(snapshot(2.4), ts(4, 3600))
            store.record_market_snapshot(snapshot(2.0), ts(2, 60))
            store.record_market_snapshot(snapshot(3.1), ts(2, 3600))
            store.record_market_snapshot(snapshot(2.8), ts(0))

            [market] = store.latest_markets()

            self.assertGreaterEqual(market["scanner_ai_cycle_runup_pct"], 1300)
            self.assertAlmostEqual(market["scanner_ai_cycle_week_drop_pct"], -90)
            self.assertAlmostEqual(market["scanner_ai_cycle_reclaim_pct"], 100)
            self.assertGreaterEqual(market["scanner_ai_cycle_bounce_days_7d"], 2)
            self.assertGreater(market["scanner_ai_cycle_score"], 90)
            self.assertTrue(market["scanner_ai_cycle_active"])


if __name__ == "__main__":
    unittest.main()
