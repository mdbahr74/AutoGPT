from __future__ import annotations

import time
from dataclasses import dataclass

from .alerts import AlertSink, evaluate_market_alerts
from .bitunix import BitunixClient
from .config import ScannerConfig
from .models import Alert, PerpMarket
from .state import ScannerStore


@dataclass(slots=True)
class ScanResult:
    ts: int
    market_count: int
    alert_count: int
    emitted_alerts: list[Alert]
    markets: list[PerpMarket]


class BitunixScanner:
    def __init__(
        self,
        client: BitunixClient,
        store: ScannerStore,
        config: ScannerConfig,
        sinks: list[AlertSink],
    ) -> None:
        self.client = client
        self.store = store
        self.config = config
        self.sinks = sinks

    def scan_once(self) -> ScanResult:
        ts = int(time.time())
        initialized = self.store.is_initialized()
        known = self.store.known_symbols()
        markets = self.client.scan_all_markets()
        emitted: list[Alert] = []

        # Batch all inserts into a single transaction
        with self.store.connect() as conn:
            # Batch insert market snapshots and daily stats
            for market in markets:
                snapshot = market.to_snapshot()
                day = ts // 86400
                conn.execute(
                    """
                    insert into market_snapshots(
                        ts, symbol, last_price, mark_price, open_price, high_price, low_price,
                        quote_volume, base_volume, funding_rate, price_change_pct, status, payload_json
                    )
                    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ts,
                        market.symbol,
                        market.last_price,
                        market.mark_price,
                        market.open_price,
                        market.high_price,
                        market.low_price,
                        market.quote_volume,
                        market.base_volume,
                        market.funding_rate,
                        market.price_change_pct,
                        market.status,
                        self.store._json_dumps(snapshot),
                    ),
                )
                conn.execute(
                    """
                    insert into daily_market_stats(
                        symbol, day, first_ts, last_ts, open_price, high_price, low_price, close_price
                    )
                    values(?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict(symbol, day) do update set
                        last_ts = excluded.last_ts,
                        high_price = max(daily_market_stats.high_price, excluded.high_price),
                        low_price = min(daily_market_stats.low_price, excluded.low_price),
                        close_price = excluded.close_price
                    """,
                    (
                        market.symbol,
                        day,
                        ts,
                        ts,
                        market.last_price,
                        market.last_price,
                        market.last_price,
                        market.last_price,
                    ),
                )

            # Batch upsert symbols
            for market in markets:
                pair_json = self.store._json_dumps(market.pair_payload)
                conn.execute(
                    """
                    insert into symbols(symbol, first_seen, last_seen, status, pair_json)
                    values(?, ?, ?, ?, ?)
                    on conflict(symbol) do update set
                        last_seen = excluded.last_seen,
                        status = excluded.status,
                        pair_json = excluded.pair_json
                    """,
                    (market.symbol, ts, ts, market.status, pair_json),
                )

            # Evaluate alerts and prepare fingerprint updates
            alerts_to_check = []
            for market in markets:
                previous = known.get(market.symbol)
                for alert in evaluate_market_alerts(market, previous, initialized, self.config, ts):
                    alerts_to_check.append(alert)
            
            missing = sorted(set(known) - {market.symbol for market in markets})
            for symbol in missing:
                alert = Alert(
                    ts=ts,
                    level="critical",
                    kind="missing_symbol",
                    symbol=symbol,
                    title=f"{symbol} missing from Bitunix trading_pairs",
                    message=f"{symbol} was previously seen but was absent from this scan.",
                    payload={"fingerprint": "missing"},
                )
                alerts_to_check.append(alert)

            # Batch check alert cooldowns in one query
            fingerprints = [a.fingerprint for a in alerts_to_check]
            fingerprint_map = {}
            if fingerprints:
                placeholders = ",".join(["?"] * len(fingerprints))
                rows = conn.execute(
                    f"select fingerprint, last_ts from alert_fingerprints where fingerprint in ({placeholders})",
                    fingerprints
                ).fetchall()
                for row in rows:
                    fingerprint_map[row["fingerprint"]] = row["last_ts"]

            # Process alerts with batched cooldown data
            for alert in alerts_to_check:
                last_ts = fingerprint_map.get(alert.fingerprint)
                should_emit = False
                if last_ts is None:
                    should_emit = True
                elif ts - int(last_ts) >= self.config.alert_cooldown_seconds:
                    should_emit = True
                
                if should_emit:
                    conn.execute(
                        """
                        insert into alerts(ts, level, kind, symbol, title, message, payload_json)
                        values(?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            alert.ts,
                            alert.level,
                            alert.kind,
                            alert.symbol,
                            alert.title,
                            alert.message,
                            self.store._json_dumps(alert.payload),
                        ),
                    )
                    conn.execute(
                        """
                        insert into alert_fingerprints(fingerprint, last_ts) values(?, ?)
                        on conflict(fingerprint) do update set last_ts = excluded.last_ts
                        """,
                        (alert.fingerprint, ts),
                    )
                    for sink in self.sinks:
                        sink.emit(alert)
                    emitted.append(alert)

            # Update metadata and prune
            conn.execute(
                """
                insert into metadata(key, value) values(?, ?)
                on conflict(key) do update set value = excluded.value
                """,
                ("initialized", "1"),
            )
            conn.execute(
                """
                insert into metadata(key, value) values(?, ?)
                on conflict(key) do update set value = excluded.value
                """,
                ("last_scan_ts", str(ts)),
            )
            
            # Prune snapshots older than 30 days
            cutoff_ts = ts - (30 * 86400)
            conn.execute("delete from market_snapshots where ts < ?", (cutoff_ts,))
            conn.commit()

        return ScanResult(ts=ts, market_count=len(markets), alert_count=len(emitted), emitted_alerts=emitted, markets=markets)
