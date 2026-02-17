import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Chat from './pages/Chat';
import Knowledge from './pages/Knowledge';
import Agents from './pages/Agents';
import Settings from './pages/Settings';
import AdminLogin from './pages/AdminLogin';
import PublicChat from './pages/PublicChat';
import Home from './pages/Home';

// Auth Guard Component
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuth = localStorage.getItem('adminAuth') === 'true';
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/admin" state={{ from: location }} replace />;
  }

  return <Layout>{children}</Layout>;
};

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* PUBLIC ROUTES */}
        {/* Root is now the Public Directory/Home */}
        <Route path="/" element={<Home />} />
        
        {/* Public Chat Interface - No Auth Required */}
        <Route path="/chat/:agentId" element={<PublicChat />} />

        {/* ADMIN ROUTES */}
        {/* Admin Login is strictly at /admin */}
        <Route path="/admin" element={<AdminLogin />} />

        {/* Protected Dashboard Routes */}
        <Route path="/admin/dashboard" element={<RequireAuth><Chat /></RequireAuth>} />
        <Route path="/admin/knowledge" element={<RequireAuth><Knowledge /></RequireAuth>} />
        <Route path="/admin/agents" element={<RequireAuth><Agents /></RequireAuth>} />
        <Route path="/admin/settings" element={<RequireAuth><Settings /></RequireAuth>} />

        {/* Fallback - Redirect unknown routes to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;