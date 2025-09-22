'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../utils/api';
import { WorkOrder } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const pathname = usePathname();
  const { user } = useAuth();
  const [completionRequestsCount, setCompletionRequestsCount] = useState(0);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);

  const menuItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: '📊'
    },
    {
      href: '/work-orders/create',
      label: 'Create New Task',
      icon: '➕'
    },
    {
      href: '/work-orders/pending',
      label: 'Pending Tasks',
      icon: '⏳',
      badge: pendingTasksCount > 0 ? pendingTasksCount : undefined
    },
    {
      href: '/work-orders/ongoing',
      label: 'Ongoing Tasks',
      icon: '🔄'
    },
    {
      href: '/work-orders/completed',
      label: 'Completed Tasks',
      icon: '✅'
    },
    // RBAC: show Completion Requests only for admin/superadmin
    ...(user && (user.role === 'admin' || user.role === 'superadmin') ? [
      { 
        href: '/work-orders/completion-requests', 
        label: 'Completion Requests', 
        icon: '⏭️',
        badge: completionRequestsCount > 0 ? completionRequestsCount : undefined
      },
    ] : []),
    // RBAC: show Users/Technicians/Reports only for admin/superadmin
    ...(user && (user.role === 'admin' || user.role === 'superadmin') ? [
      { href: '/technicians', label: 'Technicians', icon: '🛠️' },
      { href: '/reports', label: 'Reports', icon: '📈' },
      { href: '/reports/progress', label: 'Progress Report', icon: '📊' },
    ] : []),    
    ...(user && (user.role === 'superadmin') ? [
      { href: '/users', label: 'Users', icon: '👤' },

    ] : []),
  ];

  const fetchCompletionRequestsCount = useCallback(async () => {
    if (user && (user.role === 'admin' || user.role === 'superadmin')) {
      try {
        const response = await apiClient.get<WorkOrder[]>('/work-orders/completion-requests');
        if (response.success && response.data && Array.isArray(response.data)) {
          setCompletionRequestsCount(response.data.length);
        }
      } catch {
        // Silently fail, don't show error for sidebar count
      }
    }
  }, [user]);

  const fetchPendingTasksCount = useCallback(async () => {
    try {
      const response = await apiClient.get<WorkOrder[]>('/work-orders?status=pending');
      if (response.success && response.data && Array.isArray(response.data)) {
        setPendingTasksCount(response.data.length);
      }
    } catch {
      // Silently fail, don't show error for sidebar count
    }
  }, []);

  useEffect(() => {
    fetchCompletionRequestsCount();
    fetchPendingTasksCount();
    // Refresh counts every 30 seconds
    const interval = setInterval(() => {
      fetchCompletionRequestsCount();
      fetchPendingTasksCount();
    }, 30000);
    return () => clearInterval(interval);
  }, [user, fetchCompletionRequestsCount, fetchPendingTasksCount]);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed top-16 left-0 h-full bg-[#08398F] text-white w-64 transform transition-transform duration-300 ease-in-out z-50
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold">Workshops Section</h2>
            </div>
            <button
              onClick={onToggle}
              className="lg:hidden text-white hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          <nav className="space-y-2">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center justify-between px-4 py-3 rounded-lg transition-colors
                  ${isActive(item.href) 
                    ? 'bg-white text-[#08398F] font-medium' 
                    : 'text-white hover:bg-white hover:text-[#08398F] hover:bg-opacity-10'
                  }
                `}
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    onToggle();
                  }
                }}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-lg">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[20px] text-center">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}; 