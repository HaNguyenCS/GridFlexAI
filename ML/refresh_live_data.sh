#!/bin/bash
set -e

source .venv/bin/activate

echo "Fetching IESO RealtimeTotals..."
python src/ingestion/fetch_realtime_totals.py

echo "Updating demand history..."
python src/ingestion/update_demand_history.py

echo "Fetching IESO PredispTotals..."
python src/ingestion/fetch_predisp_totals.py

echo "Fetching weather..."
python src/ingestion/fetch_weather.py

echo "Building Toronto flex assets..."
python src/ingestion/build_toronto_flex_assets.py

echo "Building live feature row..."
python src/features/build_live_feature_row.py

echo "Live data refresh complete."