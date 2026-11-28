#!/bin/bash
# v75 PR guard: files the integration must not touch (ads, Meta JS + native, the manifest,
# billing, save/cloud schema, economy/catalog/career data, tracks, physics, GPU detection and
# the release workflow). Prints the diff against the base; empty output = untouched.
BASE=${1:-origin/main}
git diff --stat "$BASE" -- \
  src/monetization/ android/app/src/ android/app/src/main/AndroidManifest.xml \
  src/core/saveSchema.js src/core/cloud.js src/core/store.js src/core/career.js src/core/inventory.js \
  src/data/catalog.js src/data/economy.js src/data/career.js src/data/tracks.js \
  src/race/track.js src/race/trackMeshes.js src/race/vehicle.js src/race/surface.js src/race/contact.js \
  src/render/gpuTier.js src/ui/store.js .github/workflows/build-aab.yml
# cars.js: only the model file list and its comments may change (ids, names, stats, prices,
# unlocks are pinned by test/fixtures/cars-v74.json).
git diff "$BASE" -- src/data/cars.js | grep '^[-+][^-+]' | grep -v '^[-+]\s*//' | grep -v 'model: {'
echo "strict-rules check done"
