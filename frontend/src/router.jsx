import { createBrowserRouter, Navigate } from 'react-router-dom';

import Login from './pages/Login';
import AppShell from './components/layout/AppShell';
import PrivateRoute from './auth/PrivateRoute';

// Agent pages
import AgentDashboard from './pages/agent/AgentDashboard';
import MyTasks from './pages/agent/MyTasks';
import ClientSearch from './pages/agent/ClientSearch';
import AbsentFollowUp from './pages/agent/AbsentFollowUp';
import TodaySchedule from './pages/agent/TodaySchedule';
import SideSessionCheck from './pages/agent/SideSessionCheck';
import AgentCodeProblems from './pages/agent/AgentCodeProblems';

// Leader pages
import LeaderDashboard from './pages/leader/LeaderDashboard';
import LeaderCodeProblems from './pages/leader/LeaderCodeProblems';
import LeaderPerformance from './pages/leader/LeaderPerformance';
import TeamOverview from './pages/leader/TeamOverview';
import AbsentReport from './pages/leader/AbsentReport';
import GroupCoverage from './pages/leader/GroupCoverage';
import TaskDistribution from './pages/leader/TaskDistribution';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import ExcelUpload from './pages/admin/ExcelUpload';
import SystemReports from './pages/admin/SystemReports';
import EducationReports from './pages/admin/EducationReports';
import QualityReports from './pages/admin/QualityReports';
import TeamPage from './pages/admin/TeamPage';

// Shared pages
import FixReport from './pages/shared/FixReport';
import AttendanceAbsenceReport from './pages/shared/AttendanceAbsenceReport';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/login" replace /> },

  // ── Agent routes ──────────────────────────────────────────────
  {
    path: '/agent',
    element: <PrivateRoute role="agent"><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard',          element: <AgentDashboard /> },
      { path: 'tasks',              element: <MyTasks /> },
      { path: 'clients',            element: <ClientSearch /> },
      { path: 'absent',             element: <AbsentFollowUp /> },
      { path: 'schedule',           element: <TodaySchedule /> },
      { path: 'side-session-check', element: <SideSessionCheck /> },
      { path: 'code-problems',      element: <AgentCodeProblems /> },
    ],
  },

  // ── Leader routes ─────────────────────────────────────────────
  {
    path: '/leader',
    element: <PrivateRoute role="leader"><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard',                    element: <LeaderDashboard /> },
      { path: 'team',                         element: <TeamOverview /> },
      { path: 'absent-report',                element: <AbsentReport /> },
      { path: 'groups',                       element: <GroupCoverage /> },
      { path: 'tasks',                        element: <TaskDistribution /> },
      { path: 'users',                        element: <UserManagement /> },
      { path: 'upload',                       element: <ExcelUpload /> },
      { path: 'code-problems',                element: <LeaderCodeProblems /> },
      { path: 'performance',                  element: <LeaderPerformance /> },
      { path: 'reports/customer-services',    element: <SystemReports /> },
      { path: 'reports/education',            element: <EducationReports /> },
      { path: 'reports/quality',              element: <QualityReports /> },
      { path: 'reports/fix-report',           element: <FixReport /> },
      { path: 'reports/attendance-absence',   element: <AttendanceAbsenceReport /> },
    ],
  },

  // ── Admin routes ──────────────────────────────────────────────
  {
    path: '/admin',
    element: <PrivateRoute role="admin"><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard',                    element: <AdminDashboard /> },
      { path: 'users',                        element: <UserManagement /> },
      { path: 'upload',                       element: <ExcelUpload /> },
      { path: 'team',                         element: <TeamPage /> },
      { path: 'control',                      element: <LeaderDashboard /> },
      { path: 'reports/customer-services',    element: <SystemReports /> },
      { path: 'reports/education',            element: <EducationReports /> },
      { path: 'reports/quality',              element: <QualityReports /> },
      { path: 'reports/fix-report',           element: <FixReport /> },
      { path: 'reports/attendance-absence',   element: <AttendanceAbsenceReport /> },
    ],
  },

  { path: '*', element: <Navigate to="/login" replace /> },
]);

export default router;
