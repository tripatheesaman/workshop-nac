'use client';

import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { useAuth } from '../../components/AuthProvider';
import { useToast } from '../../components/ToastContext';

export default function JobAllocationReportPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateReport = async () => {
    if (!fromDate || !toDate) {
      toast.showError('Please select both from and to dates');
      return;
    }

    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);

    if (fromDateObj > toDateObj) {
      toast.showError('From date cannot be after to date');
      return;
    }

    setIsGenerating(true);

    try {
      // Get token for authentication
      const token = localStorage.getItem('token');
      if (!token) {
        toast.showError('No authentication token found. Please log in again.');
        return;
      }

      // Use fetch directly for file downloads
      const response = await fetch(`/api/reports/job-allocation-report?fromDate=${fromDate}&toDate=${toDate}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          toast.showError('Unauthorized. Please log in again.');
          return;
        }
        if (response.status === 403) {
          toast.showError('Access denied. Only administrators can generate reports.');
          return;
        }
        if (response.status === 404) {
          toast.showError('No actions found for the selected date range.');
          return;
        }
        throw new Error('Failed to generate report');
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `JobAllocationReport_${fromDate}_to_${toDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.showSuccess('Job allocation report generated successfully');
    } catch (error) {
      console.error('Error generating job allocation report:', error);
      toast.showError('Error generating job allocation report');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
          <p className="text-gray-600">Please log in to access this page.</p>
        </div>
      </div>
    );
  }

  // Check if user has admin or superadmin role
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
          <p className="text-gray-600">Only administrators can access job allocation reports.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Daily Job Allocation Report</h1>
          <p className="mt-2 text-gray-600">
            Generate a daily job allocation report showing all actions performed within a date range.
          </p>
        </div>

        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Report Parameters</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Input
                  label="From Date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
              </div>
              
              <div>
                <Input
                  label="To Date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mt-6">
              <Button
                onClick={handleGenerateReport}
                disabled={isGenerating || !fromDate || !toDate}
                className="w-full md:w-auto"
              >
                {isGenerating ? 'Generating Report...' : 'Generate Job Allocation Report'}
              </Button>
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h3 className="text-sm font-medium text-blue-900 mb-2">Report Includes:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Equipment Number</li>
                <li>• Job Order Number</li>
                <li>• Work Type (E=Electrical, M=Mechanical, P=Painting, H=Hydraulics, SC=Schedule Check, MI=Miscellaneous)</li>
                <li>• Start Time and End Time</li>
                <li>• Duration (HH:MM format)</li>
                <li>• Kilometers/Hours</li>
                <li>• Spare Parts Used (Part Numbers and Quantities)</li>
                <li>• Completion Status (✓ if completed on that date)</li>
                <li>• Technician Initials</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

