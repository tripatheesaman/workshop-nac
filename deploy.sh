#!/bin/bash

# Production Deployment Script for Work Order Management System

set -e

echo "🚀 Starting production deployment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please create one from .env.example"
    exit 1
fi

# Setup volume directories if they don't exist
echo "🔧 Setting up volume directories..."
if [ ! -d "/srv/mgsem-work-order" ]; then
    echo "📁 Creating volume directories..."
    sudo mkdir -p /srv/mgsem-work-order/{postgres-data,uploads,logs}
    sudo chown -R 999:999 /srv/mgsem-work-order/postgres-data
    sudo chown -R 1001:1001 /srv/mgsem-work-order/uploads
    sudo chmod -R 755 /srv/mgsem-work-order/{postgres-data,uploads,logs}
    echo "✅ Volume directories created"
else
    echo "✅ Volume directories already exist"
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Remove old images to free up space
echo "🧹 Cleaning up old images..."
docker system prune -f

# Build and start containers
echo "🔨 Building and starting containers..."
docker-compose up --build -d

# Wait for containers to be ready
echo "⏳ Waiting for containers to be ready..."
sleep 30

# Check container status
echo "📊 Checking container status..."
docker-compose ps

# Check application logs
echo "📋 Application logs:"
docker-compose logs app --tail=20

echo "✅ Deployment completed!"
echo "🌐 Application is available at: http://localhost:3001"
echo "📊 Database is available at: localhost:5433"
echo ""
echo "Default login credentials:"
echo "Username: superadmin"
echo "Password: superadmin"
