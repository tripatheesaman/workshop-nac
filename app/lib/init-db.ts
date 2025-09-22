import pool from './database';
import bcrypt from 'bcryptjs';

export async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Create users table
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

    // Ensure role column exists for previously created databases
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
    `);
    
    // Ensure first_login column exists for previously created databases
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT TRUE;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.check_constraints
          WHERE constraint_name = 'users_role_check'
        ) THEN
          ALTER TABLE users
          ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin','admin','user'));
        END IF;
      END $$;
    `);

    // Create work_orders table with approval workflow
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        work_order_no VARCHAR(50) UNIQUE NOT NULL,
        work_order_date DATE NOT NULL,
        equipment_number VARCHAR(100) NOT NULL,
        km_hrs INTEGER NOT NULL,
        requested_by VARCHAR(100) NOT NULL,
        requested_by_id INTEGER REFERENCES users(id),
        work_type VARCHAR(100) NOT NULL,
        job_allocation_time TIMESTAMP NOT NULL,
        work_completed_date DATE,
        completion_requested_by INTEGER REFERENCES users(id),
        completion_requested_at TIMESTAMP,
        completion_approved_by INTEGER REFERENCES users(id),
        completion_approved_at TIMESTAMP,
        completion_rejection_reason TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','ongoing','completion_requested','completed','rejected')),
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        reference_document VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Alter table to ensure approval columns and status check exist on older DBs
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS requested_by_id INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ALTER COLUMN status SET DEFAULT 'pending'`);
    
    // Make km_hrs optional (nullable) for existing databases
    await client.query(`ALTER TABLE work_orders ALTER COLUMN km_hrs DROP NOT NULL`);
    
    // Add completion approval columns for existing databases
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_requested_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_approved_by INTEGER REFERENCES users(id)`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_approved_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completion_rejection_reason TEXT`);
    
    // Update status check constraint to include 'completion_requested'
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.check_constraints 
          WHERE constraint_name = 'work_orders_status_check'
        ) THEN
          ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check 
          CHECK (status IN ('pending','ongoing','completion_requested','completed','rejected'));
        END IF;
      END $$;
    `);

    // Create findings table
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS actions (
        id SERIAL PRIMARY KEY,
        finding_id INTEGER REFERENCES findings(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        action_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    // Create job_performed_by table
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

    // Create technicians table
    await client.query(`
      CREATE TABLE IF NOT EXISTS technicians (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        staff_id VARCHAR(50) UNIQUE NOT NULL,
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

    // Create index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);
    `);

    // Seed superadmin user
    const hashedPassword = await bcrypt.hash('superadmin', 10);
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
      ('Mike Johnson', 'TECH003'),
      ('Sarah Wilson', 'TECH004'),
      ('David Brown', 'TECH005')
      ON CONFLICT (staff_id) DO NOTHING
    `);

    // Database initialized successfully
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
} 