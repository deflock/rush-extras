#!/bin/sh

__DIR__=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

"${__DIR__}/../packages/local-commands/rush" install || "${__DIR__}/../packages/local-commands/rush" update
