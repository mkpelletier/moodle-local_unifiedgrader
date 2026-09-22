#!/bin/bash
# Sync plugin from dev folder to Moodle installation and rebuild AMD.
# Usage: ./deploy.sh

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"

# Every Moodle install to deploy into, in order. The first is the BUILD host:
# AMD is compiled there once and the result copied back to the dev folder, then
# shipped to the rest as-is, so every install runs byte-identical built JS and
# the artifacts committed to the repo are the ones production will run.
#
# Keep the install matching production first. When the 5.0.7 install is retired
# at the end of 2026, drop its line and 5.3 becomes the build host on its own.
MOODLE_DIRS=(
    "/Users/mathieu/Sites/moodle/prod507"   # Moodle 5.0.7 — matches production.
    "/Users/mathieu/Sites/moodle/dev53"     # Moodle 5.3 — future LTS.
)

# Defense-in-depth: verify SHA-256 of bundled third-party libs against the
# values recorded in thirdpartylibs.xml. Catches accidental or malicious
# tampering of files under thirdparty/ before we ship them to Moodle.
# Skips gracefully if xmllint or shasum aren't available.
verify_thirdparty_integrity() {
    local xml="$DEV_DIR/thirdpartylibs.xml"
    if ! command -v xmllint >/dev/null 2>&1 || ! command -v shasum >/dev/null 2>&1; then
        echo "Skipping third-party integrity check (xmllint or shasum not installed)."
        return 0
    fi
    if [ ! -f "$xml" ]; then
        echo "Skipping third-party integrity check (thirdpartylibs.xml not found)."
        return 0
    fi

    local count
    count=$(xmllint --xpath "count(//library)" "$xml" 2>/dev/null || echo 0)
    if [ "$count" = "0" ] || [ -z "$count" ]; then
        echo "Skipping third-party integrity check (no <library> entries)."
        return 0
    fi

    local failed=0
    local checked=0
    for i in $(seq 1 "$count"); do
        local location
        location=$(xmllint --xpath "string(//library[$i]/location)" "$xml" 2>/dev/null)
        local nfiles
        nfiles=$(xmllint --xpath "count(//library[$i]/sha256/file)" "$xml" 2>/dev/null || echo 0)
        if [ "$nfiles" = "0" ] || [ -z "$nfiles" ]; then
            continue
        fi
        for j in $(seq 1 "$nfiles"); do
            local relpath expected actual abs
            relpath=$(xmllint --xpath "string(//library[$i]/sha256/file[$j]/@path)" "$xml" 2>/dev/null)
            expected=$(xmllint --xpath "string(//library[$i]/sha256/file[$j])" "$xml" 2>/dev/null | tr -d ' \t\r\n')
            abs="$DEV_DIR/$location/$relpath"
            if [ ! -f "$abs" ]; then
                echo "ERROR: third-party file missing: $location/$relpath"
                failed=$((failed + 1))
                continue
            fi
            actual=$(shasum -a 256 "$abs" | awk '{print $1}')
            if [ "$actual" != "$expected" ]; then
                echo "ERROR: SHA-256 mismatch for $location/$relpath"
                echo "  expected: $expected"
                echo "  actual:   $actual"
                failed=$((failed + 1))
            fi
            checked=$((checked + 1))
        done
    done

    if [ "$failed" -gt 0 ]; then
        echo "Third-party integrity check FAILED ($failed file(s) tampered or missing). Aborting deploy."
        return 1
    fi
    echo "Verified third-party integrity ($checked file(s) match thirdpartylibs.xml)."
    return 0
}

if ! verify_thirdparty_integrity; then
    exit 1
fi

# Where a given install keeps its plugins. Moodle 5.3 moved the webroot into
# public/, so plugins live at <root>/public/local/... there while 5.0 and
# earlier keep <root>/local/... . Detected from the tree rather than configured,
# so adding an install of either vintage to MOODLE_DIRS needs no extra thought.
plugin_dir_for() {
    if [ -f "$1/public/version.php" ]; then
        echo "$1/public/local/unifiedgrader"
    else
        echo "$1/local/unifiedgrader"
    fi
}

# Refuse to deploy anywhere if any target is missing, rather than updating some
# installs and leaving the others on stale code with a non-zero exit nobody
# reads. A missing local/unifiedgrader is fine — that is a first install.
missing=0
for dir in "${MOODLE_DIRS[@]}"; do
    if [ ! -f "$dir/config.php" ]; then
        echo "Not a Moodle install (no config.php): $dir"
        missing=$((missing + 1))
    elif [ ! -f "$dir/version.php" ] && [ ! -f "$dir/public/version.php" ]; then
        echo "No version.php in $dir or $dir/public — is this a Moodle root?"
        missing=$((missing + 1))
    fi
done
if [ "$missing" -gt 0 ]; then
    echo "Aborting deploy: fix MOODLE_DIRS at the top of this script."
    exit 1
fi

# Pass 1 — the build host. Sync without amd/build (grunt is about to write it),
# compile, then copy the result back to the dev folder so the remaining installs
# and the repo get the same artifacts.
BUILD_DIR="${MOODLE_DIRS[0]}"
BUILD_PLUGIN_DIR="$(plugin_dir_for "$BUILD_DIR")"

echo ""
echo "Syncing $DEV_DIR → $BUILD_PLUGIN_DIR (build host)"
mkdir -p "$BUILD_PLUGIN_DIR"
rsync -av --delete \
  --exclude='.claude' \
  --exclude='amd/build' \
  --exclude='.eslintrc' \
  --exclude='deploy.sh' \
  --exclude='.git' \
  --exclude='vendor' \
  "$DEV_DIR/" "$BUILD_PLUGIN_DIR/"

echo ""
# Grunt runs from the webroot and takes a path relative to it, which is the
# same string either way once the public/ prefix is stripped.
BUILD_GRUNT_DIR="$BUILD_DIR"
[ -f "$BUILD_DIR/public/version.php" ] && BUILD_GRUNT_DIR="$BUILD_DIR/public"

echo "Building AMD modules in $BUILD_GRUNT_DIR..."
if ! (cd "$BUILD_GRUNT_DIR" && npx grunt amd --root=local/unifiedgrader); then
    echo "AMD build failed. Aborting before the other installs are touched."
    exit 1
fi

echo ""
echo "Copying built files back to dev folder..."
cp -R "$BUILD_PLUGIN_DIR/amd/build" "$DEV_DIR/amd/"

# Pass 2 — every other install. amd/build is no longer excluded: it now exists
# in the dev folder and is the artifact we want shipped, unbuilt and unchanged.
for dir in "${MOODLE_DIRS[@]:1}"; do
    target="$(plugin_dir_for "$dir")"
    echo ""
    echo "Syncing $DEV_DIR → $target"
    mkdir -p "$target"
    rsync -av --delete \
      --exclude='.claude' \
      --exclude='.eslintrc' \
      --exclude='deploy.sh' \
      --exclude='.git' \
      --exclude='vendor' \
      "$DEV_DIR/" "$target/"
done

echo ""
echo "Purging Moodle caches..."
for dir in "${MOODLE_DIRS[@]}"; do
    cli="$dir/admin/cli/purge_caches.php"
    [ -f "$dir/public/version.php" ] && cli="$dir/public/admin/cli/purge_caches.php"
    echo "  $dir"
    php "$cli"
done

echo ""
echo "Done — deployed to ${#MOODLE_DIRS[@]} install(s)."
