#!/bin/sh
# Builds uncontain.xpi from the extension sources.
set -e
cd "$(dirname "$0")"
rm -f uncontain.xpi
zip -r -X uncontain.xpi manifest.json background.js options.html options.js
echo "Built uncontain.xpi"
