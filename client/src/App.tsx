import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import RecordTemplateList from './pages/RecordTemplate/List';
import RecordTemplateEditor from './pages/RecordTemplate/Editor';
import LabTaskList from './pages/Lab/TaskList';
import LabOrderDetail from './pages/Lab/OrderDetail';
import LabRecord from './pages/Lab/Record';
import MobileImageUpload from './pages/Mobile/ImageUpload';
import ReportTemplateList from './pages/ReportTemplate/List';
import ReportTemplateEditor from './pages/ReportTemplate/Editor';
import ReportTemplateCoverEditor from './pages/ReportTemplate/CoverEditor';
import ReportTemplateProjectEditor from './pages/ReportTemplate/ProjectEditor';
import ReportDetail from './pages/Report/Detail';
import ReportOrderList from './pages/Report/OrderList';
import ReportWorkbench from './pages/Report/Workbench';
import ReportPreviewEditor from './pages/Report/PreviewEditor';
import ReportInstanceEditor from './pages/Report/InstanceEditor';
import EquipmentLibrary from './pages/Equipment/Library';
import Login from './pages/Login';
import AdminUsers from './pages/Admin/Users';
import MyRoles from './pages/Account/MyRoles';
import AppNav from './components/AppNav';
import SymbolPicker from './components/SymbolPicker';
import { AuthProvider, useAuth } from './auth';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { appTheme, APP_BG } from './theme';

function AppLayout() {
  const location = useLocation();
  const hideNav = location.pathname.includes('/editor') || location.pathname === '/lab/record' || location.pathname.startsWith('/m/');
  // 编辑器类页面是全幅自带布局，保持白底；列表/工作台类页面用浅灰底，白卡片更有层次
  const fullBleed = hideNav || location.pathname.startsWith('/report/');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!hideNav && <AppNav />}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: fullBleed ? '#fff' : APP_BG }}>
        <Routes>
          <Route path="/" element={<Navigate to="/record-templates" replace />} />
          <Route path="/record-templates" element={<RecordTemplateList />} />
          <Route path="/record-templates/editor" element={<RecordTemplateEditor />} />
          <Route path="/lab" element={<LabTaskList />} />
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
        </Routes>
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
