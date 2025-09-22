import { NextResponse } from 'next/server';
import pool from '../../../lib/database';
import { ApiResponse } from '../../../types';

// POST - Clean up expired notifications (can be called by cron job)
export async function POST() {
  // This endpoint can be called by a cron job or manually
  // For cron job usage, you might want to add a secret key validation
  
  try {
    const client = await pool.connect();
    
    try {
      // Delete expired notifications
      const result = await client.query(`
        DELETE FROM notifications 
        WHERE expires_at < CURRENT_TIMESTAMP
      `);

      const deletedCount = result.rowCount || 0;

      return NextResponse.json<ApiResponse<{ deletedCount: number }>>({
        success: true,
        data: { deletedCount },
        message: `Cleaned up ${deletedCount} expired notifications`
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Cleanup notifications error:', error);
    return NextResponse.json<ApiResponse<null>>({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}
