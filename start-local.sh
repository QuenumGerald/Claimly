#!/usr/bin/env bash

set -e

# Start Wasp database
(cd app && wasp start db) &
APP_DB_PID=$!

# Start Wasp app
(cd app && wasp start) &
APP_PID=$!

# Start gateway service
(cd gateway && npm run dev) &
GATEWAY_PID=$!

# Start dashboard
(cd dashboard && npm run dev) &
DASHBOARD_PID=$!

# Ensure all subprocesses are terminated on exit
trap "kill $APP_DB_PID $APP_PID $GATEWAY_PID $DASHBOARD_PID" EXIT

wait
