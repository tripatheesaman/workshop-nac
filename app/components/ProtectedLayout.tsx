'use client';

import { useState } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useAuth } from './AuthProvider';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

export function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const { user, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#08398F]"></div>
      </div>
    );
  }

  if (!user) {
    return null; // AuthProvider will handle redirect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      
      <div className="flex pt-16">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        
        <div className="flex-1 lg:ml-64">
          <div className="p-6">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden mb-4 p-2 bg-[#08398F] text-white rounded-lg"
            >
              ☰
            </button>
            
            {children}
          </div>
        </div>
      </div>
    </div>
  );
} 