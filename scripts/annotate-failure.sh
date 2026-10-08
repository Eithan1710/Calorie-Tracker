#!/usr/bin/env bash
# CI helper: turn the interesting tail of a failing log into GitHub annotations
# (visible on the run page without downloading logs). Usage: annotate-failure.sh <title> <log> [start-regex]
title=$1; log=$2; start=${3:-}
tmp=$(mktemp -d)
if [ -n "$start" ] && grep -qE "$start" "$log"; then
  sed -nE "/$start/,\$p" "$log" > "$tmp/body"
else
  tail -n 120 "$log" > "$tmp/body"
fi
sed -e 's/\x1b\[[0-9;]*m//g' "$tmp/body" | grep -v '^[[:space:]]*$' | head -c 24000 > "$tmp/clean"
split -C 3000 "$tmp/clean" "$tmp/part-"
for f in "$tmp"/part-*; do
  msg=$(sed -e 's/%/%25/g' "$f" | awk 'BEGIN{ORS="%0A"}{print}')
  echo "::error title=$title::$msg"
done
rm -rf "$tmp"
