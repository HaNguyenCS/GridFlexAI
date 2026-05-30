#!/bin/bash
set -e

source .venv/bin/activate

echo "Fetching IESO RealtimeTotals..."
python src/ingestion/fetch_realtime_totals.py

echo "Fetching IESO PredispTotals..."
python src/ingestion/fetch_predisp_totals.py

echo "Building live feature row..."
python src/features/build_live_feature_row.py

echo "Live data refresh complete."