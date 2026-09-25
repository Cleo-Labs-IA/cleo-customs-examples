#!/bin/sh
# Install a local @cleo-legal/sdk tarball instead of the npm release, to test
# the examples before a release is published. package.json is not modified.
#
#   (cd /path/to/sdk/typescript && npm pack --pack-destination /tmp)
#   make install SDK_TARBALL=/tmp/cleo-legal-sdk-0.9.0.tgz
set -eu
tarball="${1:?usage: use-local-sdk.sh /path/to/cleo-legal-sdk-X.Y.Z.tgz}"
[ -f "$tarball" ] || { echo "FAIL: $tarball not found" >&2; exit 1; }
cd "$(dirname "$0")/../typescript"
npm install --no-save "$tarball"
node -e "console.log('using @cleo-legal/sdk ' + require('./node_modules/@cleo-legal/sdk/package.json').version)"
