import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/database';
import { ApiResponse } from '@/app/types';
import { requireRoleAtLeast } from '@/app/api/middleware';
import { ExcelHelper, formatTime, formatDate } from '@/app/utils/excel';
import path from 'path';

export async function GET(request: NextRequest) {
  const auth = requireRoleAtLeast(request, 'user');
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const workOrderId = searchParams.get('workOrderId');
    
    if (!workOrderId) {
      return NextResponse.json<ApiResponse<null>>({
        success: false,
        error: 'Work order ID is required'
      }, { status: 400 });
    }

    const client = await pool.connect();
    
    try {
      // Fetch work order details with all related data
      const workOrderResult = await client.query(`
        SELECT 
          wo.*,
          u.username as requested_by_username,
          u.first_name,
          u.last_name
        FROM work_orders wo
        LEFT JOIN users u ON wo.requested_by_id = u.id
        WHERE wo.id = $1
      `, [workOrderId]);

      if (workOrderResult.rows.length === 0) {
        return NextResponse.json<ApiResponse<null>>({
          success: false,
          error: 'Work order not found'
        }, { status: 404 });
      }

      const workOrder = workOrderResult.rows[0];

      // Fetch findings with actions and spare parts
      const findingsResult = await client.query(`
        SELECT 
          f.*,
          json_agg(
            json_build_object(
              'id', a.id,
              'description', a.description,
              'action_date', a.action_date,
              'start_time', a.start_time,
              'end_time', a.end_time,
              'spare_parts', (
                SELECT json_agg(
                  json_build_object(
                    'id', sp.id,
                    'part_name', sp.part_name,
                    'part_number', sp.part_number,
                    'quantity', sp.quantity
                  )
                )
                FROM spare_parts sp
                WHERE sp.action_id = a.id
              )
            )
          ) as actions
        FROM findings f
        LEFT JOIN actions a ON f.id = a.finding_id
        WHERE f.work_order_id = $1
        GROUP BY f.id
        ORDER BY f.id
      `, [workOrderId]);

      // Fetch per-action technicians for this work order
      const techniciansResult = await client.query(`
        SELECT at.name, at.staff_id, a.id as action_id
        FROM action_technicians at
        JOIN actions a ON a.id = at.action_id
        JOIN findings f ON f.id = a.finding_id
        WHERE f.work_order_id = $1
        ORDER BY at.name, at.staff_id
      `, [workOrderId]);

      // Load template using ExcelHelper
      const templatePath = path.join(process.cwd(), 'public', 'template_file.xlsx');
      const excelHelper = await ExcelHelper.loadTemplate(templatePath, 'Template Sheet');

      // Fill in work order details
      excelHelper.setCellValue('E1', workOrder.work_order_no);
      excelHelper.setCellValue('E2', formatDate(workOrder.work_order_date));
      excelHelper.setCellValue('E3', workOrder.equipment_number);
      excelHelper.setCellValue('E4', workOrder.km_hrs || 'N/A');
      excelHelper.setCellValue('E5', workOrder.work_type);
      excelHelper.setCellValue('C12', `Job Requested By: ${workOrder.requested_by}`);
      excelHelper.setCellValue('A12', `Job Allocated By: ${workOrder.first_name} ${workOrder.last_name}`);

      // Fill in findings (starting from row 8, max 3)
      const findings = findingsResult.rows.filter(finding => finding && finding.description && finding.description.trim() !== '');
      let currentRow = 8;
      let findingsExceededLimit = false;
      let findingsEndRow = 7; // Start after header
      
      // Track the first data row for findings (this will be our template for copying)
      const firstFindingDataRow = 8;
      
      // Fill in first 3 findings in template rows
      for (let i = 0; i < Math.min(findings.length, 3); i++) {
        const finding = findings[i];
        excelHelper.setCellValue(`A${currentRow}`, i + 1);
        excelHelper.setCellValue(`B${currentRow}`, finding.description);
        
        // Merge cells B, C, D, E for findings
        excelHelper.safeMergeCells(`B${currentRow}:E${currentRow}`);
        currentRow++;
      }
      
      // Update findings end row
      findingsEndRow = currentRow - 1;

      // If more than 3 findings, add rows dynamically and fill them
      if (findings.length > 3) {
        findingsExceededLimit = true;
        for (let i = 3; i < findings.length; i++) {
          // Copy from the first finding data row (row 8) and insert above current row
          const newRowNumber = excelHelper.copyRowAndInsertAbove(firstFindingDataRow, currentRow, ['A', 'B', 'C', 'D', 'E']);
          
          // Fill in the finding data for the newly inserted row
          excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
          excelHelper.setCellValue(`B${newRowNumber}`, findings[i].description);
          
          // Merge cells B, C, D, E for findings
          excelHelper.safeMergeCells(`B${newRowNumber}:E${newRowNumber}`);
          
          // Move to next row for next iteration
          currentRow = newRowNumber + 1;
        }
        
        // Update findings end row after dynamic insertion
        findingsEndRow = currentRow - 1;
      }

      // Fill in actions (only if actions exist)
      let actionRow = 15; // Default to static position
      let actionsExceededLimit = false;
      
      // First, collect all actions from all findings (filter out blank/empty actions)
      const allActions: Array<{ id: number; description: string; action_date: string; start_time: string; end_time: string; }> = [];
      for (const finding of findings) {
        if (finding.actions && Array.isArray(finding.actions)) {
          for (const action of finding.actions) {
            if (action && action.id && action.description && action.description.trim() !== '') {
              allActions.push(action);
            }
          }
        }
      }
      
      // Only fill in actions if there are any
      const actionIdToSymbolNumber = new Map<number, number>();
      if (allActions.length > 0) {
        // Determine action starting row based ONLY on findings status
        if (findings.length <= 3) {
          // Standard case: findings ≤3 - use static positioning
          actionRow = 15;
        } else {
          // Dynamic case: findings >3
          actionRow = findingsEndRow + 4; // 4 rows after the last finding row
        }
        
        // Track the first action data row for copying (BEFORE the loop increments actionRow)
        const firstActionDataRow = actionRow;
        
        // Build map from action id to its symbol number (row index) for later technician aggregation

        // Fill in actions (max 3 initially, then add more rows if needed)
        for (let i = 0; i < Math.min(allActions.length, 3); i++) {
          const action = allActions[i];
          excelHelper.setCellValue(`A${actionRow}`, i + 1);
          actionIdToSymbolNumber.set(action.id, i + 1);
          excelHelper.setCellValue(`B${actionRow}`, action.description);
          excelHelper.setCellValue(`C${actionRow}`, formatTime(action.start_time));
          excelHelper.setCellValue(`D${actionRow}`, formatTime(action.end_time));
          excelHelper.setCellValue(`E${actionRow}`, formatDate(action.action_date));
          
          actionRow++;
        }
        


        // If more than 3 actions, add rows dynamically and fill them
        if (allActions.length > 3) {
          actionsExceededLimit = true;
          for (let i = 3; i < allActions.length; i++) {
            // Copy from the first action data row and insert above current action row
            const newRowNumber = excelHelper.copyRowAndInsertAbove(firstActionDataRow, actionRow, ['A', 'B', 'C', 'D', 'E']);
            
            // Fill in the action data for the newly inserted row
            const action = allActions[i];
            excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
            actionIdToSymbolNumber.set(action.id, i + 1);
            excelHelper.setCellValue(`B${newRowNumber}`, action.description);
            excelHelper.setCellValue(`C${newRowNumber}`, formatTime(action.start_time));
            excelHelper.setCellValue(`D${newRowNumber}`, formatTime(action.end_time));
            excelHelper.setCellValue(`E${newRowNumber}`, formatDate(action.action_date));
            
            // Move to next row for next iteration
            actionRow = newRowNumber + 1;
          }
          

        }
      }

      // Fill in spare parts (only if spare parts exist)
      let sparePartRow = 20; // Default to static position
      let sparePartsExceededLimit = false;
      
             // First, collect all spare parts from all actions (filter out blank/empty spare parts)
       const allSpareParts = [];
       for (const finding of findings) {
         if (finding.actions && Array.isArray(finding.actions)) {
           for (const action of finding.actions) {
             if (action && action.id && action.spare_parts && Array.isArray(action.spare_parts)) {
               for (const sparePart of action.spare_parts) {
                 if (sparePart && sparePart.id && sparePart.part_name && sparePart.part_name.trim() !== '') {
                   allSpareParts.push(sparePart);
                 }
               }
             }
           }
         }
       }
      
      // Only fill in spare parts if there are any
      if (allSpareParts.length > 0) {
                 // Determine spare part starting row based on findings and actions status
         if (!findingsExceededLimit && !actionsExceededLimit && allSpareParts.length <= 4) {
           // Standard case: everything within limits - use static positioning
           sparePartRow = 20;
         } else {
           // Dynamic case: either findings >3, actions >3, or spare parts >4
           // Calculate: 20 + extra findings rows + extra actions rows
           const extraFindingsRows = findings.length > 3 ? findings.length - 3 : 0;
           const extraActionsRows = allActions.length > 3 ? allActions.length - 3 : 0;
           sparePartRow = 20 + extraFindingsRows + extraActionsRows;
         }
        
                 // Track the first spare part data row for copying (BEFORE the loop increments sparePartRow)
         const firstSparePartDataRow = sparePartRow;
        
        // Fill in spare parts (max 4 initially, then add more rows if needed)
        for (let i = 0; i < Math.min(allSpareParts.length, 4); i++) {
          const sparePart = allSpareParts[i];
          excelHelper.setCellValue(`A${sparePartRow}`, i + 1);
          excelHelper.setCellValue(`B${sparePartRow}`, sparePart.part_name);
          excelHelper.setCellValue(`C${sparePartRow}`, sparePart.part_number);
                     excelHelper.setCellValue(`D${sparePartRow}`, sparePart.quantity);
           
           sparePartRow++;
         }
         


        // If more than 4 spare parts, add rows dynamically and fill them
        if (allSpareParts.length > 4) {
          sparePartsExceededLimit = true;
          for (let i = 4; i < allSpareParts.length; i++) {
            // Copy from the first spare part data row and insert above current spare part row
            const newRowNumber = excelHelper.copyRowAndInsertAbove(firstSparePartDataRow, sparePartRow, ['A', 'B', 'C', 'D', 'E']);
            
            // Fill in the spare part data for the newly inserted row
            const sparePart = allSpareParts[i];
            excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
            excelHelper.setCellValue(`B${newRowNumber}`, sparePart.part_name);
            excelHelper.setCellValue(`C${newRowNumber}`, sparePart.part_number);
            excelHelper.setCellValue(`D${newRowNumber}`, sparePart.quantity);
            
                         // Move to next row for next iteration
             sparePartRow = newRowNumber + 1;
           }
           

         }
       }

      // Fill in technicians (starting dynamically after spare parts)
      let technicianRow = 26; // Default to static position
      const perActionTechRows = techniciansResult.rows as Array<{ name: string; staff_id: string; action_id: number }>; 
      // Aggregate unique technicians and collect action symbol numbers they participated in
      const techKeyToData = new Map<string, { name: string; staff_id: string; symbols: number[] }>();
      for (const row of perActionTechRows) {
        if (!row || !row.name || row.name.trim() === '') continue;
        const key = `${row.staff_id}||${row.name.trim()}`;
        const symbol = actionIdToSymbolNumber.get(row.action_id);
        if (symbol === undefined) continue;
        if (!techKeyToData.has(key)) {
          techKeyToData.set(key, { name: row.name.trim(), staff_id: row.staff_id, symbols: [symbol] });
        } else {
          const entry = techKeyToData.get(key)!;
          if (!entry.symbols.includes(symbol)) entry.symbols.push(symbol);
        }
      }
      // Create final technicians array with sorted unique symbols
      const technicians = Array.from(techKeyToData.values()).map(t => ({
        name: t.name,
        staff_id: t.staff_id,
        symbolsCsv: t.symbols.sort((a, b) => a - b).join(',')
      }));
      
      // Determine technician starting row based on all previous sections status
      if (!findingsExceededLimit && !actionsExceededLimit && !sparePartsExceededLimit && technicians.length <= 3) {
        // Standard case: everything within limits - use static positioning
        technicianRow = 26;
      } else {
        // Dynamic case: any section exceeded limits
        // Calculate: 26 + extra findings rows + extra actions rows + extra spare parts rows
        const extraFindingsRows = findings.length > 3 ? findings.length - 3 : 0;
        const extraActionsRows = allActions.length > 3 ? allActions.length - 3 : 0;
        const extraSparePartsRows = allSpareParts.length > 4 ? allSpareParts.length - 4 : 0;
        technicianRow = 26 + extraFindingsRows + extraActionsRows + extraSparePartsRows;
      }
      
                 // Track the first technician data row for copying (BEFORE the loop increments technicianRow)
         const firstTechnicianDataRow = technicianRow;
        
        // Fill in technicians (max 3 initially, then add more rows if needed)
        for (let i = 0; i < Math.min(technicians.length, 3); i++) {
          const technician = technicians[i];
          excelHelper.setCellValue(`A${technicianRow}`, i + 1);
          excelHelper.setCellValue(`B${technicianRow}`, technician.name);
          // In place of designation, put comma-separated action symbols
          excelHelper.setCellValue(`C${technicianRow}`, technician.symbolsCsv);
          excelHelper.setCellValue(`D${technicianRow}`, technician.staff_id);
           
           technicianRow++;
         }
         


      // If more than 3 technicians, add rows dynamically and fill them
      if (technicians.length > 3) {
        for (let i = 3; i < technicians.length; i++) {
          // Copy from the first technician data row and insert above current technician row
          const newRowNumber = excelHelper.copyRowAndInsertAbove(firstTechnicianDataRow, technicianRow, ['A', 'B', 'C', 'D', 'E']);
          
          // Fill in the technician data for the newly inserted row
          const technician = technicians[i];
          excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
          excelHelper.setCellValue(`B${newRowNumber}`, technician.name);
          excelHelper.setCellValue(`C${newRowNumber}`, technician.symbolsCsv);
          excelHelper.setCellValue(`D${newRowNumber}`, technician.staff_id);
          
                     // Move to next row for next iteration
           technicianRow = newRowNumber + 1;
         }
         

       }

      // Generate the Excel buffer
      const buffer = await excelHelper.getBuffer();

      // Return the Excel file as a blob response
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="WorkOrderReport_${workOrder.work_order_no}_${Date.now()}.xlsx"`
        }
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error generating work order report:', error);
    return NextResponse.json<ApiResponse<null>>({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}
