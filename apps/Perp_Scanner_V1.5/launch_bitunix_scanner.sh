#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

# Some agent shells export this, which makes Electron behave like plain Node.
unset ELECTRON_RUN_AS_NODE
export ELECTRON_DISABLE_SANDBOX=1

# Match the stable Mint/Cinnamon X11 desktop unless explicitly overridden.
export BITUNIX_ELECTRON_OZONE="${BITUNIX_ELECTRON_OZONE:-x11}"

# Keep the standalone scanner off Tandem Browser's API port.
export BITUNIX_DASHBOARD_PORT="${BITUNIX_DASHBOARD_PORT:-8766}"

# Use the native Linux/Cinnamon window frame by default. After the restore the
# frameless Electron shell could open workspace/popout windows with no visible
# drag/close bar, trapping the window. Native frame restores OS drag/min/max/close
# controls while keeping the in-app controls available where they exist.
export BITUNIX_NATIVE_FRAME="${BITUNIX_NATIVE_FRAME:-1}"

ELECTRON_BIN="$PROJECT_DIR/node_modules/electron/dist/electron"

if [[ -x "$ELECTRON_BIN" ]]; then
  exec /usr/bin/env -u ELECTRON_RUN_AS_NODE "$ELECTRON_BIN" --no-sandbox .
fi

exec /usr/bin/env -u ELECTRON_RUN_AS_NODE npm run electron -- --no-sandbox
