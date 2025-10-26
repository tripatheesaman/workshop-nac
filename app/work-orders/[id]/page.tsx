'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '../../components/Button';
import { useAuth } from '../../components/AuthProvider';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { apiClient } from '../../utils/api';
import { useToast } from '../../components/ToastContext';
import { validateAction, validateSparePart, validateFinding, validateActionDate, validateCompletionDate } from '../../utils/validation';
import { WorkOrder, Finding, Action, SparePart, Technician, ActionTechnician, ActionDate } from '../../types';
import { ConfirmationModal } from '../../components/ConfirmationModal';

// Helper to normalize a timestamp or time string to HH:MM for <input type="time">
function toTimeHHMM(value: string): string {
  if (!value) return '';
  // Accept formats: 'HH:MM', 'YYYY-MM-DDTHH:MM:SS', or full ISO
  const timeMatch = value.match(/T(\d{2}:\d{2})/);
  if (timeMatch && timeMatch[1]) return timeMatch[1];
  const hhmmMatch = value.match(/^(\d{2}:\d{2})/);
  if (hhmmMatch && hhmmMatch[1]) return hhmmMatch[1];
  // Fallback: try split by space
  const parts = value.split(' ');
  if (parts.length > 1 && /\d{2}:\d{2}/.test(parts[1])) return parts[1].slice(0,5);
  return '';
}

interface WorkOrderDetail extends WorkOrder {
  status: 'pending' | 'ongoing' | 'completion_requested' | 'completed' | 'rejected';
  requested_by_id?: number;
  rejection_reason?: string;
  completion_approved_by_name?: string;
  completion_requested_by_name?: string;
  findings: FindingWithActions[];
}

interface FindingWithActions extends Finding {
  actions: ActionWithSpareParts[];
}

interface ActionWithSpareParts extends Action {
  spare_parts: SparePart[];
}

interface NewFinding {
  description: string;
  reference_image?: File;
}

interface NewAction {
  description: string;
  action_date: string;
  start_time: string;
  end_time?: string;
  is_completed?: boolean;
}

interface NewSparePart {
  part_name: string;
  part_number: string;
  quantity: number;
}

export default function WorkOrderDetailPage() {
  const { user } = useAuth();
  const [isEditingRejected, setIsEditingRejected] = useState(false);
  const params = useParams();
  const workOrderId = Number(params.id);
  
  const [workOrder, setWorkOrder] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editCore, setEditCore] = useState({
    equipment_number: '',
    work_type: '',
    work_type_other: '',
    requested_by: '',
    km_hrs: 0,
    work_order_date: '',
  });
  // Add new states for admin/superadmin editing
  const [isEditingWorkOrder, setIsEditingWorkOrder] = useState(false);
  const [isApprovingWorkOrder, setIsApprovingWorkOrder] = useState(false);
  
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [showAddFinding, setShowAddFinding] = useState(false);
  const [newFinding, setNewFinding] = useState<NewFinding>({ description: '' });
  const [selectedFindingForAction, setSelectedFindingForAction] = useState<number | null>(null);
  const [selectedActionForSparePart, setSelectedActionForSparePart] = useState<number | null>(null);
  const [editingFinding, setEditingFinding] = useState<number | null>(null);
  const [editingAction, setEditingAction] = useState<number | null>(null);
  const [editingSparePart, setEditingSparePart] = useState<number | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReferenceImageModal, setShowReferenceImageModal] = useState(false);
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [isUploadingReferenceImage, setIsUploadingReferenceImage] = useState(false);
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().split('T')[0]);
  const [showStartAgainModal, setShowStartAgainModal] = useState(false);
  const [selectedActionForStartAgain, setSelectedActionForStartAgain] = useState<number | null>(null);
  const [startAgainData, setStartAgainData] = useState({
    action_date: new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: '',
    technician_ids: [] as number[]
  });
  const [actionDates, setActionDates] = useState<{ [actionId: number]: ActionDate[] }>({});
  const [editingActionDate, setEditingActionDate] = useState<number | null>(null);
  const [editActionDateData, setEditActionDateData] = useState({
    action_date: '',
    start_time: '',
    end_time: '',
    is_completed: false,
    technician_ids: [] as number[]
  });
  const [newAction, setNewAction] = useState<NewAction>({
    description: '',
    action_date: new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: '',
    is_completed: false
  });
  const [newActionTechnicianIds, setNewActionTechnicianIds] = useState<number[]>([]);
  const [newSparePart, setNewSparePart] = useState<NewSparePart>({
    part_name: '',
    part_number: '',
    quantity: 1
  });
  const [editFinding, setEditFinding] = useState<NewFinding>({ description: '' });
  const [editAction, setEditAction] = useState<NewAction>({
    description: '',
    action_date: new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: ''
  });
  const [editSparePart, setEditSparePart] = useState<NewSparePart>({
    part_name: '',
    part_number: '',
    quantity: 1
  });

  // Confirmation modal states
  const [showDeleteFindingModal, setShowDeleteFindingModal] = useState(false);
  const [showDeleteActionModal, setShowDeleteActionModal] = useState(false);
  const [showDeleteSparePartModal, setShowDeleteSparePartModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; type: 'finding' | 'action' | 'sparePart' } | null>(null);

  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<Technician[]>('/technicians');
        if (res.success && res.data) setTechnicians(res.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchWorkOrderDetails = useCallback(async () => {
    try {
      const response = await apiClient.get<WorkOrderDetail>(`/work-orders/${workOrderId}`);
      
      if (response.success && response.data) {
        // Ensure arrays are always arrays, not null
        const workOrderWithArrays = {
          ...response.data,
          findings: response.data.findings || []
        };
        
        // Ensure each finding has actions array
        workOrderWithArrays.findings = workOrderWithArrays.findings.map(finding => ({
          ...finding,
          actions: finding.actions || []
        }));
        
        // Ensure each action has spare_parts array
        workOrderWithArrays.findings = workOrderWithArrays.findings.map(finding => ({
          ...finding,
          actions: finding.actions.map(action => ({
            ...action,
            spare_parts: action.spare_parts || []
          }))
        }));
        
        setWorkOrder(workOrderWithArrays);
        // Prime edit buffer
        setEditCore({
          equipment_number: workOrderWithArrays.equipment_number,
          work_type: workOrderWithArrays.work_type,
          work_type_other: '',
          requested_by: workOrderWithArrays.requested_by,
          km_hrs: workOrderWithArrays.km_hrs || 0,
          work_order_date: workOrderWithArrays.work_order_date,
        });
      }
    } catch (error) {
      console.error('Error fetching work order details:', error);
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);



  useEffect(() => {
    if (workOrderId) {
      fetchWorkOrderDetails();
    }
  }, [workOrderId, fetchWorkOrderDetails]);

  // Fetch action dates when work order changes
  useEffect(() => {
    if (workOrder && workOrder.findings) {
      workOrder.findings.forEach(finding => {
        if (finding.actions) {
          finding.actions.forEach(action => {
            fetchActionDates(action.id);
          });
        }
      });
    }
  }, [workOrder]);

  const handleAddFinding = async () => {
    try {
      const validation = validateFinding({ description: newFinding.description });
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      let referenceImagePath: string | undefined;

      // Handle image upload if provided
      if (newFinding.reference_image) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', newFinding.reference_image);

        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: uploadFormData,
        });

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          if (uploadResult.success) {
            referenceImagePath = uploadResult.data.path;
          } else {
            toast.showError('Error uploading image', uploadResult.error);
            return;
          }
        } else {
          toast.showError('Error uploading image');
          return;
        }
      }

      const response = await apiClient.post<Finding>('/findings', {
        work_order_id: workOrderId,
        description: newFinding.description,
        reference_image: referenceImagePath
      });
      
      if (response.success) {
        setNewFinding({ description: '' });
        setShowAddFinding(false);
        fetchWorkOrderDetails();
        toast.showSuccess('Finding added successfully');
      }
    } catch (error) {
      console.error('Error adding finding:', error);
      toast.showError('Error adding finding');
    }
  };

  const fetchActionDates = async (actionId: number) => {
    try {
      const response = await apiClient.get(`/actions/${actionId}/dates`);
      if (response.success && response.data) {
        setActionDates(prev => ({
          ...prev,
          [actionId]: response.data as ActionDate[]
        }));
      }
    } catch (error) {
      console.error('Error fetching action dates:', error);
    }
  };

  const handleStartAgain = async () => {
    if (!selectedActionForStartAgain) return;
    
    try {
      const response = await apiClient.post(`/actions/${selectedActionForStartAgain}/dates`, {
        action_date: startAgainData.action_date,
        start_time: startAgainData.start_time,
        end_time: startAgainData.end_time,
        is_completed: false
      });
      
      if (response.success) {
        // Assign selected technicians to this action
        if (startAgainData.technician_ids.length > 0) {
          for (const techId of startAgainData.technician_ids) {
            try {
              await apiClient.post(`/actions/${selectedActionForStartAgain}/technicians`, { technician_id: techId });
            } catch {}
          }
        }
        
        setShowStartAgainModal(false);
        setSelectedActionForStartAgain(null);
        setStartAgainData({
          action_date: new Date().toISOString().split('T')[0],
          start_time: '',
          end_time: '',
          technician_ids: []
        });
        fetchWorkOrderDetails();
        fetchActionDates(selectedActionForStartAgain);
        toast.showSuccess('Action date added successfully');
      }
    } catch (error) {
      console.error('Error adding action date:', error);
      toast.showError('Error adding action date');
    }
  };

  const handleEditActionDate = async () => {
    try {
      const response = await apiClient.put(`/actions/${editingActionDate}/dates`, {
        action_date: editActionDateData.action_date,
        is_completed: editActionDateData.is_completed
      });
      
      if (response.success) {
        setEditingActionDate(null);
        setEditActionDateData({
          action_date: '',
          start_time: '',
          end_time: '',
          is_completed: false,
          technician_ids: []
        });
        fetchWorkOrderDetails();
        toast.showSuccess('Action date updated successfully');
      }
    } catch (error) {
      console.error('Error updating action date:', error);
      toast.showError('Error updating action date');
    }
  };

  const handleDeleteActionDate = async (actionId: number, actionDateId: number) => {
    try {
      const response = await apiClient.delete(`/actions/${actionId}/dates/${actionDateId}`);
      if (response.success) {
        fetchActionDates(actionId);
        toast.showSuccess('Action date deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting action date:', error);
      toast.showError('Error deleting action date');
    }
  };

  const handleAddAction = async (findingId: number) => {
    try {
      const validation = validateAction(newAction);
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      if (!workOrder) {
        toast.showError('Error', 'Work order not found');
        return;
      }

      // Get all existing actions for this finding to find the latest action date
      const finding = workOrder.findings.find(f => f.id === findingId);
      const existingActions = finding?.actions || [];
      const latestActionDate = existingActions.length > 0 
        ? Math.max(...existingActions.map(a => new Date(a.action_date).getTime()))
        : null;
      
      const previousActionDate = latestActionDate 
        ? new Date(latestActionDate).toISOString().split('T')[0]
        : undefined;

      // Validate action date
      const dateValidation = validateActionDate(
        newAction.action_date,
        workOrder.work_order_date,
        previousActionDate
      );
      
      if (dateValidation) {
        toast.showError('Validation Error', dateValidation.message);
        return;
      }

      const response = await apiClient.post<Action>('/actions', {
        finding_id: findingId,
        description: newAction.description,
        action_date: newAction.action_date,
        start_time: newAction.start_time,
        end_time: newAction.end_time,
        is_completed: newAction.is_completed
      });
      
      if (response.success) {
        // Assign selected technicians to this new action
        const createdAction = response.data as unknown as Action;
        if (createdAction && Array.isArray(newActionTechnicianIds) && newActionTechnicianIds.length > 0) {
          for (const techId of newActionTechnicianIds) {
            try {
              await apiClient.post<ActionTechnician>(`/actions/${createdAction.id}/technicians`, { technician_id: techId });
            } catch {}
          }
        }
        setNewAction({
          description: '',
          action_date: new Date().toISOString().split('T')[0],
          start_time: '',
          end_time: '',
          is_completed: false
        });
        setNewActionTechnicianIds([]);
        setSelectedFindingForAction(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Action added successfully');
      }
    } catch (error) {
      console.error('Error adding action:', error);
      toast.showError('Error adding action');
    }
  };

  const handleAddSparePart = async (actionId: number) => {
    try {
      const validation = validateSparePart(newSparePart);
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      const response = await apiClient.post<SparePart>('/spare-parts', {
        action_id: actionId,
        part_name: newSparePart.part_name,
        part_number: newSparePart.part_number,
        quantity: newSparePart.quantity
      });
      
      if (response.success) {
        setNewSparePart({
          part_name: '',
          part_number: '',
          quantity: 1
        });
        setSelectedActionForSparePart(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Spare part added successfully');
      }
    } catch (error) {
      console.error('Error adding spare part:', error);
      toast.showError('Error adding spare part');
    }
  };

  // Removed legacy work-order-level technician handler

  // Resubmission handled inline with save in the action buttons

  const handleEditFinding = async (findingId: number) => {
    try {
      const validation = validateFinding({ description: editFinding.description });
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      const response = await apiClient.put<Finding>(`/findings/${findingId}`, {
        description: editFinding.description,
        reference_image: editFinding.reference_image
      });
      
      if (response.success) {
        setEditFinding({ description: '' });
        setEditingFinding(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Finding updated successfully');
      }
    } catch (error) {
      console.error('Error updating finding:', error);
      toast.showError('Error updating finding');
    }
  };

  const handleDeleteFinding = async (findingId: number) => {
    setItemToDelete({ id: findingId, type: 'finding' });
    setShowDeleteFindingModal(true);
  };

  const confirmDeleteFinding = async () => {
    if (!itemToDelete) return;
    
    try {
      const response = await apiClient.delete(`/findings/${itemToDelete.id}`);
      
      if (response.success) {
        fetchWorkOrderDetails();
        toast.showSuccess('Finding deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting finding:', error);
      toast.showError('Error deleting finding');
    } finally {
      setShowDeleteFindingModal(false);
      setItemToDelete(null);
    }
  };

  const handleEditAction = async (actionId: number) => {
    try {
      const validation = validateAction(editAction);
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      if (!workOrder) {
        toast.showError('Error', 'Work order not found');
        return;
      }

      // Find the current action and its finding
      let currentAction: Action | undefined;
      let finding: FindingWithActions | undefined;
      
      for (const f of workOrder.findings) {
        const action = f.actions.find(a => a.id === actionId);
        if (action) {
          currentAction = action;
          finding = f;
          break;
        }
      }

      if (!currentAction || !finding) {
        toast.showError('Error', 'Action not found');
        return;
      }

      // Get all actions for this finding except the current one
      const otherActions = finding.actions.filter(a => a.id !== actionId);
      
      // Find the latest action date before the current action
      const latestActionDate = otherActions.length > 0 
        ? Math.max(...otherActions.map(a => new Date(a.action_date).getTime()))
        : null;
      
      const previousActionDate = latestActionDate 
        ? new Date(latestActionDate).toISOString().split('T')[0]
        : undefined;

      // Validate action date
      const dateValidation = validateActionDate(
        editAction.action_date,
        workOrder.work_order_date,
        previousActionDate
      );
      
      if (dateValidation) {
        toast.showError('Validation Error', dateValidation.message);
        return;
      }

      const response = await apiClient.put<Action>(`/actions/${actionId}`, {
        description: editAction.description,
        action_date: editAction.action_date,
        start_time: editAction.start_time,
        end_time: editAction.end_time
      });
      
      if (response.success) {
        setEditAction({
          description: '',
          action_date: new Date().toISOString().split('T')[0],
          start_time: '',
          end_time: ''
        });
        setEditingAction(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Action updated successfully');
      }
    } catch (error) {
      console.error('Error updating action:', error);
      toast.showError('Error updating action');
    }
  };

  const handleDeleteAction = async (actionId: number) => {
    setItemToDelete({ id: actionId, type: 'action' });
    setShowDeleteActionModal(true);
  };

  const confirmDeleteAction = async () => {
    if (!itemToDelete) return;
    
    try {
      const response = await apiClient.delete(`/actions/${itemToDelete.id}`);
      
      if (response.success) {
        fetchWorkOrderDetails();
        toast.showSuccess('Action deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting action:', error);
      toast.showError('Error deleting action');
    } finally {
      setShowDeleteActionModal(false);
      setItemToDelete(null);
    }
  };

  const handleEditSparePart = async (sparePartId: number) => {
    try {
      const validation = validateSparePart(editSparePart);
      if (!validation.isValid) {
        toast.showError('Validation Error', validation.errors[0].message);
        return;
      }

      const response = await apiClient.put<SparePart>(`/spare-parts/${sparePartId}`, {
        part_name: editSparePart.part_name,
        part_number: editSparePart.part_number,
        quantity: editSparePart.quantity
      });
      
      if (response.success) {
        setEditSparePart({
          part_name: '',
          part_number: '',
          quantity: 1
        });
        setEditingSparePart(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Spare part updated successfully');
      }
    } catch (error) {
      console.error('Error updating spare part:', error);
      toast.showError('Error updating spare part');
    }
  };

  const handleDeleteSparePart = async (sparePartId: number) => {
    setItemToDelete({ id: sparePartId, type: 'sparePart' });
    setShowDeleteSparePartModal(true);
  };

  const confirmDeleteSparePart = async () => {
    if (!itemToDelete) return;
    
    try {
      const response = await apiClient.delete(`/spare-parts/${itemToDelete.id}`);
      
      if (response.success) {
        fetchWorkOrderDetails();
        toast.showSuccess('Spare part deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting spare part:', error);
      toast.showError('Error deleting spare part');
    } finally {
      setShowDeleteSparePartModal(false);
      setItemToDelete(null);
    }
  };

  const handleCompleteWork = async () => {
    setShowCompleteModal(true);
  };

  const handleCompleteWorkConfirm = async () => {
    if (!completionDate) {
      toast.showError('Validation Error', 'Please select a completion date');
      return;
    }

    if (!workOrder) {
      toast.showError('Error', 'Work order not found');
      return;
    }

    // Ensure all actions across findings have end_time filled; if any missing, show error and stop.
    const hasMissingEndTimes = workOrder.findings.some(f => (f.actions || []).some(a => !a.end_time));
    if (hasMissingEndTimes) {
      toast.showError('Validation Error', 'Please fill end times for all actions before requesting completion');
      return;
    }

    // Get the latest action date across all findings
    const allActions: Action[] = [];
    workOrder.findings.forEach(finding => {
      if (finding.actions) {
        allActions.push(...finding.actions);
      }
    });

    const latestActionDate = allActions.length > 0 
      ? Math.max(...allActions.map(a => new Date(a.action_date).getTime()))
      : null;
    
    const lastActionDate = latestActionDate 
      ? new Date(latestActionDate).toISOString().split('T')[0]
      : undefined;

    // Validate completion date
    const dateValidation = validateCompletionDate(
      completionDate,
      workOrder.work_order_date,
      lastActionDate
    );
    
    if (dateValidation) {
      toast.showError('Validation Error', dateValidation.message);
      return;
    }

    try {
      const response = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}/complete`, {
        work_completed_date: completionDate
      });
      
      if (response.success) {
        setShowCompleteModal(false);
        fetchWorkOrderDetails();
        toast.showSuccess('Completion request submitted successfully');
      }
    } catch (error) {
      console.error('Error submitting completion request:', error);
      toast.showError('Error submitting completion request');
    }
  };

  const handleApproveCompletion = async () => {
    try {
      const response = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}/approve-completion`, {
        approved: true
      });
      
      if (response.success) {
        setShowCompleteModal(false);
        fetchWorkOrderDetails();
        toast.showSuccess('Completion request approved successfully');
      }
    } catch (error) {
      console.error('Error approving completion:', error);
      toast.showError('Error approving completion');
    }
  };

  const handleApproveWorkOrder = async () => {
    try {
      const response = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}/approve`, {});
      
      if (response.success) {
        fetchWorkOrderDetails();
        toast.showSuccess('Work order approved successfully');
      } else {
        toast.showError('Error approving work order', response.error);
      }
    } catch (error) {
      console.error('Error approving work order:', error);
      toast.showError('Error approving work order');
    }
  };

  const handleRejectWorkOrder = async () => {
    if (!rejectionReason.trim()) {
      toast.showError('Validation Error', 'Please provide a rejection reason');
      return;
    }

    try {
      const response = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}/reject`, {
        reason: rejectionReason
      });
      
      if (response.success) {
        setShowRejectModal(false);
        setRejectionReason('');
        fetchWorkOrderDetails();
        toast.showSuccess('Work order rejected successfully');
      } else {
        toast.showError('Error rejecting work order', response.error);
      }
    } catch (error) {
      console.error('Error rejecting work order:', error);
      toast.showError('Error rejecting work order');
    }
  };

  const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.showError('File too large', 'Please select a file smaller than 5MB');
        return;
      }
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        toast.showError('Invalid file type', 'Please select an image file or PDF');
        return;
      }
      setReferenceImageFile(file);
    }
  };

  const handleUploadReferenceImage = async () => {
    if (!referenceImageFile) {
      toast.showError('No file selected', 'Please select an image to upload');
      return;
    }

    setIsUploadingReferenceImage(true);
    try {
      const formData = new FormData();
      formData.append('reference_image', referenceImageFile);

      // Get the auth token from localStorage (same as apiClient)
      const token = localStorage.getItem('token');
      
      if (!token) {
        toast.showError('Authentication Error', 'Please log in again');
        return;
      }

      const response = await fetch(`/api/work-orders/${workOrderId}/reference-image`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();
      
      if (result.success) {
        setShowReferenceImageModal(false);
        setReferenceImageFile(null);
        fetchWorkOrderDetails();
        toast.showSuccess('Reference image updated successfully');
      } else {
        toast.showError('Error updating reference image', result.error);
      }
    } catch (error) {
      console.error('Error updating reference image:', error);
      toast.showError('Error updating reference image');
    } finally {
      setIsUploadingReferenceImage(false);
    }
  };

  const handleDeleteReferenceImage = async () => {
    try {
      // Get the auth token from localStorage (same as apiClient)
      const token = localStorage.getItem('token');
      
      if (!token) {
        toast.showError('Authentication Error', 'Please log in again');
        return;
      }

      const response = await fetch(`/api/work-orders/${workOrderId}/reference-image`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();
      
      if (result.success) {
        fetchWorkOrderDetails();
        toast.showSuccess('Reference image deleted successfully');
      } else {
        toast.showError('Error deleting reference image', result.error);
      }
    } catch (error) {
      console.error('Error deleting reference image:', error);
      toast.showError('Error deleting reference image');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#08398F]"></div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Work Order not found</h2>
      </div>
    );
  }

  // Only allow edit/resubmit if rejected and current user is the creator
  const canEditRejected = workOrder.status === 'rejected' && user && workOrder.requested_by_id === user.id;

  return (
    <div className="space-y-6">
      {/* Rejection Banner */}
      {workOrder.status === 'rejected' && workOrder.rejection_reason && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <span className="text-2xl">❌</span>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-lg font-semibold text-red-800">Work Order Rejected</h3>
              <p className="mt-1 text-sm text-red-700">
                <span className="font-medium">Reason:</span> {workOrder.rejection_reason}
              </p>
              {canEditRejected && (
                <p className="mt-2 text-sm text-red-800">
                  Please review the rejection reason, make necessary edits below, and click the &quot;Edit &amp; Resubmit&quot; button to resubmit this work order.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Work Order: {workOrder.work_order_no}
          </h1>
          <p className="text-gray-600">Manage findings, actions, spare parts, and completion</p>
        </div>
        <div className="flex space-x-3">
          {workOrder.status === 'pending' && user && (user.role === 'admin' || user.role === 'superadmin') && (
            <>
              {!isApprovingWorkOrder && !isEditingWorkOrder && (
                <>
                  <Button variant="primary" onClick={() => setIsApprovingWorkOrder(true)}>
                    ✏️ Edit & Approve Work Order
                  </Button>
                  <Button variant="primary" onClick={handleApproveWorkOrder}>
                    ✅ Approve Without Editing
                  </Button>
                  <Button variant="outline" onClick={() => setShowRejectModal(true)}>
                    ❌ Reject Work Order
                  </Button>
                </>
              )}
            </>
          )}
          {/* Superadmin edit button for ongoing and completed */}
          {(user?.role === 'superadmin' && (workOrder.status === 'ongoing' || workOrder.status === 'completed')) && (
            <>
              {!isEditingWorkOrder && (
                <Button variant="primary" onClick={() => setIsEditingWorkOrder(true)}>
                  ✏️ Edit Work Order
                </Button>
              )}
            </>
          )}
          {workOrder.status === 'ongoing' && (
            <Button variant="secondary" onClick={handleCompleteWork}>
              ✅ Request Completion
            </Button>
          )}
          {workOrder.status === 'completion_requested' && user && (user.role === 'admin' || user.role === 'superadmin') && (
            <Button variant="primary" onClick={() => setShowCompleteModal(true)}>
              🔍 Review Completion Request
            </Button>
          )}
          {canEditRejected && !isEditingRejected && (
            <Button variant="primary" onClick={() => {
              setIsEditingRejected(true);
            }}>
              ✏️ Edit & Resubmit
            </Button>
          )}
          {canEditRejected && isEditingRejected && (
            <>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    // Validate that work_type_other is provided when "Others" is selected
                    if (editCore.work_type === 'Others' && (!editCore.work_type_other || editCore.work_type_other.trim() === '')) {
                      toast.showError('Validation Error', 'Please specify the work type when selecting "Others"');
                      return;
                    }

                    // Determine the final work_type value with proper case formatting
                    let finalWorkType = editCore.work_type;
                    if (editCore.work_type === 'Others' && editCore.work_type_other) {
                      // Convert to proper case (first letter of each word capitalized)
                      finalWorkType = editCore.work_type_other
                        .toLowerCase()
                        .split(' ')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                    }

                    // Save core edits first
                    const saveRes = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}`, {
                      equipment_number: editCore.equipment_number,
                      work_type: finalWorkType,
                      requested_by: editCore.requested_by,
                      km_hrs: editCore.km_hrs,
                      work_order_date: editCore.work_order_date,
                    });
                    if (!saveRes.success) {
                      toast.showError('Failed to save changes', saveRes.error);
                      return;
                    }
                    // Then resubmit
                    const res = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}/resubmit`);
                    if (res.success) {
                      toast.showSuccess('Work order resubmitted successfully');
                      await fetchWorkOrderDetails();
                      setIsEditingRejected(false);
                    } else {
                      toast.showError('Failed to resubmit work order', res.error);
                    }
                  } catch {
                    toast.showError('Error', 'Could not resubmit work order');
                  }
                }}
              >
                ✅ Save & Resubmit
              </Button>
              <Button variant="outline" onClick={() => setIsEditingRejected(false)}>
                Cancel Edit
              </Button>
            </>
          )}
          {/* Admin/Superadmin edit save/cancel buttons */}
          {(isEditingWorkOrder || isApprovingWorkOrder) && (
            <>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    // Validate that work_type_other is provided when "Others" is selected
                    if (editCore.work_type === 'Others' && (!editCore.work_type_other || editCore.work_type_other.trim() === '')) {
                      toast.showError('Validation Error', 'Please specify the work type when selecting "Others"');
                      return;
                    }

                    // Determine the final work_type value with proper case formatting
                    let finalWorkType = editCore.work_type;
                    if (editCore.work_type === 'Others' && editCore.work_type_other) {
                      // Convert to proper case (first letter of each word capitalized)
                      finalWorkType = editCore.work_type_other
                        .toLowerCase()
                        .split(' ')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                    }

                    // Save the edits
                    const saveRes = await apiClient.put<WorkOrder>(`/work-orders/${workOrderId}`, {
                      equipment_number: editCore.equipment_number,
                      work_type: finalWorkType,
                      requested_by: editCore.requested_by,
                      km_hrs: editCore.km_hrs,
                      work_order_date: editCore.work_order_date,
                    });
                    
                    if (!saveRes.success) {
                      toast.showError('Failed to save changes', saveRes.error);
                      return;
                    }

                    // If approving, approve the work order
                    if (isApprovingWorkOrder) {
                      const approveRes = await apiClient.put(`/work-orders/${workOrderId}/approve`);
                      if (approveRes.success) {
                        toast.showSuccess('Work order edited and approved successfully');
                        setIsApprovingWorkOrder(false);
                        await fetchWorkOrderDetails();
                      } else {
                        toast.showError('Failed to approve work order', approveRes.error);
                      }
                    } else {
                      toast.showSuccess('Work order updated successfully');
                      setIsEditingWorkOrder(false);
                      await fetchWorkOrderDetails();
                    }
                  } catch {
                    toast.showError('Error', 'Could not save changes');
                  }
                }}
              >
                {isApprovingWorkOrder ? '✅ Save & Approve' : '✅ Save Changes'}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsEditingWorkOrder(false);
                  setIsApprovingWorkOrder(false);
                  // Reset editCore to original values
                  setEditCore({
                    equipment_number: workOrder.equipment_number,
                    work_type: workOrder.work_type,
                    work_type_other: '',
                    requested_by: workOrder.requested_by,
                    km_hrs: workOrder.km_hrs || 0,
                    work_order_date: workOrder.work_order_date,
                  });
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Work Order Details */}
      <Card>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Work Order Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="font-medium text-gray-700">Equipment:</span>
            {(canEditRejected && isEditingRejected) || isEditingWorkOrder || isApprovingWorkOrder ? (
              <Input
                label=""
                value={editCore.equipment_number}
                onChange={(e) => setEditCore(prev => ({ ...prev, equipment_number: e.target.value }))}
                placeholder="Enter equipment number"
              />
            ) : (
              <p className="text-gray-900">{workOrder.equipment_number}</p>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700">Work Type:</span>
            {(canEditRejected && isEditingRejected) || isEditingWorkOrder || isApprovingWorkOrder ? (
              <div>
                <select
                  value={editCore.work_type}
                  onChange={(e) => setEditCore(prev => ({ 
                    ...prev, 
                    work_type: e.target.value,
                    work_type_other: e.target.value !== 'Others' ? '' : prev.work_type_other
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#08398F] focus:border-[#08398F]"
                >
                  <option value="">Select work type</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Repair">Repair</option>
                  <option value="Paint">Paint</option>
                  <option value="Wheel">Wheel</option>
                  <option value="Mechanical">Mechanical</option>
                  <option value="Fabrication">Fabrication</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Others">Others</option>
                </select>
                {editCore.work_type === 'Others' && (
              <Input
                label=""
                    value={editCore.work_type_other || ''}
                    onChange={(e) => setEditCore(prev => ({ ...prev, work_type_other: e.target.value }))}
                    placeholder="Please specify the work type"
                    className="mt-2"
                  />
                )}
              </div>
            ) : (
              <p className="text-gray-900">{workOrder.work_type}</p>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700">Requested By:</span>
            {(canEditRejected && isEditingRejected) || isEditingWorkOrder || isApprovingWorkOrder ? (
              <Input
                label=""
                value={editCore.requested_by}
                onChange={(e) => setEditCore(prev => ({ ...prev, requested_by: e.target.value }))}
                placeholder="Requested by"
              />
            ) : (
              <p className="text-gray-900">{workOrder.requested_by}</p>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700">KM/Hrs:</span>
            {(canEditRejected && isEditingRejected) || isEditingWorkOrder || isApprovingWorkOrder ? (
              <Input
                label=""
                type="number"
                value={editCore.km_hrs}
                onChange={(e) => setEditCore(prev => ({ ...prev, km_hrs: Number(e.target.value) || 0 }))}
                placeholder="Enter KM/Hrs"
              />
            ) : (
              <p className="text-gray-900">{workOrder.km_hrs || 'N/A'}</p>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700">Status:</span>
            <p className="text-gray-900 capitalize">{workOrder.status}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700">Order Date:</span>
            {(canEditRejected && isEditingRejected) || isEditingWorkOrder || isApprovingWorkOrder ? (
              <Input
                label=""
                type="date"
                value={editCore.work_order_date}
                onChange={(e) => setEditCore(prev => ({ ...prev, work_order_date: e.target.value }))}
              />
            ) : (
              <p className="text-gray-900">
                {new Date(workOrder.work_order_date).toLocaleDateString('en-GB')}
              </p>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700">Description:</span>
            <p className="text-gray-900 whitespace-pre-line">{workOrder.description || '—'}</p>
          </div>
        </div>
        
        {/* Reference Document/Image */}
          <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center mb-2">
            <span className="font-medium text-gray-700">Reference Document/Image:</span>
            {user && (user.role === 'admin' || user.role === 'superadmin') && (
              <div className="flex space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowReferenceImageModal(true)}
                >
                  {workOrder.reference_document ? '✏️ Edit' : '📁 Upload'} Reference
                </Button>
                {workOrder.reference_document && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDeleteReferenceImage}
                    className="text-red-600 hover:text-red-700"
                  >
                    🗑️ Delete
                  </Button>
                )}
              </div>
            )}
          </div>
          
          {workOrder.reference_document ? (
            <div className="mt-2">
              {workOrder.reference_document.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                // Display as image
                <div className="space-y-2">
                  <Image
                    src={`/${workOrder.reference_document}`}
                    alt="Reference"
                    width={400}
                    height={300}
                    className="max-w-xs rounded border h-auto w-auto"
                  />
              <a
                href={`/${workOrder.reference_document}`}
                target="_blank"
                rel="noreferrer"
                    className="text-[#08398F] underline text-sm"
              >
                    View full size
              </a>
            </div>
              ) : workOrder.reference_document.match(/\.pdf$/i) ? (
                // Display as PDF
                <div className="space-y-2">
                  <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                    <span className="text-red-600 text-lg">📄</span>
                    <div>
                      <p className="text-sm font-medium text-red-800">PDF Document</p>
                      <p className="text-xs text-red-700">Click below to view</p>
          </div>
                  </div>
                  <a
                    href={`/${workOrder.reference_document}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#08398F] underline text-sm"
                  >
                    📄 View PDF Document
                  </a>
                </div>
              ) : (
                // Display as other document link
                <a
                  href={`/${workOrder.reference_document}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#08398F] underline"
                >
                  📄 View document
                </a>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No reference document uploaded yet.</p>
          )}
        </div>

        {/* Rejection Reason */}
        {workOrder.status === 'rejected' && workOrder.rejection_reason && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <span className="font-medium text-gray-700 text-red-600">Rejection Reason:</span>
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{workOrder.rejection_reason}</p>
            </div>
          </div>
        )}

        {/* Completion Request Status */}
        {workOrder.status === 'completion_requested' && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <span className="font-medium text-blue-600">Completion Request Status:</span>
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-blue-800">
                ✅ Completion requested on {workOrder.completion_requested_at ? 
                  new Date(workOrder.completion_requested_at).toLocaleDateString('en-GB') : 'N/A'}
                <br />
                📅 Requested completion date: {workOrder.work_completed_date ? 
                  new Date(workOrder.work_completed_date).toLocaleDateString('en-GB') : 'N/A'}
                <br />
                ⏳ Awaiting admin approval...
              </p>
            </div>
          </div>
        )}

        {/* Completion Approved Status */}
        {workOrder.status === 'completed' && workOrder.completion_approved_at && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <span className="font-medium text-green-600">Completion Approved:</span>
            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-green-800">
                ✅ Completion approved on {new Date(workOrder.completion_approved_at).toLocaleDateString('en-GB')}
                <br />
                👤 Approved by: {workOrder.completion_approved_by_name || 'N/A'}
                <br />
                📅 Completed on: {workOrder.work_completed_date ? 
                  new Date(workOrder.work_completed_date).toLocaleDateString('en-GB') : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Findings Section */}
      <Card>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Findings</h2>
          {(workOrder.status !== 'completed' && workOrder.status !== 'completion_requested') && (
            <Button onClick={() => setShowAddFinding(true)}>
              ➕ Add Finding
            </Button>
          )}
        </div>

        {/* Add New Finding Form */}
        {showAddFinding && (
          <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="font-medium text-blue-900 mb-3">Add New Finding</h3>
            <Input
              label="Finding Description"
              value={newFinding.description}
              onChange={(e) => setNewFinding(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the finding or defect..."
            />
            <div className="flex space-x-3 mt-3">
              <Button size="sm" onClick={handleAddFinding}>
                Add Finding
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                setShowAddFinding(false);
                setNewFinding({ description: '' });
              }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Existing Findings */}
        {(workOrder.findings || []).length === 0 ? (
          <p className="text-gray-500 text-center py-4">No findings added yet.</p>
        ) : (
          <div className="space-y-4">
            {(workOrder.findings || []).map((finding) => (
              <div key={finding.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-medium text-gray-900">{finding.description}</h4>
                  <div className="flex space-x-2">
                    {(workOrder.status !== 'completed' && workOrder.status !== 'completion_requested') && (
                      <>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setSelectedFindingForAction(finding.id)}
                        >
                          ➕ Add Action
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setEditFinding({ description: finding.description });
                            setEditingFinding(finding.id);
                          }}
                        >
                          ✏️ Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleDeleteFinding(finding.id)}
                        >
                          🗑️ Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                
                {finding.reference_image && (
                  <Image 
                    src={`/${finding.reference_image}`} 
                    alt="Reference" 
                    width={200}
                    height={150}
                    className="mb-3 max-w-xs rounded" 
                  />
                )}

                {/* Edit Finding Form */}
                {editingFinding === finding.id && (
                  <div className="mb-3 p-3 bg-white rounded border">
                    <h5 className="font-medium text-gray-800 mb-2">Edit Finding</h5>
                    <Input
                      label="Finding Description"
                      value={editFinding.description}
                      onChange={(e) => setEditFinding(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the finding or defect..."
                    />
                    <div className="flex space-x-3 mt-3">
                      <Button size="sm" onClick={() => handleEditFinding(finding.id)}>
                        Update Finding
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingFinding(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Actions for this finding */}
                <div className="ml-4 space-y-3">
                  {(finding.actions || []).map((action) => (
                    <div key={action.id} className="p-3 bg-white rounded border">
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="font-medium text-gray-800">{action.description}</h5>
                        <div className="flex space-x-2">
                          {workOrder.status !== 'completed' && (
                            <>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  setSelectedActionForStartAgain(action.id);
                                  setShowStartAgainModal(true);
                                }}
                              >
                                🔄 Start Again
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  setEditAction({
                                    description: action.description,
                                    action_date: action.action_date,
                                    start_time: toTimeHHMM(action.start_time),
                                    end_time: toTimeHHMM(action.end_time as unknown as string)
                                  });
                                  setEditingAction(action.id);
                                }}
                              >
                                ✏️ Edit
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleDeleteAction(action.id)}
                              >
                                🗑️ Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600 mb-2">
                        <span>Date: {new Date(action.action_date).toLocaleDateString('en-GB')}</span>
                        <span className="mx-2">|</span>
                        <span>Start: {action.start_time}</span>
                        <span className="mx-2">|</span>
                        <span>End: {action.end_time}</span>
                      </div>

                      {/* Action Dates Section */}
                      <div className="mt-3">
                        <div className="flex justify-between items-center mb-2">
                          <h6 className="font-medium text-gray-700">Action Dates:</h6>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => {
                              setSelectedActionForStartAgain(action.id);
                              setShowStartAgainModal(true);
                            }}
                          >
                            ➕ Add Date
                          </Button>
                        </div>
                        
                        {actionDates[action.id] && actionDates[action.id].length > 0 ? (
                          <div className="space-y-2">
                            {actionDates[action.id].map((actionDate) => (
                              <div key={actionDate.id} className="p-2 bg-gray-50 rounded border">
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <div className="text-sm text-gray-600">
                                      <span>Date: {new Date(actionDate.action_date).toLocaleDateString('en-GB')}</span>
                                      <span className="mx-2">|</span>
                                      <span>Start: {actionDate.start_time}</span>
                                      <span className="mx-2">|</span>
                                      <span>End: {actionDate.end_time}</span>
                                      <span className="mx-2">|</span>
                                      <span className={`font-medium ${actionDate.is_completed ? 'text-green-600' : 'text-orange-600'}`}>
                                        {actionDate.is_completed ? '✓ Completed' : '⏳ In Progress'}
                                      </span>
                                    </div>
                                    {actionDate.technicians && actionDate.technicians.length > 0 && (
                                      <div className="text-xs text-gray-500 mt-1">
                                        Technicians: {actionDate.technicians.map((t: ActionTechnician) => t.name).join(', ')}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex space-x-1">
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => {
                                        setEditingActionDate(actionDate.id);
                                        setEditActionDateData({
                                          action_date: actionDate.action_date,
                                          start_time: actionDate.start_time,
                                          end_time: actionDate.end_time,
                                          is_completed: actionDate.is_completed,
                                          technician_ids: actionDate.technicians?.map((t: ActionTechnician) => t.technician_id || 0) || []
                                        });
                                      }}
                                    >
                                      ✏️
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => handleDeleteActionDate(action.id, actionDate.id)}
                                    >
                                      🗑️
                                    </Button>
                                  </div>
                                </div>
                                
                                {/* Edit Action Date Form */}
                                {editingActionDate === actionDate.id && (
                                  <div className="mt-2 p-2 bg-white rounded border">
                                    <h6 className="font-medium text-gray-800 mb-2">Edit Action Date</h6>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      <Input
                                        label="Date"
                                        type="date"
                                        value={editActionDateData.action_date}
                                        onChange={(e) => setEditActionDateData(prev => ({ ...prev, action_date: e.target.value }))}
                                      />
                                      <div className="flex items-center space-x-2">
                                        <input
                                          type="checkbox"
                                          checked={editActionDateData.is_completed}
                                          onChange={(e) => setEditActionDateData(prev => ({ ...prev, is_completed: e.target.checked }))}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="text-sm font-medium text-gray-700">Completed</span>
                                      </div>
                                    </div>
                                    <div className="flex space-x-2 mt-2">
                                      <Button size="sm" onClick={() => handleEditActionDate()}>
                                        Update
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => setEditingActionDate(null)}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 italic">No additional dates added</div>
                        )}
                      </div>
                      
                      {/* Edit Action Form */}
                      {editingAction === action.id && (
                        <div className="mb-3 p-3 bg-gray-50 rounded border">
                          <h6 className="font-medium text-gray-800 mb-2">Edit Action</h6>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Input
                              label="Action Description"
                              value={editAction.description}
                              onChange={(e) => setEditAction(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="Describe the action taken..."
                            />
                            <Input
                              label="Action Date"
                              type="date"
                              value={editAction.action_date}
                              onChange={(e) => setEditAction(prev => ({ ...prev, action_date: e.target.value }))}
                            />
                            <Input
                              label="Start Time"
                              type="time"
                              value={editAction.start_time}
                              onChange={(e) => setEditAction(prev => ({ ...prev, start_time: e.target.value }))}
                            />
                            <Input
                              label="End Time"
                              type="time"
                              value={editAction.end_time}
                              onChange={(e) => setEditAction(prev => ({ ...prev, end_time: e.target.value }))}
                            />
                          </div>
                          <div className="flex space-x-3 mt-3">
                            <Button size="sm" onClick={() => handleEditAction(action.id)}>
                              Update Action
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingAction(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {/* Spare parts for this action */}
                      <div className="ml-4 mt-3">
                        <div className="flex justify-between items-center mb-1">
                          <h6 className="font-medium text-gray-700">Spare Parts:</h6>
                          {workOrder.status !== 'completed' && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => setSelectedActionForSparePart(action.id)}
                              className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300"
                            >
                              ➕ Add Spare Part
                            </Button>
                          )}
                        </div>
                        {(action.spare_parts || []).length > 0 && (
                          <div className="space-y-1">
                            {(action.spare_parts || []).map((sparePart) => (
                              <div key={sparePart.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                                <div className="text-sm text-gray-600">
                                  {sparePart.part_name} ({sparePart.part_number}) - Qty: {sparePart.quantity}
                                </div>
                                {workOrder.status !== 'completed' && (
                                  <div className="flex space-x-1">
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => {
                                        setEditSparePart({
                                          part_name: sparePart.part_name,
                                          part_number: sparePart.part_number,
                                          quantity: sparePart.quantity
                                        });
                                        setEditingSparePart(sparePart.id);
                                      }}
                                    >
                                      ✏️
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => handleDeleteSparePart(sparePart.id)}
                                    >
                                      🗑️
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(action.spare_parts || []).length === 0 && (
                          <p className="text-sm text-gray-500 italic">No spare parts added yet.</p>
                        )}
                      </div>

                      {/* Edit Spare Part Form */}
                      {editingSparePart && (action.spare_parts || []).find(sp => sp.id === editingSparePart) && (
                        <div className="ml-4 mt-3 p-3 bg-gray-50 rounded border">
                          <h6 className="font-medium text-gray-800 mb-2">Edit Spare Part</h6>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Input
                              label="Part Name"
                              value={editSparePart.part_name}
                              onChange={(e) => setEditSparePart(prev => ({ ...prev, part_name: e.target.value }))}
                              placeholder="Enter part name"
                            />
                            <Input
                              label="Part Number"
                              value={editSparePart.part_number}
                              onChange={(e) => setEditSparePart(prev => ({ ...prev, part_number: e.target.value }))}
                              placeholder="Enter part number"
                            />
                            <Input
                              label="Quantity"
                              type="number"
                              value={editSparePart.quantity}
                              onChange={(e) => setEditSparePart(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                              min="1"
                            />
                          </div>
                          <div className="flex space-x-3 mt-3">
                            <Button size="sm" onClick={() => handleEditSparePart(editingSparePart)}>
                              Update Spare Part
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingSparePart(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Technicians for this action */}
                      <div className="mt-3 ml-4">
                        <h6 className="font-medium text-gray-700 mb-1">Technicians:</h6>
                        {/* Read-only list when not editing this action */}
                        {(editingAction !== action.id) && (
                          <div className="space-y-1">
                            {(action.technicians || []).length === 0 ? (
                              <p className="text-sm text-gray-500">No technicians assigned to this action.</p>
                            ) : (
                              (action.technicians || []).map((t) => (
                                <div key={t.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                  <div className="text-sm text-gray-700">{t.name} ({t.staff_id})</div>
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        {/* Editable multi-select when editing this action */}
                        {(editingAction === action.id && workOrder.status !== 'completed') && (
                          <div className="mt-2 p-2 bg-white border rounded">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Select Technicians</label>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-auto">
                                {technicians.map((t) => {
                                  const assigned = (action.technicians || []).some(at => (at.technician_id ? at.technician_id === t.id : at.staff_id === t.staff_id));
                                  return (
                                    <label key={t.id} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                                      <input
                                        type="checkbox"
                                        checked={assigned}
                                        onChange={async (e) => {
                                          const checked = e.target.checked;
                                          try {
                                            if (checked) {
                                              const res = await apiClient.post<ActionTechnician>(`/actions/${action.id}/technicians`, { technician_id: t.id });
                                              if (!res.success) {
                                                toast.showError('Error', res.error || 'Failed to add technician');
                                              }
                                            } else {
                                              if (!(user && (user.role === 'admin' || user.role === 'superadmin'))) {
                                                toast.showError('Not allowed', 'Only admins can remove technicians');
                                                return;
                                              }
                                              const existing = (action.technicians || []).find(at => (at.technician_id ? at.technician_id === t.id : at.staff_id === t.staff_id));
                                              if (existing) {
                                                const res = await apiClient.delete(`/actions/${action.id}/technicians?action_technician_id=${existing.id}`);
                                                if (!res.success) {
                                                  toast.showError('Error', res.error || 'Failed to remove technician');
                                                }
                                              }
                                            }
                                            fetchWorkOrderDetails();
                                          } catch {
                                            toast.showError('Error', 'Operation failed');
                                          }
                                        }}
                                      />
                                      <span className="text-sm text-gray-800">{t.name} ({t.staff_id})</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add Action Form */}
                {selectedFindingForAction === finding.id && (
                  <div className="ml-4 mt-3 p-3 bg-white rounded border">
                    <h5 className="font-medium text-gray-800 mb-2">Add Action</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input
                        label="Action Description"
                        value={newAction.description}
                        onChange={(e) => setNewAction(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Describe the action taken..."
                      />
                      <Input
                        label="Action Date"
                        type="date"
                        value={newAction.action_date}
                        onChange={(e) => setNewAction(prev => ({ ...prev, action_date: e.target.value }))}
                      />
                      <Input
                        label="Start Time"
                        type="time"
                        value={newAction.start_time}
                        onChange={(e) => setNewAction(prev => ({ ...prev, start_time: e.target.value }))}
                      />
                      <Input
                        label="End Time (optional)"
                        type="time"
                        value={newAction.end_time}
                        onChange={(e) => setNewAction(prev => ({ ...prev, end_time: e.target.value }))}
                      />
                    </div>

                    <div className="mt-3">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={newAction.is_completed || false}
                          onChange={(e) => setNewAction(prev => ({ ...prev, is_completed: e.target.checked }))}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">Mark as completed</span>
                      </label>
                    </div>

                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Assign Technicians</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-auto">
                        {technicians.map(t => {
                          const checked = newActionTechnicianIds.includes(t.id);
                          return (
                            <label key={t.id} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setNewActionTechnicianIds(prev => isChecked ? [...prev, t.id] : prev.filter(id => id !== t.id));
                                }}
                              />
                              <span className="text-sm text-gray-800">{t.name} ({t.staff_id})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex space-x-3 mt-3">
                      <Button size="sm" onClick={() => handleAddAction(finding.id)}>
                        Add Action
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelectedFindingForAction(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Add Spare Part Form */}
                {selectedActionForSparePart && (finding.actions || []).find(a => a.id === selectedActionForSparePart) && (
                  <div className="ml-8 mt-3 p-3 bg-white rounded border">
                    <h5 className="font-medium text-gray-800 mb-2">Add Spare Part</h5>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input
                        label="Part Name"
                        value={newSparePart.part_name}
                        onChange={(e) => setNewSparePart(prev => ({ ...prev, part_name: e.target.value }))}
                        placeholder="Enter part name"
                      />
                      <Input
                        label="Part Number"
                        value={newSparePart.part_number}
                        onChange={(e) => setNewSparePart(prev => ({ ...prev, part_number: e.target.value }))}
                        placeholder="Enter part number"
                      />
                      <Input
                        label="Quantity"
                        type="number"
                        value={newSparePart.quantity}
                        onChange={(e) => setNewSparePart(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                        min="1"
                      />
                    </div>
                    <div className="flex space-x-3 mt-3">
                      <Button size="sm" onClick={() => handleAddSparePart(selectedActionForSparePart)}>
                        Add Spare Part
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelectedActionForSparePart(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Technicians Section */}
      {/* Removed legacy Job Performed By section */}

      {/* Complete Work Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
            {workOrder?.status === 'completion_requested' ? (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Review Completion Request</h2>
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-blue-800 text-sm">
                    <strong>Requested by:</strong> {workOrder.completion_requested_by_name || 'N/A'}<br />
                    <strong>Requested on:</strong> {workOrder.completion_requested_at ? new Date(workOrder.completion_requested_at).toLocaleDateString('en-GB') : 'N/A'}<br />
                    <strong>Completion date:</strong> {workOrder.work_completed_date ? new Date(workOrder.work_completed_date).toLocaleDateString('en-GB') : 'N/A'}
                  </p>
                </div>
                <div className="flex space-x-3 mt-6">
                  <Button 
                    variant="primary" 
                    onClick={handleApproveCompletion}
                    className="flex-1"
                  >
                    ✅ Approve Completion
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setShowCompleteModal(false)}
                    className="flex-1"
                  >
                    ❌ Reject Completion
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Request Work Order Completion</h2>
            <p className="text-gray-600 mb-4">Please select the completion date for this work order.</p>
            <Input
              label="Completion Date"
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
            />
            <div className="flex space-x-3 mt-6">
              <Button onClick={handleCompleteWorkConfirm}>
                    Submit Completion Request
              </Button>
              <Button variant="outline" onClick={() => setShowCompleteModal(false)}>
                Cancel
              </Button>
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reject Work Order Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Reject Work Order</h2>
            <p className="text-gray-600 mb-4">Please provide a reason for rejecting this work order.</p>
            <Input
              label="Rejection Reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason..."
            />
            <div className="flex space-x-3 mt-6">
              <Button variant="outline" onClick={handleRejectWorkOrder}>
                ❌ Reject Work Order
              </Button>
              <Button variant="outline" onClick={() => {
                setShowRejectModal(false);
                setRejectionReason('');
              }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reference Image Modal */}
      {showReferenceImageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {workOrder?.reference_document ? 'Update Reference Document' : 'Upload Reference Document'}
            </h2>
            
            {workOrder?.reference_document && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-yellow-800 text-sm">
                  <strong>⚠️ Note:</strong> Uploading a new file will replace the existing reference document.
                  <span className="block mt-1">The current document will be deleted.</span>
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select File
              </label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleReferenceImageChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supported formats: JPG, PNG, GIF, WebP, PDF. Max size: 5MB
              </p>
            </div>

            {referenceImageFile && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-blue-800 text-sm">
                  <strong>Selected file:</strong> {referenceImageFile.name}
                  <br />
                  <strong>Size:</strong> {(referenceImageFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}

            <div className="flex space-x-3 mt-6">
              <Button
                onClick={handleUploadReferenceImage}
                disabled={!referenceImageFile || isUploadingReferenceImage}
                className="flex-1"
              >
                {isUploadingReferenceImage ? '⏳ Uploading...' : '📁 Upload Document'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowReferenceImageModal(false);
                  setReferenceImageFile(null);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Start Again Modal */}
      {showStartAgainModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Start Again - Add New Date</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <Input
                label="Action Date"
                type="date"
                value={startAgainData.action_date}
                onChange={(e) => setStartAgainData(prev => ({ ...prev, action_date: e.target.value }))}
              />
              <Input
                label="Start Time"
                type="time"
                value={startAgainData.start_time}
                onChange={(e) => setStartAgainData(prev => ({ ...prev, start_time: e.target.value }))}
              />
              <Input
                label="End Time"
                type="time"
                value={startAgainData.end_time}
                onChange={(e) => setStartAgainData(prev => ({ ...prev, end_time: e.target.value }))}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign Technicians</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-auto">
                {technicians.map(t => {
                  const checked = startAgainData.technician_ids.includes(t.id);
                  return (
                    <label key={t.id} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setStartAgainData(prev => ({
                            ...prev,
                            technician_ids: isChecked 
                              ? [...prev.technician_ids, t.id] 
                              : prev.technician_ids.filter(id => id !== t.id)
                          }));
                        }}
                      />
                      <span className="text-sm text-gray-800">{t.name} ({t.staff_id})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <Button
                onClick={handleStartAgain}
                disabled={!startAgainData.action_date || !startAgainData.start_time}
                className="flex-1"
              >
                Add Date
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowStartAgainModal(false);
                  setSelectedActionForStartAgain(null);
                  setStartAgainData({
                    action_date: new Date().toISOString().split('T')[0],
                    start_time: '',
                    end_time: '',
                    technician_ids: []
                  });
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modals */}
      <ConfirmationModal
        isOpen={showDeleteFindingModal}
        title="Delete Finding"
        message="Are you sure you want to delete this finding? This will also delete all associated actions and spare parts."
        confirmText="Delete Finding"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteFinding}
        onCancel={() => {
          setShowDeleteFindingModal(false);
          setItemToDelete(null);
        }}
      />

      <ConfirmationModal
        isOpen={showDeleteActionModal}
        title="Delete Action"
        message="Are you sure you want to delete this action? This will also delete all associated spare parts."
        confirmText="Delete Action"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteAction}
        onCancel={() => {
          setShowDeleteActionModal(false);
          setItemToDelete(null);
        }}
      />

      <ConfirmationModal
        isOpen={showDeleteSparePartModal}
        title="Delete Spare Part"
        message="Are you sure you want to delete this spare part?"
        confirmText="Delete Spare Part"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteSparePart}
        onCancel={() => {
          setShowDeleteSparePartModal(false);
          setItemToDelete(null);
        }}
      />
    </div>
  );
} 