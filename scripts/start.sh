#!/bin/sh

# Wait for database to be ready
echo "Waiting for database to be ready..."
while ! nc -z db 5432; do
  sleep 1
done
echo "Database is ready!"

# Ensure uploads directory exists and has proper permissions
echo "Setting up uploads directory permissions..."
mkdir -p public/uploads
# Try to set permissions, but don't fail if we can't (non-root user)
chmod -R 777 public/uploads 2>/dev/null || echo "Note: Could not set uploads directory permissions (running as non-root user)"
echo "Uploads directory permissions set!"

# Wait a bit more for PostgreSQL to finish its initialization
echo "Waiting for PostgreSQL to complete initialization..."
sleep 5

# Check if database tables exist, if not, run initialization
echo "Checking database state..."
if node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mgsem',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

(async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'users\')');
    client.release();
    await pool.end();
    
    if (!result.rows[0].exists) {
      console.log('Database tables not found, running initialization...');
      process.exit(1);
    } else {
      console.log('Database tables exist, skipping initialization.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Error checking database:', error);
    process.exit(1);
  }
})();
"; then
  echo "Database is properly initialized"
else
  echo "Database needs initialization, running init script..."
  node init-db-simple.js
  if [ $? -eq 0 ]; then
    echo "Database initialization completed successfully!"
  else
    echo "Database initialization failed, but continuing..."
  fi
fi

# Start the application
echo "Starting application..."
exec node server.js 