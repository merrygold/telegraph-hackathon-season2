#!/usr/bin/env bash
# Puts your domain into the three files that carry a placeholder. Run once, before copying to the VPS:
#   bash deploy/set-domain.sh mydomain.com
# Do it before registering Gauge: the registered hash is the hash of gauge.yaml as served.
set -euo pipefail
D="${1:?usage: set-domain.sh mydomain.com}"
[[ "$D" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "not a domain: $D"; exit 1; }
cd "$(dirname "$0")/.."
sed -i "s/example\.com/$D/g" deploy/Caddyfile
sed -i "s/GAUGE_DOMAIN/gauge.$D/" gauge/gauge.yaml measure/truth/hashprice-gauge.yaml
grep -Hn "$D" deploy/Caddyfile gauge/gauge.yaml measure/truth/hashprice-gauge.yaml
