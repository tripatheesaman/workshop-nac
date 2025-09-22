#!/bin/bash

# Setup script for Work Order Management System volumes
# This script creates the necessary directories for Docker volumes

set -e

echo "🔧 Setting up volume directories for WKS Work Order Management System..."

# Base directory
BASE_DIR="/srv/wks-work-order"

# Create base directory
echo "📁 Creating base directory: $BASE_DIR"
sudo mkdir -p "$BASE_DIR"

# Create PostgreSQL data directories
echo "🗄️ Creating PostgreSQL data directories..."
sudo mkdir -p "$BASE_DIR/postgres-data"
sudo mkdir -p "$BASE_DIR/postgres-data-dev"

# Create uploads directories
echo "📤 Creating uploads directories..."
sudo mkdir -p "$BASE_DIR/uploads"
sudo mkdir -p "$BASE_DIR/uploads-dev"

# Set proper permissions
echo "🔐 Setting proper permissions..."
sudo chown -R 999:999 "$BASE_DIR/postgres-data"  # PostgreSQL user (UID 999)
sudo chown -R 999:999 "$BASE_DIR/postgres-data-dev"
sudo chmod -R 755 "$BASE_DIR/postgres-data"
sudo chmod -R 755 "$BASE_DIR/postgres-data-dev"

# Set uploads permissions (readable/writable by the application)
sudo chown -R 1001:1001 "$BASE_DIR/uploads"  # Next.js user (UID 1001)
sudo chown -R 1001:1001 "$BASE_DIR/uploads-dev"
sudo chmod -R 777 "$BASE_DIR/uploads"  # Full permissions for subdirectory creation
sudo chmod -R 777 "$BASE_DIR/uploads-dev"

# Create logs directory
echo "📋 Creating logs directory..."
sudo mkdir -p "$BASE_DIR/logs"
sudo chmod -R 755 "$BASE_DIR/logs"

echo "✅ Volume directories created successfully!"
echo ""
echo "📂 Directory structure:"
echo "   $BASE_DIR/"
echo "   ├── postgres-data/      (Production PostgreSQL data)"
echo "   ├── postgres-data-dev/  (Development PostgreSQL data)"
echo "   ├── uploads/           (Production file uploads)"
echo "   ├── uploads-dev/       (Development file uploads)"
echo "   └── logs/              (Application logs)"
echo ""
echo "🔐 Permissions set for Docker containers"
echo "   PostgreSQL data: owned by UID 999 (postgres user)"
echo "   Uploads: owned by UID 1001 (nextjs user) with 777 permissions"
echo ""
echo "🚀 You can now run: docker-compose up --build -d"
