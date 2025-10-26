#!/bin/bash

# Backup script for Work Order Management System volumes
# This script creates backups of PostgreSQL data and uploads

set -e

echo "💾 Creating backup of MGSEM Work Order Management System..."

# Base directory
BASE_DIR="/srv/mgsem-work-order"
BACKUP_DIR="/srv/mgsem-work-order/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="mgsem-backup-$TIMESTAMP"

# Create backup directory
echo "📁 Creating backup directory..."
sudo mkdir -p "$BACKUP_DIR"

# Stop containers to ensure data consistency
echo "🛑 Stopping containers for consistent backup..."
docker-compose down

# Create backup
echo "📦 Creating backup: $BACKUP_NAME"
sudo tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
    -C "$BASE_DIR" \
    postgres-data uploads logs

# Restart containers
echo "🚀 Restarting containers..."
docker-compose up -d

# Set backup permissions
sudo chmod 644 "$BACKUP_DIR/$BACKUP_NAME.tar.gz"

echo "✅ Backup completed successfully!"
echo "📁 Backup location: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
echo "📊 Backup size: $(du -h "$BACKUP_DIR/$BACKUP_NAME.tar.gz" | cut -f1)"

# Clean up old backups (keep last 7 days)
echo "🧹 Cleaning up old backups..."
find "$BACKUP_DIR" -name "mgsem-backup-*.tar.gz" -mtime +7 -delete

echo "🎉 Backup process completed!"
