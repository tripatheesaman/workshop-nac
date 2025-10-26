# Work Order Management System

A full-stack work order management application built with Next.js, TypeScript, and PostgreSQL. This system allows users to create, track, and manage work orders with findings, actions, spare parts, and technician assignments.

## Features

- 🔐 **Authentication System** - Secure login with JWT tokens
- 📋 **Work Order Management** - Create, view, and manage work orders
- 🔍 **Findings & Defects** - Add and track findings for each work order
- ⚙️ **Actions & Spare Parts** - Record actions taken and spare parts used
- 👥 **Technician Management** - Assign technicians to work orders
- 📊 **Dashboard** - Overview of pending, ongoing, and completed tasks
- 📱 **Responsive Design** - Works on desktop and mobile devices
- 🎨 **Custom Theme** - Nepal Airlines branding with primary (#08398F) and secondary (#E34F4A) colors

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS v4
- **Backend**: Next.js API Routes, PostgreSQL
- **Authentication**: JWT, bcryptjs
- **Database**: PostgreSQL with connection pooling
- **Image Processing**: Sharp for image compression

## Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- npm or yarn

## Installation & Setup

### 1. Clone the repository
```bash
git clone <repository-url>
cd workordermanagement
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
Create a `.env.local` file in the root directory:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mgsem
DB_USER=your_username
DB_PASSWORD=your_password

# API Configuration
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Environment
NODE_ENV=development
```

### 4. Set up the database
Make sure PostgreSQL is running and create a database named `mgsem`:
```sql
CREATE DATABASE mgsem;
```

### 5. Initialize the database
Run the database initialization script:
```bash
npm run init-db
```

This will:
- Create all necessary tables
- Seed the superadmin user
- Add sample technicians

### 6. Start the development server
```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Production Deployment

### Docker Deployment

1. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your production database credentials
   ```

2. **Set up volume directories (first time only)**
   ```bash
   npm run setup-volumes
   # or manually: sudo mkdir -p /srv/mgsem-work-order/{postgres-data,uploads,logs}
   ```

3. **Build and start containers**
   ```bash
   docker-compose up --build -d
   ```

4. **Access the application**
   Navigate to [http://localhost:3001](http://localhost:3001)

**Note**: The application uses port 3001 for production to avoid conflicts with other services.

### Production Ports
- **Application**: 3001 (external) → 3000 (internal)
- **Database**: 5433 (external) → 5432 (internal)

### Volume Directories
- **PostgreSQL Data**: `/srv/mgsem-work-order/postgres-data`
- **File Uploads**: `/srv/mgsem-work-order/uploads`
- **Application Logs**: `/srv/mgsem-work-order/logs`
- **Backups**: `/srv/mgsem-work-order/backups`

### Volume Management
```bash
# Setup volumes (first time)
npm run setup-volumes

# Create backup
npm run backup

# Restore from backup
npm run restore
```

## Default Login Credentials

- **Username**: `superadmin`
- **Password**: `superadmin`

## Project Structure

```
workordermanagement/
├── app/
│   ├── api/                    # API routes
│   │   ├── auth/              # Authentication endpoints
│   │   ├── dashboard/         # Dashboard statistics
│   │   ├── work-orders/       # Work order management
│   │   ├── findings/          # Findings management
│   │   ├── technicians/       # Technician management
│   │   └── job-performed-by/  # Job assignments
│   ├── components/            # Reusable UI components
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   ├── lib/                   # Database and configuration
│   ├── auth/                  # Authentication pages
│   ├── dashboard/             # Dashboard pages
│   └── work-orders/           # Work order pages
├── scripts/                   # Database initialization
├── public/                    # Static assets
└── README.md
```

## Database Schema

### Tables
- **users** - User authentication and profiles
- **work_orders** - Main work order records
- **findings** - Findings/defects for each work order
- **actions** - Actions taken for each finding
- **spare_parts** - Spare parts used in actions
- **job_performed_by** - Technicians assigned to work orders
- **technicians** - Available technicians

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### Work Orders
- `GET /api/work-orders` - List work orders
- `POST /api/work-orders` - Create new work order
- `GET /api/work-orders/[id]` - Get work order details
- `PUT /api/work-orders/[id]/status` - Update work order status
- `PUT /api/work-orders/[id]/complete` - Complete work order

### Findings
- `POST /api/findings` - Add new finding

### Job Performed By
- `POST /api/job-performed-by` - Assign technician to work order

### Technicians
- `GET /api/technicians` - Get available technicians

## Development Guidelines

### Code Organization
- **Types**: All interfaces and types go in `/app/types/`
- **Utils**: All utility functions go in `/app/utils/`
- **Components**: Reusable components in `/app/components/`
- **Max file size**: 150 lines per file
- **No `any` types**: Use proper TypeScript types

### Best Practices
- Follow DRY principle
- Use reusable components for everything
- Implement proper error handling
- Use environment variables for configuration
- Follow TypeScript best practices

## Deployment

### Build for production
```bash
npm run build
npm start
```

### Environment Variables for Production
Make sure to update the environment variables for production:
- Use a strong JWT secret
- Set proper database credentials
- Update API base URL
- Set `NODE_ENV=production`

## Contributing

1. Follow the established code organization
2. Use TypeScript for all new code
3. Create reusable components
4. Add proper error handling
5. Test thoroughly before submitting

## License

This project is proprietary software for Nepal Airlines.

## Support

For support and questions, please contact the development team. 