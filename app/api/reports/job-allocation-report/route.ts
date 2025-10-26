import { NextRequest, NextResponse } from 'next/server';
import pool from '../../../lib/database';
import { ExcelHelper, formatTime, calculateDuration, getWorkTypeCode, getTechnicianInitials } from '../../../utils/excel';
import path from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { success: false, error: 'fromDate and toDate are required' },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    // Query to get all action dates within the date range with related data
    const query = `
      SELECT 
        ad.id as action_date_id,
        ad.action_date,
        ad.start_time,
        ad.end_time,
        ad.is_completed,
        a.id as action_id,
        a.description as action_description,
        f.id as finding_id,
        f.work_order_id,
        wo.work_order_no,
        wo.equipment_number,
        wo.work_type,
        wo.km_hrs
      FROM action_dates ad
      JOIN actions a ON ad.action_id = a.id
      JOIN findings f ON a.finding_id = f.id
      JOIN work_orders wo ON f.work_order_id = wo.id
      WHERE ad.action_date BETWEEN $1 AND $2
      ORDER BY ad.action_date ASC, wo.work_order_no ASC, a.id ASC
    `;

    const result = await client.query(query, [fromDate, toDate]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No actions found for the selected date range' },
        { status: 404 }
      );
    }

    // For each action date, get spare parts and technicians
    const actionData = [];
    
    for (const row of result.rows) {
      // Get spare parts for this action
      const sparePartsResult = await client.query(
        `SELECT part_number, quantity FROM spare_parts WHERE action_id = $1`,
        [row.action_id]
      );

      // Get technicians for this specific action date
      const techniciansResult = await client.query(
        `SELECT at.name, at.staff_id 
         FROM action_technicians at
         JOIN action_dates ad ON ad.action_id = at.action_id
         WHERE ad.id = $1`,
        [row.action_date_id]
      );

      actionData.push({
        ...row,
        spare_parts: sparePartsResult.rows,
        technicians: techniciansResult.rows
      });
    }

    // Load the template file
    const templatePath = path.join(process.cwd(), 'public', 'job_allocation_template_file.xlsx');
    const excelHelper = await ExcelHelper.loadTemplate(templatePath, 'Template Sheet');

    // Start filling from row 5
    let currentRow = 5;
    const templateRow = 5; // Row to copy formatting from

    for (let i = 0; i < actionData.length; i++) {
      const data = actionData[i];

      // If not the first row, copy formatting from template row and insert
      if (i > 0) {
        currentRow++;
        excelHelper.copyRowAndInsertAbove(templateRow, currentRow, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
      }

      // A: Equipment Number
      excelHelper.setCellValue(`A${currentRow}`, data.equipment_number || '');

      // B: Job Order Number
      excelHelper.setCellValue(`B${currentRow}`, data.work_order_no || '');

      // C: Work Type Code
      const workTypeCode = getWorkTypeCode(data.work_type);
      excelHelper.setCellValue(`C${currentRow}`, workTypeCode);

      // D: Start Time
      const startTime = formatTime(data.start_time);
      excelHelper.setCellValue(`D${currentRow}`, startTime);

      // E: End Time
      const endTime = formatTime(data.end_time);
      excelHelper.setCellValue(`E${currentRow}`, endTime);

      // F: Duration (HH:MM)
      const duration = calculateDuration(data.start_time, data.end_time);
      excelHelper.setCellValue(`F${currentRow}`, duration);

      // G: Kilometers
      excelHelper.setCellValue(`G${currentRow}`, data.km_hrs || '');

      // H: Part Numbers (comma-separated)
      const partNumbers = data.spare_parts.map((sp: { part_number: string }) => sp.part_number).join(', ');
      excelHelper.setCellValue(`H${currentRow}`, partNumbers);

      // I: Quantities (comma-separated)
      const quantities = data.spare_parts.map((sp: { quantity: string | number }) => sp.quantity).join(', ');
      excelHelper.setCellValue(`I${currentRow}`, quantities);

      // J: Completed checkbox/tick
      // Use a checkmark symbol if completed, empty if not
      excelHelper.setCellValue(`J${currentRow}`, data.is_completed ? '✓' : '');

      // M: Technician Initials (comma-separated)
      const technicianInitials = data.technicians
        .map((tech: { name: string }) => getTechnicianInitials(tech.name))
        .join(', ');
      excelHelper.setCellValue(`M${currentRow}`, technicianInitials);
    }

    // Generate the Excel file
    const buffer = await excelHelper.getBuffer();

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="JobAllocationReport_${fromDate}_to_${toDate}_${Date.now()}.xlsx"`
      }
    });

  } catch (error) {
    console.error('Error generating job allocation report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate job allocation report' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

