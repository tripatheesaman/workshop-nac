import { NextRequest, NextResponse } from 'next/server';
import pool from '../../lib/database';
import { Action, ApiResponse } from '../../types';
import { requireRoleAtLeast } from '@/app/api/middleware';

export async function POST(request: NextRequest) {
  const auth = requireRoleAtLeast(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const {
      finding_id,
      description,
      action_date,
      start_time,
      end_time
    } = body;

    // Validation
    if (!finding_id || !description || !action_date || !start_time) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'finding_id, description, action_date and start_time are required'
      }, { status: 400 });
    }

    if (typeof finding_id !== 'number' || finding_id <= 0) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Invalid finding ID'
      }, { status: 400 });
    }

    if (description.trim().length === 0) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Action description cannot be empty'
      }, { status: 400 });
    }

    if (description.length > 1000) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Action description must be less than 1000 characters'
      }, { status: 400 });
    }

    // Validate time format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(start_time)) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Invalid start time format. Use HH:MM format'
      }, { status: 400 });
    }
    if (end_time && !timeRegex.test(end_time)) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Invalid end time format. Use HH:MM format'
      }, { status: 400 });
    }

    // Validate time range only if end_time provided
    if (end_time) {
      const start = new Date(`2000-01-01T${start_time}`);
      const end = new Date(`2000-01-01T${end_time}`);
      if (start >= end) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'End time must be after start time'
        }, { status: 400 });
      }
    }

    const client = await pool.connect();
    
    try {
      // Check if finding exists
      const findingCheck = await client.query(
        'SELECT id FROM findings WHERE id = $1',
        [finding_id]
      );

      if (findingCheck.rows.length === 0) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Finding not found'
        }, { status: 404 });
      }

      // Get work order date and previous actions for validation
      const workOrderQuery = await client.query(`
        SELECT wo.work_order_date 
        FROM work_orders wo 
        JOIN findings f ON f.work_order_id = wo.id 
        WHERE f.id = $1
      `, [finding_id]);

      if (workOrderQuery.rows.length === 0) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Work order not found'
        }, { status: 404 });
      }

      const workOrderDate = workOrderQuery.rows[0].work_order_date;

      // Check if action date is before work order date
      if (new Date(action_date) < new Date(workOrderDate)) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: `Action date cannot be before work order date (${new Date(workOrderDate).toLocaleDateString('en-GB')})`
        }, { status: 400 });
      }

      // Convert time strings to proper timestamp format
      const startTimestamp = `${action_date}T${start_time}:00`;
      const endTimestamp = end_time ? `${action_date}T${end_time}:00` : null;
      
      const result = await client.query(`
        INSERT INTO actions (
          finding_id, description, action_date, start_time, end_time
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        finding_id,
        description.trim(),
        action_date,
        startTimestamp,
        endTimestamp
      ]);

      const action = result.rows[0];

      return NextResponse.json<ApiResponse<Action>>({
        success: true,
        data: action
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error creating action:', error);
    return NextResponse.json<ApiResponse<null>>({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
} 