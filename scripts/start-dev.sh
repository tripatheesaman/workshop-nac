#!/bin/sh

# Wait for database to be ready
echo "Waiting for database to be ready..."
while ! nc -z db 5432; do
  sleep 1
done
echo "Database is ready!"

# Run database initialization
echo "Initializing database..."
node init-db-simple.js



# Start the development server
echo "Starting development server..."
exec npm run dev 