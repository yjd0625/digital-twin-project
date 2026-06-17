#!/usr/bin/env bash
cd "/../backend" || exit 1
echo "Installing dependencies..."
pip install -r requirements.txt
echo "Starting backend server..."
python -m src.main
