#!/bin/bash

# Restore script for Work Order Management System volumes
# This script restores backups of PostgreSQL data and uploads

set -e

echo "🔄 Restoring MGSEM Work Order Management System from backup..."

# Base directory
BASE_DIR="/srv/mgsem-work-order"
BACKUP_DIR="/srv/mgsem-work-order/backups"

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo "❌ Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# List available backups
echo "📋 Available backups:"
ls -la "$BACKUP_DIR"/*.tar.gz 2>/dev/null || {
    echo "❌ No backup files found in $BACKUP_DIR"
    exit 1
}

# Get the most recent backup
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/*.tar.gz | head -1)
echo "📦 Latest backup: $(basename "$LATEST_BACKUP")"

# Confirm restore
read -p "⚠️  This will overwrite current data. Are you sure? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Restore cancelled"
    exit 1
fi

# Stop containers
echo "🛑 Stopping containers..."
docker-compose down

# Backup current data before restore
echo "💾 Creating backup of current data..."
CURRENT_BACKUP="$BACKUP_DIR/pre-restore-$(date +"%Y%m%d_%H%M%S").tar.gz"
sudo tar -czf "$CURRENT_BACKUP" \
    -C "$BASE_DIR" \
    postgres-data uploads logs 2>/dev/null || true

# Restore from backup
echo "🔄 Restoring from backup..."
sudo tar -xzf "$LATEST_BACKUP" -C "$BASE_DIR"

# Set proper permissions
echo "🔐 Setting proper permissions..."
sudo chown -R 999:999 "$BASE_DIR/postgres-data"
sudo chown -R 1001:1001 "$BASE_DIR/uploads"
sudo chmod -R 755 "$BASE_DIR/postgres-data"
sudo chmod -R 755 "$BASE_DIR/uploads"

# Start containers
echo "🚀 Starting containers..."
docker-compose up -d

echo "✅ Restore completed successfully!"
echo "📁 Restored from: $(basename "$LATEST_BACKUP")"
echo "💾 Current data backed up to: $(basename "$CURRENT_BACKUP")"
echo "🌐 Application should be available at: http://localhost:3001"
