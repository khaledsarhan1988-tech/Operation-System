import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import QuickAddTodo from '../todos/QuickAddTodo';

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  // Wide, data-heavy pages (e.g. the trainer payroll table with many columns)
  // use the FULL available width instead of the centered 1600px cap, so columns
  // don't overflow the frame and the empty side margins are used.
  const fullWidth = /\/salaries\//.test(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 animate-fade-in"
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.55)',
              backdropFilter: 'blur(8px)',
            }}
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-10 animate-slide-up">
            <Sidebar mobile onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 xl:p-10">
          <div className={fullWidth ? 'w-full' : 'max-w-[1600px] mx-auto'}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Quick-Add Todo (Ctrl/Cmd+K) */}
      <QuickAddTodo />
    </div>
  );
}
