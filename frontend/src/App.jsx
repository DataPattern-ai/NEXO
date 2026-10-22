import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProjectList from "./pages/ProjectList";
import Board from "./pages/Board";
import Dashboard from "./pages/Dashboard";
import Teams from "./pages/Teams";
import Tasks from "./pages/Tasks";
import InviteAccept from "./pages/InviteAccept";
import ErrorBoundary from "./components/ErrorBoundary";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ textAlign: "center", marginTop: 60 }}>Loading...</p>;
  if (!user) return <Navigate to="/login" />;
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/projects" element={<ProtectedRoute><ProjectList /></ProtectedRoute>} />
          <Route path="/projects/:projectId/board" element={<ProtectedRoute><Board /></ProtectedRoute>} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
          <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
