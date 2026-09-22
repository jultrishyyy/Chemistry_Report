import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Login from './pages/Login';
import AppNav from './components/AppNav';
import SymbolPicker from './components/SymbolPicker';
import { AuthProvider, useAuth } from './auth';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { appTheme, APP_BG } from './theme';

// Each major screen is downloaded only when it is opened. Editors and PDF
// tooling are the largest modules and must not delay the login/list shell.
const RecordTemplateList = lazy(() => import('./pages/RecordTemplate/List'));
const RecordTemplateEditor = lazy(() => import('./pages/RecordTemplate/Editor'));
const LabTaskList = lazy(() => import('./pages/Lab/TaskList'));
const LabProjectList = lazy(() => import('./pages/Lab/ProjectList'));
const LabOrderDetail = lazy(() => import('./pages/Lab/OrderDetail'));
const LabRecord = lazy(() => import('./pages/Lab/Record'));
const MobileImageUpload = lazy(() => import('./pages/Mobile/ImageUpload'));
const ReportTemplateList = lazy(() => import('./pages/ReportTemplate/List'));
const ReportTemplateEditor = lazy(() => import('./pages/ReportTemplate/Editor'));
const ReportTemplateCoverEditor = lazy(() => import('./pages/ReportTemplate/CoverEditor'));
const ReportTemplateProjectEditor = lazy(() => import('./pages/ReportTemplate/ProjectEditor'));
const ReportDetail = lazy(() => import('./pages/Report/Detail'));
const ReportOrderList = lazy(() => import('./pages/Report/OrderList'));
const ReportWorkbench = lazy(() => import('./pages/Report/Workbench'));
const ReportPreviewEditor = lazy(() => import('./pages/Report/PreviewEditor'));
const ReportInstanceEditor = lazy(() => import('./pages/Report/InstanceEditor'));
const EquipmentLibrary = lazy(() => import('./pages/Equipment/Library'));
const AdminUsers = lazy(() => import('./pages/Admin/Users'));
const MyRoles = lazy(() => import('./pages/Account/MyRoles'));

const PageLoading = () => <div style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" /></div>;

function AppLayout() {
  const location = useLocation();
  const hideNav = location.pathname.includes('/editor') || location.pathname === '/lab/record' || location.pathname.startsWith('/m/');
  // 编辑器各自管理左右栏及 PDF 的内部滚动。禁止外层再生成一条页面滚动条，
  // 避免 macOS/部分浏览器的叠加式滚动条与右侧 PDF 滚动条重叠。
  const selfScrollingEditor = hideNav || location.pathname === '/report/edit';
  // 编辑器类页面是全幅自带布局，保持白底；列表/工作台类页面用浅灰底，白卡片更有层次
  const fullBleed = hideNav || location.pathname.startsWith('/report/');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!hideNav && <AppNav />}
      <div style={{ flex: 1, minHeight: 0, overflow: selfScrollingEditor ? 'hidden' : 'auto', background: fullBleed ? '#fff' : APP_BG }}>
        <Suspense fallback={<PageLoading />}><Routes>
          <Route path="/" element={<Navigate to="/record-templates" replace />} />
          <Route path="/record-templates" element={<RecordTemplateList />} />
          <Route path="/record-templates/editor" element={<RecordTemplateEditor />} />
          <Route path="/lab" element={<LabTaskList />} />
          <Route path="/lab/projects" element={<LabProjectList />} />
          <Route path="/lab/order/:orderNo" element={<LabOrderDetail />} />
          <Route path="/lab/record" element={<LabRecord />} />
          <Route path="/report-templates" element={<ReportTemplateList />} />
          <Route path="/report-templates/editor" element={<ReportTemplateEditor />} />
          <Route path="/report-templates/cover/editor" element={<ReportTemplateCoverEditor />} />
          <Route path="/report-templates/project/editor" element={<ReportTemplateProjectEditor />} />
          <Route path="/report" element={<ReportOrderList />} />
          <Route path="/report/order/:orderNo" element={<ReportWorkbench />} />
          <Route path="/report/preview" element={<ReportPreviewEditor />} />
          <Route path="/report/edit" element={<ReportInstanceEditor />} />
          <Route path="/report/legacy" element={<ReportDetail />} />
          <Route path="/equipment" element={<EquipmentLibrary />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/me/roles" element={<MyRoles />} />
          <Route path="/m/upload" element={<MobileImageUpload />} />
        </Routes></Suspense>
      </div>
      <SymbolPicker />
    </div>
  );
}

/** 登录门：未登录显示登录页，加载中显示 spinner，已登录进主布局。 */
function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" /></div>;
  if (!user) return <Login />;
  return <AppLayout />;
}

function App() {
  return (
    <ConfigProvider theme={appTheme} locale={zhCN}>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}

export default App;
