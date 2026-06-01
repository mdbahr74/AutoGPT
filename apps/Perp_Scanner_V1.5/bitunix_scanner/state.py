from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .models import Alert, PerpMarket


class ScannerStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=60)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma busy_timeout = 60000")
        conn.execute("pragma synchronous = NORMAL")
        return conn

    @staticmethod
    def _json_dumps(obj: Any) -> str:
        """Helper to ensure consistent JSON serialization."""
        return json.dumps(obj, sort_keys=True)

    def _init_db(self) -> None:
        try:
            with self.connect() as conn:
                conn.execute("pragma journal_mode = WAL")
                conn.executescript(
                    """
                    create table if not exists metadata (
                        key text primary key,
                        value text not null
                    );

                    create table if not exists symbols (
                        symbol text primary key,
                        first_seen integer not null,
                        last_seen integer not null,
                        status text not null,
                        pair_json text not null
                    );

                    create table if not exists market_snapshots (
                        id integer primary key autoincrement,
                        ts integer not null,
                        symbol text not null,
                        last_price real not null,
                        mark_price real not null,
                        open_price real not null,
                        high_price real not null,
                        low_price real not null,
                        quote_volume real not null,
                        base_volume real not null,
                        funding_rate real not null,
                        price_change_pct real not null,
                        status text not null,
                        payload_json text not null
                    );

                    create index if not exists idx_market_snapshots_symbol_ts
                        on market_snapshots(symbol, ts desc);

                    create index if not exists idx_market_snapshots_symbol_price_ts
                        on market_snapshots(symbol, last_price desc, ts desc);

                    create table if not exists daily_market_stats (
                        symbol text not null,
                        day integer not null,
                        first_ts integer not null,
                        last_ts integer not null,
                        open_price real not null,
                        high_price real not null,
                        low_price real not null,
                        close_price real not null,
                        primary key(symbol, day)
                    );

                    create index if not exists idx_daily_market_stats_symbol_day
                        on daily_market_stats(symbol, day desc);

                    create table if not exists alerts (
                        id integer primary key autoincrement,
                        ts integer not null,
                        level text not null,
                        kind text not null,
                        symbol text not null,
                        title text not null,
                        message text not null,
                        payload_json text not null
                    );

                    create index if not exists idx_alerts_ts on alerts(ts desc);

                    create table if not exists alert_fingerprints (
                        fingerprint text primary key,
                        last_ts integer not null
                    );
                    """
                )
                backfill_version = conn.execute(
                    "select value from metadata where key = ?",
                    ("daily_stats_backfill_v2",),
                ).fetchone()
                if not backfill_version:
                    conn.execute(
                        """
                        insert or replace into daily_market_stats(
                            symbol, day, first_ts, last_ts, open_price, high_price, low_price, close_price
                        )
                        select agg.symbol,
                               agg.day,
                               agg.first_ts,
                               agg.last_ts,
                               open_row.last_price,
                               agg.high_price,
                               agg.low_price,
                               close_row.last_price
                        from (
                            select symbol,
                                   cast(ts / 86400 as integer) as day,
                                   min(ts) as first_ts,
                                   max(ts) as last_ts,
                                   max(last_price) as high_price,
                                   min(last_price) as low_price
                            from market_snapshots
                            group by symbol, day
                        ) agg
                        join market_snapshots open_row
                            on open_row.symbol = agg.symbol and open_row.ts = agg.first_ts
                        join market_snapshots close_row
                            on close_row.symbol = agg.symbol and close_row.ts = agg.last_ts
                        """
                    )
                    conn.execute(
                        """
                        insert into metadata(key, value) values(?, ?)
                        on conflict(key) do update set value = excluded.value
                        """,
                        ("daily_stats_backfill_v2", "1"),
                    )
        except sqlite3.OperationalError as exc:
            if self.path.exists() and "locked" in str(exc).lower():
                return
            raise

    def get_metadata(self, key: str, default: str = "") -> str:
        with self.connect() as conn:
            row = conn.execute("select value from metadata where key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set_metadata(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                insert into metadata(key, value) values(?, ?)
                on conflict(key) do update set value = excluded.value
                """,
                (key, value),
            )

    def is_initialized(self) -> bool:
        return self.get_metadata("initialized", "0") == "1"

    def known_symbols(self) -> dict[str, dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("select * from symbols").fetchall()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            result[row["symbol"]] = {
                "symbol": row["symbol"],
                "first_seen": row["first_seen"],
                "last_seen": row["last_seen"],
                "status": row["status"],
                "pair": json.loads(row["pair_json"]),
            }
        return result

    def upsert_symbol(self, market: PerpMarket, ts: int) -> None:
        pair_json = json.dumps(market.pair_payload, sort_keys=True)
        with self.connect() as conn:
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

    def record_market_snapshot(self, market: PerpMarket, ts: int) -> None:
        snapshot = market.to_snapshot()
        day = ts // 86400
        with self.connect() as conn:
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
                    json.dumps(snapshot, sort_keys=True),
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

    def should_emit_alert(self, alert: Alert, cooldown_seconds: int) -> bool:
        now = alert.ts
        with self.connect() as conn:
            row = conn.execute(
                "select last_ts from alert_fingerprints where fingerprint = ?",
                (alert.fingerprint,),
            ).fetchone()
            if row and now - int(row["last_ts"]) < cooldown_seconds:
                return False
            conn.execute(
                """
                insert into alert_fingerprints(fingerprint, last_ts) values(?, ?)
                on conflict(fingerprint) do update set last_ts = excluded.last_ts
                """,
                (alert.fingerprint, now),
            )
        return True

    def record_alert(self, alert: Alert) -> None:
        with self.connect() as conn:
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
                    json.dumps(alert.payload, sort_keys=True),
                ),
            )

    def latest_markets(self, limit: int = 1000) -> list[dict[str, Any]]:
        """Fetch latest markets with enriched data using optimized batch queries."""
        with self.connect() as conn:
            symbol_rows = conn.execute("select symbol from symbols").fetchall()
            if symbol_rows:
                latest_rows = []
                for item in symbol_rows:
                    row = conn.execute(
                        """
                        select *
                        from market_snapshots
                        where symbol = ?
                        order by ts desc
                        limit 1
                        """,
                        (item["symbol"],),
                    ).fetchone()
                    if row:
                        latest_rows.append(row)
                latest_rows = sorted(
                    latest_rows,
                    key=lambda row: float(row["quote_volume"] or 0),
                    reverse=True,
                )[:limit]
            else:
                # Unit tests and imported DBs can have snapshots before symbols are
                # populated. Keep that path correct without penalizing normal runs.
                latest_rows = conn.execute(
                    """
                    select ms.*
                    from market_snapshots ms
                    join (
                        select symbol, max(ts) as max_ts
                        from market_snapshots
                        group by symbol
                    ) latest on latest.symbol = ms.symbol and latest.max_ts = ms.ts
                    order by ms.quote_volume desc
                    limit ?
                    """,
                    (limit,),
                ).fetchall()
            
            symbols = [row["symbol"] for row in latest_rows]
            if not symbols:
                return []
            
            # Batch query: get previous snapshot for each symbol (for price/volume changes)
            placeholders = ",".join(["?"] * len(symbols))
            prev_rows = conn.execute(
                f"""
                select symbol, last_price, quote_volume
                from market_snapshots
                where (symbol, ts) in (
                    select symbol, max(ts)
                    from market_snapshots
                    where symbol in ({placeholders}) and ts < (
                        select max(ts) from market_snapshots where symbol in ({placeholders})
                    )
                    group by symbol
                )
                """,
                symbols + symbols,
            ).fetchall()
            prev_map = {row["symbol"]: row for row in prev_rows}
            
            # Batch query: get 15m range for all symbols
            cutoff_time = int(time.time()) - (15 * 60)
            range_rows = conn.execute(
                f"""
                select symbol,
                       min(last_price) as low, max(last_price) as high,
                       min(quote_volume) as low_volume, max(quote_volume) as high_volume
                from market_snapshots
                where symbol in ({placeholders}) and ts >= ?
                group by symbol
                """,
                symbols + [cutoff_time],
            ).fetchall()
            range_map = {row["symbol"]: row for row in range_rows}
            
            # Batch query: get ATH for each symbol
            ath_rows = conn.execute(
                f"""
                select symbol, ts, last_price
                from market_snapshots
                where symbol in ({placeholders})
                and (symbol, last_price) in (
                    select symbol, max(last_price)
                    from market_snapshots
                    where symbol in ({placeholders})
                    group by symbol
                )
                """,
                symbols + symbols,
            ).fetchall()
            ath_map = {row["symbol"]: row for row in ath_rows}
            
            # Get sparkline data using the symbol+ts index per symbol. A window query
            # over every symbol still scans a huge historical table when the DB has
            # millions of snapshots; small indexed lookups keep the dashboard responsive.
            sparklines = {}
            for symbol in symbols:
                rows = conn.execute(
                    """
                    select symbol, ts, last_price
                    from market_snapshots
                    where symbol = ?
                    order by ts desc
                    limit 24
                    """,
                    (symbol,),
                ).fetchall()
                sparklines[symbol] = rows

            # Batch query: find violent dump-and-reclaim structures over the
            # recent scanner history. This catches moves like -30% then +100%.
            flush_cutoff_time = int(time.time()) - (4 * 60 * 60)
            flush_rows = conn.execute(
                f"""
                select symbol, ts, last_price, quote_volume
                from market_snapshots
                where symbol in ({placeholders}) and ts >= ?
                order by symbol asc, ts asc
                """,
                symbols + [flush_cutoff_time],
            ).fetchall()
            flush_history: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in symbols}
            for item in flush_rows:
                flush_history.setdefault(item["symbol"], []).append(dict(item))
            
            # Process results
            markets = []
            for row in latest_rows:
                market = json.loads(row["payload_json"]) | {"ts": row["ts"]}
                symbol = row["symbol"]
                ts = int(row["ts"])
                
                # Previous price/volume
                prev = prev_map.get(symbol)
                last_price = float(market.get("last_price") or 0)
                quote_volume = float(market.get("quote_volume") or 0)
                if prev:
                    prev_price = float(prev["last_price"] or 0)
                    prev_volume = float(prev["quote_volume"] or 0)
                    market["scan_price_change_pct"] = (
                        ((last_price - prev_price) / prev_price) * 100 if prev_price else 0.0
                    )
                    market["scan_quote_volume_delta"] = quote_volume - prev_volume
                else:
                    market["scan_price_change_pct"] = 0.0
                    market["scan_quote_volume_delta"] = 0.0
                
                # 15m range
                recent = range_map.get(symbol)
                if recent and recent["low"] and recent["high"]:
                    low = float(recent["low"] or 0)
                    high = float(recent["high"] or 0)
                    market["range_15m_pct"] = ((high - low) / low) * 100 if low else 0.0
                    market["quote_volume_15m_delta"] = float(recent["high_volume"] or 0) - float(
                        recent["low_volume"] or 0
                    )
                else:
                    market["range_15m_pct"] = 0.0
                    market["quote_volume_15m_delta"] = 0.0
                
                # ATH info
                ath = ath_map.get(symbol)
                ath_price = float(ath["last_price"] or 0) if ath else last_price
                market["scanner_ath_price"] = ath_price
                market["scanner_ath_ts"] = int(ath["ts"]) if ath else ts
                market["scanner_ath_distance_pct"] = ((last_price - ath_price) / ath_price) * 100 if ath_price else 0.0
                market["scanner_ath_new"] = bool(last_price > 0 and last_price >= ath_price)
                
                # Sparkline
                spark_data = sparklines.get(symbol, [])
                sparkline = [
                    {"ts": int(item["ts"]), "price": float(item["last_price"] or 0)}
                    for item in reversed(spark_data)
                ]
                market["sparkline"] = sparkline
                if len(sparkline) >= 2 and sparkline[0]["price"]:
                    market["sparkline_change_pct"] = (
                        (sparkline[-1]["price"] - sparkline[0]["price"]) / sparkline[0]["price"]
                    ) * 100
                else:
                    market["sparkline_change_pct"] = 0.0
                
                current_day = ts // 86400
                daily_rows = conn.execute(
                    """
                    select day, open_price, high_price, low_price, close_price
                    from daily_market_stats
                    where symbol = ?
                    order by day asc
                    """,
                    (symbol,),
                ).fetchall()
                market["scanner_ath_age_days"] = max(0.0, (ts - market["scanner_ath_ts"]) / 86400)
                ath_ts = int(market["scanner_ath_ts"])
                ath_day = ath_ts // 86400
                if ath_day == current_day:
                    post_ath = conn.execute(
                        """
                        select min(last_price) as low_price
                        from market_snapshots
                        where symbol = ? and ts >= ?
                        """,
                        (symbol, ath_ts),
                    ).fetchone()
                    post_ath_low = float(post_ath["low_price"] or 0) if post_ath else 0.0
                else:
                    post_ath_low = min(
                        (
                            float(item["low_price"] or 0)
                            for item in daily_rows
                            if int(item["day"]) >= ath_day and float(item["low_price"] or 0) > 0
                        ),
                        default=0.0,
                    )
                market["scanner_ath_low_price"] = post_ath_low
                market["scanner_ath_drawdown_pct"] = (
                    ((post_ath_low - ath_price) / ath_price) * 100 if ath_price and post_ath_low else 0.0
                )
                market["scanner_ath_rebound_pct"] = (
                    ((last_price - post_ath_low) / post_ath_low) * 100 if post_ath_low else 0.0
                )

                flush = self._flush_reversal_metrics(flush_history.get(symbol, []), last_price, ts)
                market.update(flush)

                running_high = 0.0
                ath_day_flags: list[tuple[int, bool]] = []
                for item in daily_rows:
                    day_high = float(item["high_price"] or 0)
                    is_new_ath_day = bool(day_high > 0 and day_high > running_high)
                    if day_high > running_high:
                        running_high = day_high
                    ath_day_flags.append((int(item["day"]), is_new_ath_day))
                market["scanner_ath_today"] = bool(
                    ath_day_flags and ath_day_flags[-1][0] == current_day and ath_day_flags[-1][1]
                )
                streak = 0
                for _day, is_new in reversed(ath_day_flags):
                    if not is_new:
                        break
                    streak += 1
                market["scanner_ath_streak_days"] = streak
                for days in (30, 90):
                    baseline = conn.execute(
                        """
                        select open_price
                        from daily_market_stats
                        where symbol = ? and day >= ?
                        order by day asc
                        limit 1
                        """,
                        (symbol, current_day - days),
                    ).fetchone()
                    baseline_price = float(baseline["open_price"] or 0) if baseline else 0.0
                    market[f"scanner_move_{days}d_pct"] = (
                        ((last_price - baseline_price) / baseline_price) * 100 if baseline_price else 0.0
                    )

                market.update(
                    self._ai_cycle_metrics(
                        daily_rows,
                        last_price,
                        current_day,
                        market.get("scanner_move_30d_pct", 0.0),
                        market.get("scanner_move_90d_pct", 0.0),
                        market.get("scanner_flush_score", 0.0),
                    )
                )

                ath_days: list[dict[str, Any]] = []
                if market["scanner_ath_drawdown_pct"] <= -20 or market["scanner_ath_distance_pct"] <= -20:
                    day_rows = [
                        item for item in daily_rows
                        if int(item["day"]) >= ath_day
                    ][-7:]
                    for item in day_rows:
                        day = int(item["day"])
                        start_ts = day * 86400
                        end_ts = start_ts + 86399
                        open_price = float(item["open_price"] or 0)
                        low_price = float(item["low_price"] or 0)
                        last = float(item["close_price"] or 0)
                        high = float(item["high_price"] or 0)
                        ath_days.append(
                            {
                                "day": day - ath_day,
                                "start_ts": start_ts,
                                "end_ts": end_ts,
                                "open": open_price,
                                "last": last,
                                "high": high,
                                "low": low_price,
                                "change_pct": ((last - open_price) / open_price) * 100 if open_price else 0.0,
                                "range_pct": ((high - low_price) / low_price) * 100 if low_price else 0.0,
                                "off_ath_pct": ((last - ath_price) / ath_price) * 100 if ath_price else 0.0,
                            }
                        )
                market["scanner_ath_days"] = ath_days
                
                markets.append(market)
        
        return markets

    @staticmethod
    def _flush_reversal_metrics(rows: list[dict[str, Any]], current_price: float, current_ts: int) -> dict[str, Any]:
        default = {
            "scanner_flush_drop_pct": 0.0,
            "scanner_flush_rebound_pct": 0.0,
            "scanner_flush_score": 0.0,
            "scanner_flush_low_price": 0.0,
            "scanner_flush_low_ts": 0,
            "scanner_flush_high_price": 0.0,
            "scanner_flush_high_ts": 0,
            "scanner_flush_age_minutes": 0.0,
            "scanner_flush_active": False,
        }
        clean = [
            {
                "ts": int(row.get("ts") or 0),
                "price": float(row.get("last_price") or 0),
            }
            for row in rows
            if float(row.get("last_price") or 0) > 0
        ]
        if len(clean) < 3 or current_price <= 0:
            return default

        high_price = clean[0]["price"]
        high_ts = clean[0]["ts"]
        best = default.copy()

        for item in clean[1:]:
            price = item["price"]
            if high_price <= 0 or price <= 0:
                continue
            drop_pct = ((price - high_price) / high_price) * 100
            rebound_pct = ((current_price - price) / price) * 100
            if drop_pct < 0 and rebound_pct > 0:
                score = abs(drop_pct) + rebound_pct
                if score > best["scanner_flush_score"]:
                    best = {
                        "scanner_flush_drop_pct": drop_pct,
                        "scanner_flush_rebound_pct": rebound_pct,
                        "scanner_flush_score": score,
                        "scanner_flush_low_price": price,
                        "scanner_flush_low_ts": item["ts"],
                        "scanner_flush_high_price": high_price,
                        "scanner_flush_high_ts": high_ts,
                        "scanner_flush_age_minutes": max(0.0, (current_ts - item["ts"]) / 60),
                        "scanner_flush_active": bool(drop_pct <= -25 and rebound_pct >= 50),
                    }

            if price > high_price:
                high_price = price
                high_ts = item["ts"]

        return best

    @staticmethod
    def _ai_cycle_metrics(
        daily_rows: list[sqlite3.Row],
        current_price: float,
        current_day: int,
        move_30d_pct: float,
        move_90d_pct: float,
        flush_score: float,
    ) -> dict[str, Any]:
        default = {
            "scanner_ai_cycle_runup_pct": 0.0,
            "scanner_ai_cycle_week_drop_pct": 0.0,
            "scanner_ai_cycle_reclaim_pct": 0.0,
            "scanner_ai_cycle_bounce_days_7d": 0,
            "scanner_ai_cycle_score": 0.0,
            "scanner_ai_cycle_active": False,
        }
        rows = [
            {
                "day": int(row["day"]),
                "open": float(row["open_price"] or 0),
                "high": float(row["high_price"] or 0),
                "low": float(row["low_price"] or 0),
                "close": float(row["close_price"] or 0),
            }
            for row in daily_rows
        ]
        if not rows or current_price <= 0:
            return default

        recent_week = [row for row in rows if row["day"] >= current_day - 6]
        if not recent_week:
            recent_week = rows[-7:]

        high_price = recent_week[0]["high"]
        best_drop = 0.0
        best_low = 0.0
        for row in recent_week:
            if high_price > 0 and row["low"] > 0:
                drop = ((row["low"] - high_price) / high_price) * 100
                if drop < best_drop:
                    best_drop = drop
                    best_low = row["low"]
            if row["high"] > high_price:
                high_price = row["high"]

        reclaim_pct = ((current_price - best_low) / best_low) * 100 if best_low else 0.0
        bounce_days = 0
        for row in recent_week:
            day_gain = ((row["close"] - row["open"]) / row["open"]) * 100 if row["open"] else 0.0
            day_range = ((row["high"] - row["low"]) / row["low"]) * 100 if row["low"] else 0.0
            if day_gain >= 45 or (day_range >= 55 and row["close"] >= row["open"]):
                bounce_days += 1

        def window_runup(days: int) -> float:
            window = [row for row in rows if row["day"] >= current_day - days]
            if not window:
                return 0.0
            baseline = next((row["open"] for row in window if row["open"] > 0), 0.0)
            high = max((row["high"] for row in window), default=0.0)
            return ((high - baseline) / baseline) * 100 if baseline and high > baseline else 0.0

        runup_pct = max(
            0.0,
            float(move_30d_pct or 0),
            float(move_90d_pct or 0) * 0.5,
            window_runup(30),
            window_runup(90) * 0.5,
        )
        runup_score = min(40.0, runup_pct / 1300 * 40)
        drawdown_score = min(30.0, abs(best_drop) / 90 * 30)
        bounce_score = min(30.0, bounce_days * 12)
        reclaim_score = min(25.0, max(0.0, reclaim_pct) / 100 * 25)
        flush_bonus = min(15.0, float(flush_score or 0) / 130 * 15)
        score = runup_score + drawdown_score + bounce_score + reclaim_score + flush_bonus

        active = bool(
            (runup_pct >= 300 and best_drop <= -45 and (bounce_days >= 2 or reclaim_pct >= 50))
            or (best_drop <= -25 and reclaim_pct >= 50 and bounce_days >= 1)
        )

        return {
            "scanner_ai_cycle_runup_pct": runup_pct,
            "scanner_ai_cycle_week_drop_pct": best_drop,
            "scanner_ai_cycle_reclaim_pct": reclaim_pct,
            "scanner_ai_cycle_bounce_days_7d": bounce_days,
            "scanner_ai_cycle_score": score,
            "scanner_ai_cycle_active": active,
        }

    def market_history(self, symbol: str, seconds: int = 15 * 60, limit: int = 120) -> list[dict[str, Any]]:
        cutoff = int(time.time()) - seconds
        with self.connect() as conn:
            rows = conn.execute(
                """
                select ts, last_price, mark_price, quote_volume, funding_rate, price_change_pct
                from market_snapshots
                where symbol = ? and ts >= ?
                order by ts desc
                limit ?
                """,
                (symbol.upper(), cutoff, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def recent_alerts(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "select * from alerts order by ts desc limit ?",
                (limit,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "ts": row["ts"],
                "level": row["level"],
                "kind": row["kind"],
                "symbol": row["symbol"],
                "title": row["title"],
                "message": row["message"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def prune_snapshots(self, older_than_seconds: int = 7 * 24 * 3600) -> int:
        cutoff = int(time.time()) - older_than_seconds
        with self.connect() as conn:
            cursor = conn.execute("delete from market_snapshots where ts < ?", (cutoff,))
            return int(cursor.rowcount or 0)
