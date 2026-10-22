import { useState } from "react";
import api from "../api/client";

export default function ExportViewModal({
  isOpen,
  onClose,
  project,
  issues = [],
  activeTab = "list",
  onSelectTab,
}) {
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  if (!isOpen) return null;

  async function handleExportXLSX() {
    if (!project?.id) return;
    setDownloadingXlsx(true);
    try {
      const response = await api.get(`/projects/${project.id}/export_xlsx/`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", `${project.key || "NEXO"}_Project_Tracker.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      onClose();
    } catch (err) {
      alert("Failed to generate Excel export. Please try again.");
    } finally {
      setDownloadingXlsx(false);
    }
  }

  async function handleExportCSV() {
    if (!project?.id) return;
    setDownloadingCsv(true);
    try {
      const response = await api.get(`/projects/${project.id}/export_csv/`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "text/csv;charset=utf-8;",
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", `${project.key || "NEXO"}_work_items.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      onClose();
    } catch (err) {
      alert("Failed to generate CSV export. Please try again.");
    } finally {
      setDownloadingCsv(false);
    }
  }

  function handleExportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(issues, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `${project?.key || 'NEXO'}_issues.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onClose();
  }

  function handleCopyJSON() {
    navigator.clipboard?.writeText(JSON.stringify(issues, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="jira-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            <div>
              <h2 className="jira-modal-title">Export & View Layouts</h2>
              <span className="jira-sub-key">Export {project?.name} data or switch project views</span>
            </div>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="jira-modal-body">
          {/* View Modes Section */}
          <div className="jira-section-title">Switch Project View</div>
          <div className="jira-views-grid">
            <button className={`jira-view-tile ${activeTab === "summary" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("summary"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
              <div><div className="jira-view-name">Summary</div><div className="jira-view-desc">Metrics & sprint completion overview</div></div>
            </button>
            <button className={`jira-view-tile ${activeTab === "list" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("list"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg></span>
              <div><div className="jira-view-name">List View</div><div className="jira-view-desc">Detailed spreadsheet table</div></div>
            </button>
            <button className={`jira-view-tile ${activeTab === "board" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("board"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="4" height="18" rx="1"/><rect x="10" y="3" width="4" height="18" rx="1"/><rect x="16" y="3" width="4" height="18" rx="1"/></svg></span>
              <div><div className="jira-view-name">Kanban Board</div><div className="jira-view-desc">Drag-and-drop workflow cards</div></div>
            </button>
            <button className={`jira-view-tile ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("calendar"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
              <div><div className="jira-view-name">Calendar</div><div className="jira-view-desc">Timeline and sprint deadlines</div></div>
            </button>
            <button className={`jira-view-tile ${activeTab === "backlog" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("backlog"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
              <div><div className="jira-view-name">Backlog</div><div className="jira-view-desc">Sprint planning & iteration buckets</div></div>
            </button>
            <button className={`jira-view-tile ${activeTab === "docs" ? "active" : ""}`} onClick={() => { onSelectTab && onSelectTab("docs"); onClose(); }}>
              <span className="jira-view-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
              <div><div className="jira-view-name">Project Docs</div><div className="jira-view-desc">PRDs, specs & retrospectives</div></div>
            </button>
          </div>

          <div className="jira-popover-divider" style={{ margin: "16px 0" }} />

          <div className="jira-section-title">Standardized NEXO Exports</div>
          <div className="jira-export-buttons-grid">
            {/* Canonical 5-Sheet Excel Workbook */}
            <button
              className="jira-export-card-btn"
              onClick={handleExportXLSX}
              disabled={downloadingXlsx}
              style={{ border: "1.5px solid #0052CC", background: "#F4F8FD" }}
            >
              <span className="jira-exp-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="8" y1="13" x2="16" y2="13"/>
                  <line x1="8" y1="17" x2="16" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </span>
              <div>
                <div className="jira-exp-title" style={{ color: "#0052CC", fontWeight: 700 }}>
                  {downloadingXlsx ? "Generating Workbook..." : "Canonical PMO Workbook (.xlsx)"}
                </div>
                <div className="jira-exp-sub">
                  5 standard sheets: Overview, Tasks, Milestones, Risks & Definitions
                </div>
              </div>
            </button>

            {/* Sanitized CSV */}
            <button className="jira-export-card-btn" onClick={handleExportCSV} disabled={downloadingCsv}>
              <span className="jira-exp-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00875A" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="8" y1="13" x2="16" y2="13"/>
                </svg>
              </span>
              <div>
                <div className="jira-exp-title">
                  {downloadingCsv ? "Preparing CSV..." : "Sanitized Work Items (CSV)"}
                </div>
                <div className="jira-exp-sub">Safe for Excel & Sheets with formula injection protection</div>
              </div>
            </button>

            <button className="jira-export-card-btn" onClick={handleExportJSON}>
              <span className="jira-exp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6554C0" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>
              <div><div className="jira-exp-title">Export to JSON</div><div className="jira-exp-sub">Structured payload for scripts & APIs</div></div>
            </button>

            <button className="jira-export-card-btn" onClick={handleCopyJSON}>
              <span className="jira-exp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
              <div><div className="jira-exp-title">{copiedJson ? "Copied to clipboard!" : "Copy JSON Payload"}</div><div className="jira-exp-sub">Quick copy to paste in tools</div></div>
            </button>
          </div>
        </div>

        <div className="jira-modal-footer">
          <button type="button" className="jira-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
