#!/bin/bash

# Server Setup Script for MGSEM Work Order Management System
# Run this on your server to prepare the environment

set -e

echo "🔧 Setting up server for MGSEM Work Order Management System..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "✅ Docker installed. Please log out and back in for group changes to take effect."
else
    echo "✅ Docker is already installed"
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
    echo "🐳 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose is already installed"
fi

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /opt/mgsem-work-order
sudo chown $USER:$USER /opt/mgsem-work-order

echo "✅ Server setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Clone your repository to /opt/mgsem-work-order"
echo "2. Copy your .env file"
echo "3. Run: npm run setup-volumes"
echo "4. Run: npm run deploy"
