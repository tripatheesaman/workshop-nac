const { Pool } = require('pg');

// Database configuration - environment variables are already available in Docker
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'wks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false, // Disable SSL for Docker internal connections
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function initializeDatabase() {
  let client;
  
  try {
    console.log('Connecting to database...');
    client = await pool.connect();
    console.log('Database connection established successfully');
    
    // Create users table
    console.log('Creating users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin','admin','user')),
        first_login BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure first_login column exists for previously created databases
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT TRUE;
    `);

    // Create work_orders table with approval workflow
    console.log('Creating work_orders table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        work_order_no VARCHAR(50) UNIQUE NOT NULL,
        work_order_date DATE NOT NULL,
        equipment_number VARCHAR(100) NOT NULL,
        km_hrs INTEGER,
        requested_by VARCHAR(100) NOT NULL,
        requested_by_id INTEGER REFERENCES users(id),
        work_type VARCHAR(100) NOT NULL,
        work_type_other VARCHAR(100),
        job_allocation_time TIMESTAMP NOT NULL,
        description TEXT NOT NULL,
        work_completed_date DATE,
        completion_requested_by INTEGER REFERENCES users(id),
        completion_requested_at TIMESTAMP,
        completion_approved_by INTEGER REFERENCES users(id),
        completion_approved_at TIMESTAMP,
        completion_rejection_reason TEXT,
        reference_document VARCHAR(500),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','ongoing','completion_requested','completed','rejected')),
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure completion columns exist for previously created databases
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_requested_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_approved_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_approved_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_rejection_reason TEXT`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_type_other VARCHAR(100)`);
    await client.query(`ALTER TABLE work_orders ALTER COLUMN km_hrs DROP NOT NULL`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description TEXT`);
    await client.query(`UPDATE work_orders SET description = COALESCE(description, '')`);

    // Create findings table
    console.log('Creating findings table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS findings (
        id SERIAL PRIMARY KEY,
        work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        reference_image VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create actions table
    console.log('Creating actions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS actions (
        id SERIAL PRIMARY KEY,
        finding_id INTEGER REFERENCES findings(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        action_date DATE NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure actions.end_time is nullable for optional end time at creation
    await client.query(`ALTER TABLE actions ALTER COLUMN end_time DROP NOT NULL`);

    // Create spare_parts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_parts (
        id SERIAL PRIMARY KEY,
        action_id INTEGER REFERENCES actions(id) ON DELETE CASCADE,
        part_name VARCHAR(200) NOT NULL,
        part_number VARCHAR(100) NOT NULL,
        quantity INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create job_performed_by table (legacy, work-order level)
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_performed_by (
        id SERIAL PRIMARY KEY,
        work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        staff_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create action_technicians table (per-action technicians)
    await client.query(`
      CREATE TABLE IF NOT EXISTS action_technicians (
        id SERIAL PRIMARY KEY,
        action_id INTEGER REFERENCES actions(id) ON DELETE CASCADE,
        technician_id INTEGER REFERENCES technicians(id),
        name VARCHAR(100) NOT NULL,
        staff_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add unique constraint if it doesn't exist
    await client.query(`
      ALTER TABLE action_technicians 
      ADD CONSTRAINT IF NOT EXISTS action_technicians_action_id_staff_id_key 
      UNIQUE (action_id, staff_id)
    `);

    // Create technicians table
    await client.query(`
      CREATE TABLE IF NOT EXISTS technicians (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        staff_id VARCHAR(50) UNIQUE NOT NULL,
        designation VARCHAR(100),
        level VARCHAR(50),
        is_available BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'info' CHECK (type IN ('approval', 'rejection', 'completion', 'info')),
        is_read BOOLEAN DEFAULT false,
        related_entity_type VARCHAR(50),
        related_entity_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
      )
    `);

    // Ensure expires_at column exists for previously created databases
    await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')`);

    // Seed superadmin user with pre-hashed password (superadmin)
    const hashedPassword = '$2b$10$itx0fFAyDCIZbQ5bvV6k/.SICmi5x.fqLRZN5I/6R6GLtbQQc5ls.'; // "superadmin"
    await client.query(`
      INSERT INTO users (username, first_name, last_name, password_hash, role, first_login)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (username) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        first_login = EXCLUDED.first_login
    `, ['superadmin', 'Super', 'Admin', hashedPassword, 'superadmin', true]);

    // Seed some sample technicians
    await client.query(`
      INSERT INTO technicians (name, staff_id) VALUES
      ('John Doe', 'TECH001'),
      ('Jane Smith', 'TECH002'),
      ('Mike Johnson', 'TECH003')
      ON CONFLICT (staff_id) DO NOTHING
    `);

    // Create indexes for notifications
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at)`);

    // Database initialized successfully

  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the initialization
initializeDatabase().catch(console.error); 