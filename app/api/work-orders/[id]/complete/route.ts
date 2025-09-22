import { NextRequest, NextResponse } from 'next/server';
import pool from '../../../../lib/database';
import { WorkOrder, ApiResponse } from '../../../../types';
import { requireRoleAtLeast } from '@/app/api/middleware';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRoleAtLeast(request, 'user');
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const workOrderId = parseInt(id);
    const body = await request.json();
    const { work_completed_date } = body;

    if (isNaN(workOrderId)) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Invalid work order ID'
      }, { status: 400 });
    }

    if (!work_completed_date) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Completion date is required'
      }, { status: 400 });
    }

    const client = await pool.connect();
    
    try {
      // Get work order details for validation
      const workOrderQuery = await client.query(`
        SELECT work_order_date, status 
        FROM work_orders 
        WHERE id = $1
      `, [workOrderId]);

      if (workOrderQuery.rows.length === 0) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Work order not found'
        }, { status: 404 });
      }

      const workOrder = workOrderQuery.rows[0];

      // Check if work order is already completed or has a pending completion request
      if (workOrder.status === 'completed') {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Work order is already completed'
        }, { status: 400 });
      }
      
      if (workOrder.status === 'completion_requested') {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Completion request is already pending approval'
        }, { status: 400 });
      }

      // Validate completion date is not before work order date
      if (new Date(work_completed_date) < new Date(workOrder.work_order_date)) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: `Completion date cannot be before work order date (${new Date(workOrder.work_order_date).toLocaleDateString('en-GB')})`
        }, { status: 400 });
      }

      // Get the latest action date across all findings for this work order
      const latestActionQuery = await client.query(`
        SELECT MAX(a.action_date) as latest_action_date
        FROM actions a
        JOIN findings f ON f.id = a.finding_id
        WHERE f.work_order_id = $1
      `, [workOrderId]);

      if (latestActionQuery.rows[0].latest_action_date) {
        const latestActionDate = latestActionQuery.rows[0].latest_action_date;
        
        // Validate completion date is not before the latest action date
        if (new Date(work_completed_date) < new Date(latestActionDate)) {
          return NextResponse.json<ApiResponse<null>>({
            success: false,
            error: `Completion date cannot be before the last action date (${new Date(latestActionDate).toLocaleDateString('en-GB')})`
          }, { status: 400 });
        }
      }

      const result = await client.query(`
        UPDATE work_orders 
        SET 
          status = 'completion_requested', 
          work_completed_date = $1, 
          completion_requested_by = $2,
          completion_requested_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `, [work_completed_date, auth.user.userId, workOrderId]);

      const updatedWorkOrder = result.rows[0];

      return NextResponse.json<ApiResponse<WorkOrder>>({
        success: true,
        data: updatedWorkOrder
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Complete work order error:', error);
    return NextResponse.json<ApiResponse<null>>({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
} 