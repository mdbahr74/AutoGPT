from __future__ import annotations

import argparse
import json
import time

from .ai import build_brief
from .alerts import build_sinks
from .bitunix import BitunixClient
from .config import ScannerConfig
from .dashboard import serve, start_background_scanner
from .scanner import BitunixScanner
from .state import ScannerStore


def make_scanner(config: ScannerConfig) -> tuple[BitunixScanner, ScannerStore]:
    store = ScannerStore(config.db_path)
    client = BitunixClient(config.request_timeout_seconds)
    scanner = BitunixScanner(client, store, config, build_sinks(config))
    return scanner, store


def cmd_scan(args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    scanner, store = make_scanner(config)
    result = scanner.scan_once()
    payload = {
        "ts": result.ts,
        "markets": result.market_count,
        "alerts": result.alert_count,
        "alert_titles": [alert.title for alert in result.emitted_alerts],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    if args.ai:
        print()
        print(build_brief(store.latest_markets(), store.recent_alerts(), config.ai_provider, config.openai_model))
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    if args.interval:
        config.scan_interval_seconds = args.interval
    scanner, _store = make_scanner(config)
    while True:
        result = scanner.scan_once()
        print(
            f"{time.strftime('%Y-%m-%d %H:%M:%S')} scanned "
            f"{result.market_count} markets, emitted {result.alert_count} alerts"
        )
        time.sleep(config.scan_interval_seconds)


def cmd_markets(args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    store = ScannerStore(config.db_path)
    markets = store.latest_markets(limit=args.limit)
    print(json.dumps(markets, indent=2, sort_keys=True))
    return 0


def cmd_alerts(args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    store = ScannerStore(config.db_path)
    print(json.dumps(store.recent_alerts(limit=args.limit), indent=2, sort_keys=True))
    return 0


def cmd_brief(_args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    store = ScannerStore(config.db_path)
    print(build_brief(store.latest_markets(), store.recent_alerts(), config.ai_provider, config.openai_model))
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    config = ScannerConfig.from_env()
    if args.interval:
        config.scan_interval_seconds = args.interval
    scanner, store = make_scanner(config)
    if args.once or not store.latest_markets(limit=1):
        scanner.scan_once()
    start_background_scanner(scanner, config.scan_interval_seconds)
    serve(store, scanner, args.host, args.port, config.ai_provider, config.openai_model)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bitunix-only perpetual futures scanner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="Run one scan now")
    scan.add_argument("--ai", action="store_true", help="Print a market brief after scanning")
    scan.set_defaults(func=cmd_scan)

    watch = subparsers.add_parser("watch", help="Run scans forever")
    watch.add_argument("--interval", type=int, default=0, help="Override scan interval in seconds")
    watch.set_defaults(func=cmd_watch)

    markets = subparsers.add_parser("markets", help="Print the latest market snapshot")
    markets.add_argument("--limit", type=int, default=100)
    markets.set_defaults(func=cmd_markets)

    alerts = subparsers.add_parser("alerts", help="Print recent alerts")
    alerts.add_argument("--limit", type=int, default=50)
    alerts.set_defaults(func=cmd_alerts)

    brief = subparsers.add_parser("brief", help="Print an AI/rules market brief")
    brief.set_defaults(func=cmd_brief)

    dashboard = subparsers.add_parser("dashboard", help="Run the local web dashboard")
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=8765)
    dashboard.add_argument("--interval", type=int, default=0, help="Override background scan interval")
    dashboard.add_argument("--once", action="store_true", help="Run an immediate scan before serving")
    dashboard.set_defaults(func=cmd_dashboard)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
