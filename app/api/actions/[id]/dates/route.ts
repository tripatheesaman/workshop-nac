import { NextRequest, NextResponse } from 'next/server';
import pool from '../../../../lib/database';

// GET /api/actions/:id/dates - Get all dates for an action
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: actionId } = await params;

  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, action_id, action_date, start_time, end_time, is_completed, created_at, updated_at
       FROM action_dates
       WHERE action_id = $1
       ORDER BY action_date DESC`,
      [actionId]
    );

    return NextResponse.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching action dates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch action dates' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// POST /api/actions/:id/dates - Add a new date entry (Start Again functionality)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: actionId } = await params;

  try {
    const body = await request.json();
    const { action_date, start_time, end_time, is_completed = false } = body;

    if (!action_date || !start_time || !end_time) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: action_date, start_time, end_time' },
        { status: 400 }
      );
    }

    const client = await pool.connect();

    try {
      const result = await client.query(
        `INSERT INTO action_dates (action_id, action_date, start_time, end_time, is_completed)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, action_id, action_date, start_time, end_time, is_completed, created_at, updated_at`,
        [actionId, action_date, start_time, end_time, is_completed]
      );

      return NextResponse.json({
        success: true,
        data: result.rows[0]
      }, { status: 201 });
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    console.error('Error adding action date:', error);
    
    // Handle unique constraint violation
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'An entry for this action and date already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to add action date' },
      { status: 500 }
    );
  }
}

// PUT /api/actions/:id/dates - Update completion status for a specific date
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: actionId } = await params;

  try {
    const body = await request.json();
    const { action_date, is_completed } = body;

    if (!action_date || is_completed === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: action_date, is_completed' },
        { status: 400 }
      );
    }

    const client = await pool.connect();

    try {
      const result = await client.query(
        `UPDATE action_dates
         SET is_completed = $1, updated_at = CURRENT_TIMESTAMP
         WHERE action_id = $2 AND action_date = $3
         RETURNING id, action_id, action_date, start_time, end_time, is_completed, created_at, updated_at`,
        [is_completed, actionId, action_date]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Action date not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: result.rows[0]
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating action date:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update action date' },
      { status: 500 }
    );
  }
}

// DELETE /api/actions/:id/dates/:dateId - Delete a specific action date
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: actionId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const dateId = searchParams.get('dateId');

  if (!dateId) {
    return NextResponse.json(
      { success: false, error: 'dateId is required' },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `DELETE FROM action_dates 
       WHERE id = $1 AND action_id = $2
       RETURNING id`,
      [dateId, actionId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Action date not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Action date deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting action date:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete action date' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

