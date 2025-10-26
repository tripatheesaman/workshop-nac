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

      // Fill in work order details according to new template specifications
      excelHelper.setCellValue('G1', workOrder.work_order_no);
      excelHelper.setCellValue('G2', formatDate(workOrder.work_order_date));
      excelHelper.setCellValue('G3', workOrder.equipment_number);
      excelHelper.setCellValue('G4', workOrder.km_hrs || 'N/A');
      excelHelper.setCellValue('G5', workOrder.requested_by || `${workOrder.first_name} ${workOrder.last_name}`);
      excelHelper.setCellValue('G6', workOrder.work_type);
      excelHelper.setCellValue('G7', workOrder.work_completed_date ? formatDate(workOrder.work_completed_date) : '');
      excelHelper.setCellValue('G8', workOrder.job_allocation_time ? formatTime(workOrder.job_allocation_time) : '');

      // Fill in findings (starting from row B12, max 5)
      const findings = findingsResult.rows.filter(finding => finding && finding.description && finding.description.trim() !== '');
      let currentRow = 12;
      let findingsEndRow = 11; // Start after header
      
      // Track the first data row for findings (this will be our template for copying)
      const firstFindingDataRow = 12;
      
      // Fill in first 5 findings in template rows
      for (let i = 0; i < Math.min(findings.length, 5); i++) {
        const finding = findings[i];
        excelHelper.setCellValue(`A${currentRow}`, i + 1);
        excelHelper.setCellValue(`B${currentRow}`, finding.description);
        
        // Merge cells B to G for findings
        excelHelper.forceMergeCells(`B${currentRow}:G${currentRow}`);
        
        // Apply border to G cell
        excelHelper.applyBorder(`G${currentRow}`, {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        });
        
        currentRow++;
      }
      
      // Update findings end row
      findingsEndRow = currentRow - 1;

      // If more than 5 findings, add rows dynamically and fill them
      if (findings.length > 5) {
        for (let i = 5; i < findings.length; i++) {
          // Insert new row with formatting from the first finding data row (row 12)
          const newRowNumber = excelHelper.insertRowWithFormatting(firstFindingDataRow, currentRow, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
          
          // Fill in the finding data for the newly inserted row
          excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
          excelHelper.setCellValue(`B${newRowNumber}`, findings[i].description);
          
          // Merge cells B to G for findings
          excelHelper.forceMergeCells(`B${newRowNumber}:G${newRowNumber}`);
          
          // Move to next row for next iteration
          currentRow = newRowNumber + 1;
        }
        
        // Reapply merges to all findings rows (template + dynamic)
        for (let i = 0; i < findings.length; i++) {
          const rowNum = firstFindingDataRow + i;
          excelHelper.forceMergeCells(`B${rowNum}:G${rowNum}`);
        }
        
        // Reapply borders to all G cells in findings
        const findingsGAddresses = [];
        for (let i = 0; i < findings.length; i++) {
          findingsGAddresses.push(`G${firstFindingDataRow + i}`);
        }
        excelHelper.applyBorderToCells(findingsGAddresses, {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        });
        
        // Update findings end row after dynamic insertion
        findingsEndRow = currentRow - 1;
      }

      // Fill in actions (starting from row 21 if findings <= 5, else 5 rows after last finding)
      let actionRow = 21; // Default static position
      let actionsEndRow = 29; // Default end row for actions section
      
      // First, collect all actions from all findings (filter out blank/empty actions)
      const allActions = [];
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
        // Determine action starting row based on findings status
        if (findings.length <= 5) {
          // Standard case: findings ≤5 - use static positioning
          actionRow = 21;
        } else {
          // Dynamic case: findings >5 - start 5 rows after last finding
          actionRow = findingsEndRow + 5;
        }
        
        // Track the first action data row for copying (BEFORE the loop increments actionRow)
        const firstActionDataRow = actionRow;
        
        // Fill in actions (max 9 initially, then add more rows if needed)
        for (let i = 0; i < Math.min(allActions.length, 9); i++) {
          const action = allActions[i];
          excelHelper.setCellValue(`A${actionRow}`, i + 1);
          actionIdToSymbolNumber.set(action.id, i + 1);
          excelHelper.setCellValue(`B${actionRow}`, action.description);
          excelHelper.setCellValue(`E${actionRow}`, formatTime(action.start_time));
          excelHelper.setCellValue(`F${actionRow}`, formatTime(action.end_time));
          excelHelper.setCellValue(`G${actionRow}`, formatDate(action.action_date));
          
          // Merge cells B to D for actions
          excelHelper.forceMergeCells(`B${actionRow}:D${actionRow}`);
          
          // Apply border to G cell
          excelHelper.applyBorder(`G${actionRow}`, {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          });
          
          actionRow++;
        }

        // If more than 9 actions, add rows dynamically and fill them
        if (allActions.length > 9) {
          for (let i = 9; i < allActions.length; i++) {
            // Insert new row with formatting from the first action data row
            const newRowNumber = excelHelper.insertRowWithFormatting(firstActionDataRow, actionRow, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
            
            // Fill in the action data for the newly inserted row
            const action = allActions[i];
            excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
            actionIdToSymbolNumber.set(action.id, i + 1);
            excelHelper.setCellValue(`B${newRowNumber}`, action.description);
            excelHelper.setCellValue(`E${newRowNumber}`, formatTime(action.start_time));
            excelHelper.setCellValue(`F${newRowNumber}`, formatTime(action.end_time));
            excelHelper.setCellValue(`G${newRowNumber}`, formatDate(action.action_date));
            
            // Merge cells B to D for actions
            excelHelper.forceMergeCells(`B${newRowNumber}:D${newRowNumber}`);
            
            // Apply border to G cell
            excelHelper.applyBorder(`G${newRowNumber}`, {
              top: { style: 'thin', color: { argb: 'FF000000' } },
              bottom: { style: 'thin', color: { argb: 'FF000000' } },
              left: { style: 'thin', color: { argb: 'FF000000' } },
              right: { style: 'thin', color: { argb: 'FF000000' } }
            });
            
            // Move to next row for next iteration
            actionRow = newRowNumber + 1;
          }
          
          // Reapply merges to all actions rows (template + dynamic)
          for (let i = 0; i < allActions.length; i++) {
            const rowNum = firstActionDataRow + i;
            excelHelper.forceMergeCells(`B${rowNum}:D${rowNum}`);
          }
        }
        
        // Update the end of actions section
        actionsEndRow = actionRow - 1;
      }

      // Fill in spare parts (starting from row 33 if no new rows, else 4 rows after last action)
      let sparePartRow = 33; // Default static position
      let sparePartsEndRow = 36; // Default end row for spare parts section
      
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
        // Determine spare part starting row based on actual end positions
        if (findings.length <= 5 && allActions.length <= 9) {
          // Standard case: no new rows inserted - use static positioning
          sparePartRow = 33;
        } else {
          // Dynamic case: new rows were inserted - start 4 rows after last action
          sparePartRow = actionsEndRow + 4;
        }
        
        // Track the first spare part data row for copying (BEFORE the loop increments sparePartRow)
        const firstSparePartDataRow = sparePartRow;
        
        // Fill in spare parts (max 4 initially, then add more rows if needed)
        for (let i = 0; i < Math.min(allSpareParts.length, 4); i++) {
          const sparePart = allSpareParts[i];
          excelHelper.setCellValue(`A${sparePartRow}`, i + 1);
          excelHelper.setCellValue(`B${sparePartRow}`, sparePart.part_name);
          excelHelper.setCellValue(`E${sparePartRow}`, sparePart.part_number);
          excelHelper.setCellValue(`F${sparePartRow}`, sparePart.quantity);
          
          // Merge cells B to D for spare parts
          excelHelper.forceMergeCells(`B${sparePartRow}:D${sparePartRow}`);
          
          // Apply border to G cell
          excelHelper.applyBorder(`G${sparePartRow}`, {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          });
          
          sparePartRow++;
        }

        // If more than 4 spare parts, add rows dynamically and fill them
        if (allSpareParts.length > 4) {
          for (let i = 4; i < allSpareParts.length; i++) {
            // Insert new row with formatting from the first spare part data row
            const newRowNumber = excelHelper.insertRowWithFormatting(firstSparePartDataRow, sparePartRow, ['A', 'B', 'C', 'D', 'E', 'F']);
            
            // Fill in the spare part data for the newly inserted row
            const sparePart = allSpareParts[i];
            excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
            excelHelper.setCellValue(`B${newRowNumber}`, sparePart.part_name);
            excelHelper.setCellValue(`E${newRowNumber}`, sparePart.part_number);
            excelHelper.setCellValue(`F${newRowNumber}`, sparePart.quantity);
            
            // Merge cells B to D for spare parts
            excelHelper.forceMergeCells(`B${newRowNumber}:D${newRowNumber}`);
            
            // Move to next row for next iteration
            sparePartRow = newRowNumber + 1;
          }
          
          // Reapply merges to all spare parts rows (template + dynamic)
          for (let i = 0; i < allSpareParts.length; i++) {
            const rowNum = firstSparePartDataRow + i;
            excelHelper.forceMergeCells(`B${rowNum}:D${rowNum}`);
          }
          
          // Reapply borders to all G cells in spare parts
          const sparePartsGAddresses = [];
          for (let i = 0; i < allSpareParts.length; i++) {
            sparePartsGAddresses.push(`G${firstSparePartDataRow + i}`);
          }
          excelHelper.applyBorderToCells(sparePartsGAddresses, {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          });
        }
        
        // Update the end of spare parts section
        sparePartsEndRow = sparePartRow - 1;
      }

      // Fill in technicians (starting from row 40 if no new rows, else 4 rows after last spare part)
      let technicianRow = 40; // Default static position
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
      
      // Determine technician starting row based on actual end positions
      if (findings.length <= 5 && allActions.length <= 9 && allSpareParts.length <= 4) {
        // Standard case: no new rows inserted - use static positioning
        technicianRow = 40;
      } else {
        // Dynamic case: new rows were inserted - start 4 rows after last spare part
        technicianRow = sparePartsEndRow + 4;
      }
      
      // Track the first technician data row for copying (BEFORE the loop increments technicianRow)
      const firstTechnicianDataRow = technicianRow;
      
      // Fill in technicians (max 4 initially, then add more rows if needed)
      // Only process if there are technicians
      if (technicians.length > 0) {
        for (let i = 0; i < Math.min(technicians.length, 4); i++) {
        const technician = technicians[i];
        excelHelper.setCellValue(`A${technicianRow}`, i + 1);
        excelHelper.setCellValue(`B${technicianRow}`, technician.name);
        // In place of designation, put comma-separated action symbols
        excelHelper.setCellValue(`E${technicianRow}`, technician.symbolsCsv);
        excelHelper.setCellValue(`F${technicianRow}`, technician.staff_id);
        
        // Merge cells B to D for technicians
        excelHelper.forceMergeCells(`B${technicianRow}:D${technicianRow}`);
        
        // Apply border to G cell
        excelHelper.applyBorder(`G${technicianRow}`, {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        });
        
        technicianRow++;
        }
      }

      // If more than 4 technicians, add rows dynamically and fill them
      if (technicians.length > 4) {
        for (let i = 4; i < technicians.length; i++) {
          // Insert new row with formatting from the first technician data row
          const newRowNumber = excelHelper.insertRowWithFormatting(firstTechnicianDataRow, technicianRow, ['A', 'B', 'C', 'D', 'E', 'F']);
          
          // Fill in the technician data for the newly inserted row
          const technician = technicians[i];
          excelHelper.setCellValue(`A${newRowNumber}`, i + 1);
          excelHelper.setCellValue(`B${newRowNumber}`, technician.name);
          excelHelper.setCellValue(`E${newRowNumber}`, technician.symbolsCsv);
          excelHelper.setCellValue(`F${newRowNumber}`, technician.staff_id);
          
          // Merge cells B to D for technicians
          excelHelper.forceMergeCells(`B${newRowNumber}:D${newRowNumber}`);
          
          // Apply border to G cell
          excelHelper.applyBorder(`G${newRowNumber}`, {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          });
          
          // Move to next row for next iteration
          technicianRow = newRowNumber + 1;
        }
      }

      // Generate the Excel buffer
      const buffer = await excelHelper.getBuffer();

      // Return the Excel file as a blob response
      return new NextResponse(buffer as BodyInit, {
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