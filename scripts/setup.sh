#!/bin/sh

__DIR__=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

__REPOROOT__="${__DIR__}/.."

node "${__REPOROOT__}/common/scripts/install-run-rush.js" install \
    || node "${__REPOROOT__}/common/scripts/install-run-rush.js" update
