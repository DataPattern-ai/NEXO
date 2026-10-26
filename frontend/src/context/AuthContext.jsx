import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me/")
      .then((res) => setUser(res.data))
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.post("/auth/login/", { username: email, password });
    localStorage.setItem("token", res.data.token);
    setUser(res.data.user);
  }

  async function register(password, email, username) {
    const res = await api.post("/auth/register/", { password, email, username });
    return res.data;
  }

  async function verifyCode(email, code, purpose = "REGISTRATION") {
    const res = await api.post("/auth/verify-code/", { email, code, purpose });
    if (res.data?.token) {
      localStorage.setItem("token", res.data.token);
      setUser(res.data.user);
    }
    return res.data;
  }

  // Invitation link: signs the invited user straight in (no verification code).
  async function acceptInvite(token, payload = {}) {
    const res = await api.post("/auth/accept-invite/", { token, ...payload });
    localStorage.setItem("token", res.data.token);
    setUser(res.data.user);
    return res.data;
  }

  function logout() {
    localStorage.removeItem("token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, verifyCode, acceptInvite, logout }}>
      {children}
    </AuthContext.Provider>
  );

}

export function useAuth() {
  return useContext(AuthContext);
}
