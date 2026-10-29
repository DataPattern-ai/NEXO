import axios from "axios";

// Dynamically use the same host that served the frontend
// Works for both localhost and LAN access (e.g. 10.169.235.240:5173)
const isDevServer = window.location.port && window.location.port !== "8000";
const API_BASE =
  import.meta.env.VITE_API_URL ||
  (isDevServer
    ? `${window.location.protocol}//${window.location.hostname}:8000/api`
    : "/api");

const api = axios.create({
  baseURL: API_BASE,
});

// Attach the auth token to every request automatically.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  return config;
});

let isRedirecting = false;

// Intercept responses to handle 401 Unauthorized (expired/revoked token) gracefully
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear dead credentials
      localStorage.removeItem("token");
      delete api.defaults.headers.common["Authorization"];

      // Notify AuthContext so application state updates immediately
      window.dispatchEvent(new CustomEvent("nexo:auth-expired"));

      // Avoid redirect loops if already on public auth pages
      const currentPath = window.location.pathname;
      const isPublic =
        currentPath.startsWith("/login") ||
        currentPath.startsWith("/register") ||
        currentPath.startsWith("/invite");

      if (!isPublic && !isRedirecting) {
        isRedirecting = true;
        const search = window.location.search || "";
        const fullCurrent = currentPath + search;
        window.location.href = `/login?expired=1&next=${encodeURIComponent(fullCurrent)}`;
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Downloads a file securely by making an authenticated request with the Authorization header.
 * Avoids putting long-lived tokens into query strings or exposing them in browser history/logs.
 */
export async function downloadFile(url, fallbackFilename = "download") {
  const res = await api.get(url, { responseType: "blob" });
  let filename = fallbackFilename;
  const disposition = res.headers?.["content-disposition"];
  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match && match[1]) {
      filename = match[1].replace(/['"]/g, "").trim();
    }
  }
  const blob = new Blob([res.data], {
    type: res.headers?.["content-type"] || "application/octet-stream",
  });
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
}

export default api;
