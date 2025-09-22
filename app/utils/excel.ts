import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

export interface ExcelCellStyle {
  font?: Partial<ExcelJS.Font>;
  fill?: Partial<ExcelJS.Fill>;
  border?: Partial<ExcelJS.Borders>;
  alignment?: Partial<ExcelJS.Alignment>;
}

export class ExcelHelper {
  private workbook: ExcelJS.Workbook;
  private worksheet: ExcelJS.Worksheet;

  constructor(templatePath: string, sheetName: string) {
    this.workbook = new ExcelJS.Workbook();
    this.worksheet = this.workbook.getWorksheet(sheetName) || this.workbook.addWorksheet(sheetName);
  }

  static async loadTemplate(templatePath: string, sheetName: string): Promise<ExcelHelper> {
    const helper = new ExcelHelper(templatePath, sheetName);
    await helper.workbook.xlsx.readFile(templatePath);
    helper.worksheet = helper.workbook.getWorksheet(sheetName) || helper.workbook.addWorksheet(sheetName);
    return helper;
  }

  getWorksheet(): ExcelJS.Worksheet {
    return this.worksheet;
  }

  setCellValue(cellAddress: string, value: ExcelJS.CellValue): void {
    this.worksheet.getCell(cellAddress).value = value;
  }

  mergeCells(range: string): void {
    this.worksheet.mergeCells(range);
  }

  safeMergeCells(range: string): void {
    try {
      // Check if the range is already merged
      const [startCell, endCell] = range.split(':');
      const startCellObj = this.worksheet.getCell(startCell);
      const endCellObj = this.worksheet.getCell(endCell);
      
      // If either cell is already part of a merge, don't merge again
      if (startCellObj.master || endCellObj.master) {
        return;
      }
      
      this.worksheet.mergeCells(range);
    } catch (error) {
      // If merging fails, just continue without merging
      console.warn(`Could not merge cells ${range}:`, error);
    }
  }

  insertRowAfter(rowNumber: number): number {
    this.worksheet.insertRow(rowNumber + 1, rowNumber + 1);
    return rowNumber + 1;
  }

  copyRowAndInsertAbove(sourceRow: number, insertAboveRow: number, columns: string[]): number {
    // Insert a new row above the specified row
    this.worksheet.insertRow(insertAboveRow, insertAboveRow);
    
    // Copy the entire row structure from source to the new row
    const sourceRowObj = this.worksheet.getRow(sourceRow);
    const newRowObj = this.worksheet.getRow(insertAboveRow);
    
    // Copy row height
    if (sourceRowObj.height) {
      newRowObj.height = sourceRowObj.height;
    }
    
    // Copy all cells in the specified columns
    columns.forEach(col => {
      const sourceCell = this.worksheet.getCell(`${col}${sourceRow}`);
      const newCell = this.worksheet.getCell(`${col}${insertAboveRow}`);
      
      // Copy cell value
      newCell.value = sourceCell.value;
      
      // Copy cell style completely
      if (sourceCell.style) {
        newCell.style = JSON.parse(JSON.stringify(sourceCell.style));
      }
      
      // Copy borders
      if (sourceCell.border) {
        newCell.border = JSON.parse(JSON.stringify(sourceCell.border));
      }
      
      // Copy fill
      if (sourceCell.fill) {
        newCell.fill = JSON.parse(JSON.stringify(sourceCell.fill));
      }
      
      // Copy font
      if (sourceCell.font) {
        newCell.font = JSON.parse(JSON.stringify(sourceCell.font));
      }
      
      // Copy alignment
      if (sourceCell.alignment) {
        newCell.alignment = JSON.parse(JSON.stringify(sourceCell.alignment));
      }
      
      // Copy number format
      if (sourceCell.numFmt) {
        newCell.numFmt = sourceCell.numFmt;
      }
      
      // Copy protection
      if (sourceCell.protection) {
        newCell.protection = JSON.parse(JSON.stringify(sourceCell.protection));
      }
    });
    
    // Handle merged cells for the source row
    // Get all merged ranges that include the source row
    const mergedRanges = this.worksheet.model.merges || [];
    
    mergedRanges.forEach(mergeRange => {
      const [startCell, endCell] = mergeRange.split(':');
      const startRow = parseInt(startCell.replace(/\D/g, ''));
      const endRow = parseInt(endCell.replace(/\D/g, ''));
      
      // Check if this merge range includes the source row
      if (startRow <= sourceRow && sourceRow <= endRow) {
        // Calculate the new merge range for the inserted row
        const newStartRow = startRow === sourceRow ? insertAboveRow : startRow;
        const newEndRow = endRow === sourceRow ? insertAboveRow : endRow;
        
        // Create new merge range
        const startCol = startCell.replace(/\d/g, '');
        const endCol = endCell.replace(/\d/g, '');
        const newMergeRange = `${startCol}${newStartRow}:${endCol}${newEndRow}`;
        
        try {
          // Apply the merge to the new row
          this.worksheet.mergeCells(newMergeRange);
          
          // Copy border formatting from the source merged range to the new merged range
          const sourceStartCell = this.worksheet.getCell(startCell);
          
          // Copy borders from the source merged range
          if (sourceStartCell.border) {
            // Apply borders to all cells in the new merged range
            for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
              const colLetter = String.fromCharCode(col);
              const newCell = this.worksheet.getCell(`${colLetter}${newStartRow}`);
              
              // Create a clean border object for the new merged cell
              const newBorder: Partial<ExcelJS.Borders> = {};
              
              // Always apply top and bottom borders to all cells in the merged range
              if (sourceStartCell.border.top) {
                newBorder.top = JSON.parse(JSON.stringify(sourceStartCell.border.top));
              }
              if (sourceStartCell.border.bottom) {
                newBorder.bottom = JSON.parse(JSON.stringify(sourceStartCell.border.bottom));
              }
              
              // Apply left border only to the leftmost cell
              if (col === startCol.charCodeAt(0) && sourceStartCell.border.left) {
                newBorder.left = JSON.parse(JSON.stringify(sourceStartCell.border.left));
              }
              
              // Apply right border only to the rightmost cell - THIS IS THE KEY FIX
              if (col === endCol.charCodeAt(0)) {
                // Always apply right border to rightmost cell, even if source doesn't have it
                // This ensures the merged cell has a proper right border
                if (sourceStartCell.border.right) {
                  newBorder.right = JSON.parse(JSON.stringify(sourceStartCell.border.right));
                } else {
                  // If source doesn't have right border, create a default one
                  newBorder.right = { style: 'thin', color: { argb: 'FF000000' } };
                }
              }
              
              // Apply the clean border
              newCell.border = newBorder;
            }
          }
        } catch (error) {
          console.warn(`Could not merge cells ${newMergeRange}:`, error);
        }
      }
    });
    
    return insertAboveRow;
  }

  copyRowFormatting(sourceRow: number, targetRow: number, columns: string[]): void {
    columns.forEach(col => {
      const sourceCell = this.worksheet.getCell(`${col}${sourceRow}`);
      const targetCell = this.worksheet.getCell(`${col}${targetRow}`);
      
      if (sourceCell.style) {
        targetCell.style = { ...sourceCell.style };
      }
      if (sourceCell.border) {
        targetCell.border = { ...sourceCell.border };
      }
      if (sourceCell.fill) {
        targetCell.fill = { ...sourceCell.fill };
      }
      if (sourceCell.font) {
        targetCell.font = { ...sourceCell.font };
      }
      if (sourceCell.alignment) {
        targetCell.alignment = { ...sourceCell.alignment };
      }
    });
  }

  copyRowStructure(sourceRow: number, targetRow: number, columns: string[]): void {
    // Copy cell styles and formatting
    this.copyRowFormatting(sourceRow, targetRow, columns);
    
    // Copy row height
    const sourceRowObj = this.worksheet.getRow(sourceRow);
    const targetRowObj = this.worksheet.getRow(targetRow);
    if (sourceRowObj.height) {
      targetRowObj.height = sourceRowObj.height;
    }
  }

  async saveToFile(outputPath: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    await this.workbook.xlsx.writeFile(outputPath);
  }

  getBuffer(): Promise<Buffer> {
    return this.workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }
}

export function formatTime(timeString: string): string {
  if (!timeString) return '';
  
  // If time is already in HH:MM format, return as is
  if (/^\d{2}:\d{2}$/.test(timeString)) {
    return timeString;
  }
  
  // If time is in HH:MM:SS format, extract HH:MM
  if (/^\d{2}:\d{2}:\d{2}$/.test(timeString)) {
    return timeString.substring(0, 5);
  }
  
  // If time is a timestamp or other format, try to parse
  try {
    const date = new Date(timeString);
    if (!isNaN(date.getTime())) {
      return date.toTimeString().substring(0, 5);
    }
  } catch {
    console.warn('Could not parse time:', timeString);
  }
  
  return timeString;
}

export function formatDate(dateString: string): string {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
  } catch {
    console.warn('Could not parse date:', dateString);
  }
  
  return dateString;
}
