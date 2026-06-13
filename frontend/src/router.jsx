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
import Pipeline from './pages/agent/Pipeline';
import LeaderPipeline from './pages/leader/LeaderPipeline';

// Leader pages
import LeaderDashboard from './pages/leader/LeaderDashboard';
import LeaderCodeProblems from './pages/leader/LeaderCodeProblems';
import LeaderPerformance from './pages/leader/LeaderPerformance';
import TeamOverview from './pages/leader/TeamOverview';
import AbsentReport from './pages/leader/AbsentReport';
import GroupCoverage from './pages/leader/GroupCoverage';
import TaskDistribution from './pages/leader/TaskDistribution';
import LeaderTodos from './pages/leader/LeaderTodos';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import ExcelUpload from './pages/admin/ExcelUpload';
import DriveSync from './pages/admin/DriveSync';
import DriveSyncHistory from './pages/admin/DriveSyncHistory';
import RemarksMonitor from './pages/admin/RemarksMonitor';
import RemarksMonitorCategory from './pages/admin/RemarksMonitorCategory';
import AdminTodos from './pages/admin/AdminTodos';
import SystemReports from './pages/admin/SystemReports';
import EducationReports from './pages/admin/EducationReports';
import QualityReports from './pages/admin/QualityReports';
import QualityDiagnostic from './pages/admin/QualityDiagnostic';
import QualitySnapshots from './pages/admin/QualitySnapshots';
import DbStatus from './pages/admin/DbStatus';
import TeamPage from './pages/admin/TeamPage';
import OrgChart from './pages/admin/OrgChart';
import TrainerUtilization from './pages/admin/TrainerUtilization';
import TrainerAvailabilityFinder from './pages/admin/TrainerAvailabilityFinder';
import TrainerUtilizationDashboard from './pages/admin/TrainerUtilizationDashboard';
import TrainerWorkHistory from './pages/admin/TrainerWorkHistory';
import TrainerSalaries from './pages/admin/TrainerSalaries';
import TrainersPayroll from './pages/admin/TrainersPayroll';
import LectureReschedules from './pages/admin/LectureReschedules';
import ScheduleChangeLog from './pages/admin/ScheduleChangeLog';
import HolidaysManagement from './pages/admin/HolidaysManagement';
import DashboardDetail from './pages/admin/DashboardDetail';
import ClientDistribution from './pages/admin/ClientDistribution';
import AdminPipeline from './pages/admin/AdminPipeline';
import EmployeeProgression from './pages/admin/EmployeeProgression';
import TargetsManagement from './pages/admin/TargetsManagement';
import MyProgression from './pages/agent/MyProgression';
import MyTodos from './pages/agent/MyTodos';
import SystemSettings from './pages/admin/SystemSettings';
import FinanceSync from './pages/admin/FinanceSync';
import FinanceMatching from './pages/admin/FinanceMatching';
import FinanceLifecycle from './pages/admin/FinanceLifecycle';
import Clients from './pages/admin/Clients';

// Subscription Tracker (cs_*) — standalone subsystem
import CsMyClients from './pages/subscriptions/CsMyClients';
import CsClientProfile from './pages/subscriptions/CsClientProfile';
import CsDashboard from './pages/subscriptions/CsDashboard';
import DepartmentDeliveries from './pages/subscriptions/DepartmentDeliveries';
import Enrollment from './pages/subscriptions/Enrollment';

import TeamProgression from './pages/leader/TeamProgression';
import EvaluateGoals from './pages/leader/EvaluateGoals';

// Enrollment pages
import EnrollmentPipeline from './pages/enrollment/Pipeline';

// Shared pages
import FixReport from './pages/shared/FixReport';
import AttendanceAbsenceReport from './pages/shared/AttendanceAbsenceReport';
import GroupReceiving from './pages/shared/GroupReceiving';
import Profile from './pages/shared/Profile';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/login" replace /> },

  // ── Agent routes ──────────────────────────────────────────────
  {
    path: '/agent',
    element: <PrivateRoute allowedRoles={['agent', 'leader', 'admin']}><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="pipeline" replace /> },
      { path: 'dashboard',          element: <AgentDashboard /> },
      { path: 'tasks',              element: <MyTasks /> },
      { path: 'clients',            element: <ClientSearch /> },
      { path: 'absent',             element: <AbsentFollowUp /> },
      { path: 'schedule',           element: <TodaySchedule /> },
      { path: 'side-session-check', element: <SideSessionCheck /> },
      { path: 'code-problems',      element: <AgentCodeProblems /> },
      { path: 'group-receiving',    element: <GroupReceiving /> },
      { path: 'profile',            element: <Profile /> },
      { path: 'pipeline',           element: <Pipeline /> },
      { path: 'my-progression',     element: <MyProgression /> },
      { path: 'todos',              element: <MyTodos /> },
      { path: 'targets',            element: <TargetsManagement /> },
    ],
  },

  // ── Per-page grants (users.extra_pages) ───────────────────────────
  // Neutral, role-agnostic mount so a user of ANY role (agent, enrollment,
  // CS, leader) granted a page can reach it. The parent only requires an
  // authenticated session; each child is gated by requirePage so a user
  // still needs the specific grant in extra_pages (admins always pass).
  {
    path: '/reports',
    element: <PrivateRoute><AppShell /></PrivateRoute>,
    children: [
      { path: 'trainer-utilization',    element: <PrivateRoute requirePage="occupancy-trainers"><TrainerUtilization /></PrivateRoute> },
      { path: 'trainer-dashboard',      element: <PrivateRoute requirePage="occupancy-trainers"><TrainerUtilizationDashboard /></PrivateRoute> },
      { path: 'find-available-trainer', element: <PrivateRoute requirePage="occupancy-trainers"><TrainerAvailabilityFinder /></PrivateRoute> },
      { path: 'trainer-work-history',   element: <PrivateRoute requirePage="occupancy-trainers"><TrainerWorkHistory /></PrivateRoute> },
    ],
  },

  // ── Leader routes ─────────────────────────────────────────────
  {
    path: '/leader',
    element: <PrivateRoute allowedRoles={['leader', 'admin']}><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard',                    element: <LeaderDashboard /> },
      { path: 'team',                         element: <TeamOverview /> },
      { path: 'org-chart',                    element: <OrgChart /> },
      { path: 'absent-report',                element: <AbsentReport /> },
      { path: 'groups',                       element: <GroupCoverage /> },
      { path: 'tasks',                        element: <TaskDistribution /> },
      { path: 'todos',                        element: <LeaderTodos /> },
      { path: 'users',                        element: <UserManagement /> },
      { path: 'upload',                       element: <ExcelUpload /> },
      { path: 'code-problems',                element: <LeaderCodeProblems /> },
      { path: 'group-receiving',              element: <GroupReceiving /> },
      { path: 'profile',                      element: <Profile /> },
      { path: 'performance',                  element: <LeaderPerformance /> },
      { path: 'pipeline',                     element: <LeaderPipeline /> },
      { path: 'reports/customer-services',    element: <SystemReports /> },
      { path: 'reports/education',            element: <EducationReports /> },
      { path: 'reports/quality',              element: <QualityReports /> },
      { path: 'reports/fix-report',           element: <FixReport /> },
      { path: 'reports/attendance-absence',   element: <AttendanceAbsenceReport /> },
      { path: 'targets',                      element: <TargetsManagement /> },
    ],
  },

  // ── Admin routes ──────────────────────────────────────────────
  {
    path: '/admin',
    element: <PrivateRoute allowedRoles={['admin']}><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard',                    element: <AdminDashboard /> },
      { path: 'dashboard/details/:metric',    element: <DashboardDetail /> },
      { path: 'users',                        element: <UserManagement /> },
      { path: 'upload',                       element: <ExcelUpload /> },
      { path: 'drive-sync',                   element: <DriveSync /> },
      { path: 'drive-sync/history',           element: <DriveSyncHistory /> },
      { path: 'remarks-monitor',              element: <RemarksMonitor /> },
      { path: 'remarks-monitor/category',     element: <RemarksMonitorCategory /> },
      { path: 'todos',                        element: <AdminTodos /> },
      { path: 'team',                         element: <TeamPage /> },
      { path: 'org-chart',                    element: <OrgChart /> },
      { path: 'group-receiving',              element: <GroupReceiving /> },
      { path: 'profile',                      element: <Profile /> },
      { path: 'reports/trainer-utilization',  element: <TrainerUtilization /> },
      { path: 'reports/find-available-trainer', element: <TrainerAvailabilityFinder /> },
      { path: 'reports/trainer-dashboard',      element: <TrainerUtilizationDashboard /> },
      { path: 'reports/trainer-work-history',   element: <TrainerWorkHistory /> },
      { path: 'reschedules',                    element: <LectureReschedules /> },
      { path: 'schedule-changes',               element: <PrivateRoute superAdmin><ScheduleChangeLog /></PrivateRoute> },
      { path: 'holidays',                       element: <HolidaysManagement /> },
      { path: 'control',                      element: <LeaderDashboard /> },
      { path: 'reports/customer-services',    element: <SystemReports /> },
      { path: 'reports/education',            element: <EducationReports /> },
      { path: 'reports/trainer-salaries',     element: <PrivateRoute onlyUsername="admin"><TrainerSalaries /></PrivateRoute> },
      { path: 'salaries/trainers',            element: <PrivateRoute onlyUsername="admin"><TrainersPayroll /></PrivateRoute> },
      { path: 'reports/quality',              element: <QualityReports /> },
      { path: 'reports/quality-diagnostic',   element: <QualityDiagnostic /> },
      { path: 'reports/quality-snapshots',    element: <QualitySnapshots /> },
      { path: 'db-status',                     element: <PrivateRoute superAdmin><DbStatus /></PrivateRoute> },
      { path: 'reports/fix-report',           element: <FixReport /> },
      { path: 'reports/attendance-absence',   element: <AttendanceAbsenceReport /> },
      { path: 'distribution',                  element: <ClientDistribution /> },
      { path: 'pipeline',                      element: <AdminPipeline /> },
      { path: 'employee-progression',          element: <EmployeeProgression /> },
      { path: 'targets',                       element: <TargetsManagement /> },
      { path: 'settings',                      element: <PrivateRoute superAdmin><SystemSettings /></PrivateRoute> },
      { path: 'finance/sync',                  element: <PrivateRoute superAdmin><FinanceSync /></PrivateRoute> },
      { path: 'finance/matching',              element: <PrivateRoute superAdmin><FinanceMatching /></PrivateRoute> },
      { path: 'finance/lifecycle',             element: <PrivateRoute superAdmin><FinanceLifecycle /></PrivateRoute> },
      { path: 'clients',                       element: <Clients /> },
    ],
  },

  // ── Subscription Tracker (cs_*) routes ───────────────────────────
  // Accessible to any authenticated role; per-route visibility filtered server-side.
  {
    path: '/subscriptions',
    element: <PrivateRoute><AppShell /></PrivateRoute>,
    children: [
      { index: true,                element: <Navigate to="my-clients" replace /> },
      { path: 'my-clients',         element: <CsMyClients /> },
      { path: 'client/:phone',      element: <CsClientProfile /> },
      { path: 'dashboard',          element: <CsDashboard /> },
      { path: 'cs-department',      element: <DepartmentDeliveries /> },
      { path: 'deliveries/:dept',   element: <DepartmentDeliveries /> },
      { path: 'enrollment',         element: <Enrollment /> },
    ],
  },

  // ── Enrollment agent routes ───────────────────────────────────────
  {
    path: '/enrollment',
    element: <PrivateRoute allowedRoles={['enrollment', 'enrollment_leader', 'admin']}><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="pipeline" replace /> },
      { path: 'pipeline', element: <EnrollmentPipeline /> },
    ],
  },

  // ── Enrollment leader routes ──────────────────────────────────────
  {
    path: '/enrollment-leader',
    element: <PrivateRoute allowedRoles={['enrollment_leader', 'admin']}><AppShell /></PrivateRoute>,
    children: [
      { index: true, element: <Navigate to="pipeline" replace /> },
      { path: 'pipeline', element: <EnrollmentPipeline /> },
    ],
  },

  { path: '*', element: <Navigate to="/login" replace /> },
]);

export default router;
