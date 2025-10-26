import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/database';
import { ApiResponse } from '@/app/types';
import { requireRoleAtLeast } from '@/app/api/middleware';
import { ExcelHelper } from '@/app/utils/excel';
import path from 'path';

export async function GET(request: NextRequest) {
  const auth = requireRoleAtLeast(request, 'admin');
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    
    if (!fromDate || !toDate) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'From date and to date are required'
      }, { status: 400 });
    }

    // Validate date format
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    
    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      }, { status: 400 });
    }

    if (fromDateObj > toDateObj) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'From date cannot be after to date'
      }, { status: 400 });
    }

    const client = await pool.connect();
    
    try {
      // Fetch all relevant work orders:
      // 1. Work orders that started within the date range
      // 2. Work orders that started before the date range but are still ongoing
      // 3. Work orders that completed within the date range (regardless of start date)
      const workOrdersResult = await client.query(`
        SELECT 
          work_order_no,
          work_type,
          status,
          work_order_date,
          work_completed_date,
          completion_approved_at
        FROM work_orders
        WHERE (
          -- Work orders that started within the date range
          (work_order_date >= $1 AND work_order_date <= $2)
          OR
          -- Work orders that started before the date range but are still ongoing
          (work_order_date < $1 AND status IN ('pending', 'ongoing', 'completion_requested'))
          OR
          -- Work orders that completed within the date range
          (work_completed_date IS NOT NULL AND work_completed_date >= $1 AND work_completed_date <= $2)
          OR
          -- Work orders that were approved for completion within the date range
          (completion_approved_at IS NOT NULL AND completion_approved_at >= $1 AND completion_approved_at <= $2)
        )
        ORDER BY work_order_date, work_order_no
      `, [fromDate, toDate]);

      const workOrders = workOrdersResult.rows;
      
  

      // Categorize work types based on the new work types
      const categorizeWorkType = (workType: string): string => {
        const type = workType.toLowerCase().trim();
        
        // Exact matches for new work types
        if (type === 'mechanical') return 'mechanical';
        if (type === 'electrical') return 'electrical';
        if (type === 'hydraulics') return 'hydraulics';
        if (type === 'schedule check') return 'schedule_check';
        if (type === 'electrical repair') return 'electrical_repair';
        if (type === 'painting') return 'painting';
        if (type === 'miscellaneous') return 'miscellaneous';
        if (type === 'customer request') return 'customer_request';
        if (type === 'other') return 'other';
        
        // Fallback for partial matches
        if (type.includes('mechanical')) return 'mechanical';
        if (type.includes('electrical')) return 'electrical';
        if (type.includes('hydraulic')) return 'hydraulics';
        if (type.includes('schedule') && type.includes('check')) return 'schedule_check';
        if (type.includes('painting') || type.includes('paint')) return 'painting';
        if (type.includes('miscellaneous')) return 'miscellaneous';
        if (type.includes('customer')) return 'customer_request';
        
        // Everything else goes to other
        return 'other';
      };


      // Aggregate work orders by category and status
      const categories = [
        'mechanical',
        'electrical',
        'hydraulics',
        'schedule_check',
        'electrical_repair',
        'painting',
        'miscellaneous',
        'customer_request',
        'other'
      ];

      const categoryData = new Map<string, {
        ongoing: { count: number; workOrderNos: string[] };
        completed: { count: number; workOrderNos: string[] };
      }>();

      // Initialize all categories
      categories.forEach(cat => {
        categoryData.set(cat, {
          ongoing: { count: 0, workOrderNos: [] },
          completed: { count: 0, workOrderNos: [] }
        });
      });

      // Process each work order
      workOrders.forEach(wo => {
        const category = categorizeWorkType(wo.work_type);
        const data = categoryData.get(category);
        
        if (data) {
          // Determine if work order is ongoing or completed based on completion date
          const isCompleted = wo.status === 'completed' && wo.completion_approved_at;
          const hasCompletionDate = wo.work_completed_date;
          const toDateObj = new Date(toDate);
          
          let isOngoing = false;
          let isCompletedForReport = false;
          
          if (isCompleted && hasCompletionDate) {
            // If it has a completion date, check if it completed within the date range
            const completionDate = new Date(wo.work_completed_date);
            if (completionDate <= toDateObj) {
              // Completed within or before the "to date" - it's completed for this report
              isCompletedForReport = true;
            } else {
              // Completion date is after the "to date" - it's still ongoing for this report
              isOngoing = true;
            }
          } else if (wo.status === 'pending' || wo.status === 'ongoing' || wo.status === 'completion_requested') {
            // No completion date or not yet approved - it's ongoing
            isOngoing = true;
          } else if (wo.status === 'completed' && !hasCompletionDate) {
            // Completed status but no completion date - treat as completed
            isCompletedForReport = true;
          }
          
          // Add to appropriate category
          if (isOngoing) {
            data.ongoing.count++;
            data.ongoing.workOrderNos.push(wo.work_order_no);
          
          } else if (isCompletedForReport) {
            data.completed.count++;
            data.completed.workOrderNos.push(wo.work_order_no);
          }
        }
      });

      // Load template using ExcelHelper
      const templatePath = path.join(process.cwd(), 'public', 'template_weekly.xlsx');
      const excelHelper = await ExcelHelper.loadTemplate(templatePath, 'Template Sheet');

      // Fill in today's date in F1
      const today = new Date().toISOString().split('T')[0];
      excelHelper.setCellValue('F1', today);

      // Calculate week number for the selected range
      // If range spans multiple weeks, use the week number of the "to date"
      const getWeekNumber = (date: Date): number => {
        const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
        const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
        return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      };

      const toDateForWeek = new Date(toDate);
      const weekNumber = getWeekNumber(toDateForWeek);
      excelHelper.setCellValue('F2', weekNumber);

      // Fill in date range
      excelHelper.setCellValue('D3', fromDate);
      excelHelper.setCellValue('F3', toDate);

      // Fill in data for each category
      const categoryRows = [
        { category: 'mechanical', row: 6 },
        { category: 'electrical', row: 7 },
        { category: 'hydraulics', row: 8 },
        { category: 'schedule_check', row: 9 },
        { category: 'electrical_repair', row: 10 },
        { category: 'painting', row: 11 },
        { category: 'miscellaneous', row: 12 },
        { category: 'customer_request', row: 13 },
        { category: 'other', row: 14 }
      ];

      categoryRows.forEach(({ category, row }) => {
        const data = categoryData.get(category);
        if (!data) return;

        // Fill counts
        excelHelper.setCellValue(`C${row}`, data.ongoing.count);
        excelHelper.setCellValue(`D${row}`, data.completed.count);

        // Build work order numbers string for column F
        const workOrderStrings = [];
        
        if (data.ongoing.count > 0) {
          workOrderStrings.push(`Ongoing: ${data.ongoing.workOrderNos.join(', ')}`);
        }
        
        if (data.completed.count > 0) {
          workOrderStrings.push(`Completed: ${data.completed.workOrderNos.join(', ')}`);
        }

        // Only fill F column if there are work orders
        if (workOrderStrings.length > 0) {
          excelHelper.setCellValue(`F${row}`, workOrderStrings.join('; '));
        }
      });

      // Generate the Excel buffer
      const buffer = await excelHelper.getBuffer();

      // Return the Excel file as a blob response
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="ProgressReport_${fromDate}_to_${toDate}.xlsx"`
        }
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error generating progress report:', error);
    return NextResponse.json<ApiResponse<null>>({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}
