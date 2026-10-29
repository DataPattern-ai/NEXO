import { useEffect, useState, useMemo } from "react";
import { userLabel } from "../utils/userLabel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";

// ── SVG Donut Pie Chart ──
function PieChart({ data }) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (!total) return <div className="db-pie-empty">No issues yet</div>;

  const COLORS = { TASK: "#0052CC", BUG: "#DE350B", STORY: "#00875A", EPIC: "#6554C0" };

  let cumAngle = -90;
  const slices = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([type, count]) => {
      const pct = count / total;
      const start = cumAngle;
      cumAngle += pct * 360;
      return { type, count, pct, start, end: cumAngle };
    });

  function toXY(deg, r = 80) {
    const rad = (deg * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  }

  function arc(start, end) {
    if (end - start >= 359.99)
      return `M ${100 + 80} 100 A 80 80 0 1 1 ${100 + 79.99} 100 Z`;
    const [sx, sy] = toXY(start);
    const [ex, ey] = toXY(end);
    return `M 100 100 L ${sx} ${sy} A 80 80 0 ${end - start > 180 ? 1 : 0} 1 ${ex} ${ey} Z`;
  }

  return (
    <div className="db-pie-wrap">
      <svg viewBox="0 0 200 200" className="db-pie-svg">
        {slices.map((s) => (
          <path key={s.type} d={arc(s.start, s.end)} fill={COLORS[s.type] || "#42526E"} opacity="0.92" />
        ))}
        <circle cx="100" cy="100" r="50" fill="#FFFFFF" />
        <text x="100" y="96" textAnchor="middle" fontSize="24" fontWeight="800" fill="#172B4D">{total}</text>
        <text x="100" y="114" textAnchor="middle" fontSize="11" fill="#6B778C">total issues</text>
      </svg>
      <div className="db-pie-legend">
        {slices.map((s) => (
          <div key={s.type} className="db-pie-legend-row">
            <span className="db-pie-dot" style={{ background: COLORS[s.type] || "#42526E" }} />
            <span className="db-pie-legend-label">{s.type}</span>
            <span className="db-pie-legend-count">{s.count}</span>
            <span className="db-pie-legend-pct">{Math.round(s.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Circular Progress Gauge ──
function CircularProgressGauge({ percent = 0, color = "#00875A", size = 140, strokeWidth = 12, label }) {
  const radius = (size / 2) - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="pmo-gauge-wrap" style={{ padding: size < 100 ? "4px 0" : "8px 0" }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={{ fill: "none", stroke: "#EBECF0", strokeWidth }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          style={{
            fill: "none",
            stroke: color,
            strokeWidth,
            strokeLinecap: "round",
            strokeDasharray: circumference,
            strokeDashoffset,
            transition: "stroke-dashoffset 0.6s ease",
          }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: size < 100 ? (size < 75 ? 13 : 16) : 26,
            fontWeight: 800,
            fill: "#172B4D",
            transform: "rotate(90deg)",
            transformOrigin: "center",
          }}
        >
          {percent}%
        </text>
      </svg>
      {label && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", marginTop: 4 }}>
          {label}
        </span>
      )}
    </div>
  );
}

const PRI_COLOR = { CRITICAL: "#DE350B", HIGH: "#FF5630", MEDIUM: "#FFAB00", LOW: "#36B37E" };
function PriBadge({ p }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: PRI_COLOR[p] || "#97A0AF", flexShrink: 0 }} title={p} />;
}

function formatDateSafe(val, options) {
  if (!val) return "—";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString(undefined, options || { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(val);
  }
}

function getAvatarInitials(name, fallback = "PJ") {
  if (!name || typeof name !== "string") return fallback;
  return name.trim().substring(0, 2).toUpperCase() || fallback;
}

function getMilestoneDelayInfo(title, intelligenceData) {
  if (!title || !intelligenceData) return null;
  const lower = title.toLowerCase();
  const delayed = intelligenceData.delays_summary?.delayed_deliverables || [];
  for (const d of delayed) {
    if (d.name && (lower.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(lower))) {
      return d;
    }
  }
  const ranked = intelligenceData.ranked_deliverables || [];
  for (const r of ranked) {
    if (r.title && (lower.includes(r.title.toLowerCase()) || r.title.toLowerCase().includes(lower))) {
      return r;
    }
  }
  return null;
}

function Card({ title, subtitle, icon, count, badge, actionBtn, children, style }) {
  return (
    <div className="db-card" style={style}>
      <div className="db-card-header" style={{ alignItems: subtitle ? "flex-start" : "center" }}>
        <span className="db-card-icon" style={{ marginTop: subtitle ? 2 : 0 }}>{icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="db-card-title">{title}</h3>
          {subtitle && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6B778C", fontWeight: 400, lineHeight: 1.4 }}>
              {subtitle}
            </p>
          )}
        </div>
        {badge && <span className="db-card-proj-badge">{badge}</span>}
        {count !== undefined && <span className="db-card-badge">{count}</span>}
        {actionBtn && <div style={{ marginLeft: "auto" }}>{actionBtn}</div>}
      </div>
      <div className="db-card-body">{children}</div>
    </div>
  );
}

// ── Upload Document Modal Component ──
function UploadDocModal({ isOpen, onClose, projectId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [templateType, setTemplateType] = useState("STATUS");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState("file"); // 'file' or 'text'

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file && !content.trim()) {
      alert("Please choose a file or enter document content.");
      return;
    }

    if (file && file.size > 4.5 * 1024 * 1024) {
      alert(`"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 4.5 MB serverless upload limit. Please select a smaller file.`);
      return;
    }

    setUploading(true);
    const formData = new FormData();
    if (file) formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    formData.append("template_type", templateType);
    if (content.trim()) formData.append("content", content.trim());

    try {
      const res = await api.post(`/projects/${projectId}/upload_doc/`, formData);
      onUploaded(res.data);
      onClose();
    } catch (err) {
      alert("Failed to upload and analyze document. " + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="jira-modal-header">
          <div className="jira-modal-title-group">
            <h2 className="jira-modal-title">Upload Project Document or Report</h2>
            <span className="jira-sub-key">Auto-extracts risks, milestones, updates, and decisions for the Dashboard</span>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="jira-modal-body" style={{ gap: 14 }}>
            {/* Input Mode Toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                className={`jira-btn-secondary-sm ${mode === "file" ? "active" : ""}`}
                style={{ fontWeight: mode === "file" ? 700 : 500, borderColor: mode === "file" ? "#0052CC" : undefined }}
                onClick={() => setMode("file")}
              >
                Upload File (Excel, Word, PDF, MD)
              </button>
              <button
                type="button"
                className={`jira-btn-secondary-sm ${mode === "text" ? "active" : ""}`}
                style={{ fontWeight: mode === "text" ? 700 : 500, borderColor: mode === "text" ? "#0052CC" : undefined }}
                onClick={() => setMode("text")}
              >
                Direct Text / Markdown
              </button>
            </div>

            {mode === "file" ? (
              <div style={{ border: "2px dashed #DFE1E6", borderRadius: 8, padding: "24px 16px", textAlign: "center", background: "#FAFBFC" }}>
                <input
                  type="file"
                  id="pmo-doc-upload-file"
                  accept=".xlsx,.xls,.docx,.pdf,.md,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      if (!title) setTitle(f.name.rsplit ? f.name.rsplit(".", 1)[0] : f.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                />
                <label htmlFor="pmo-doc-upload-file" style={{ cursor: "pointer", display: "block" }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="1.8" style={{ margin: "0 auto 8px" }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#172B4D" }}>
                    {file ? file.name : "Click to select a project document"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6B778C", marginTop: 4 }}>
                    Supports <strong>Excel (.xlsx)</strong>, <strong>Word (.docx)</strong>, <strong>PDF</strong>, and <strong>Markdown (.md)</strong>
                  </div>
                </label>
              </div>
            ) : (
              <div>
                <label className="jira-field-label">Document Content (Markdown)</label>
                <textarea
                  className="jira-textarea"
                  rows={8}
                  placeholder="Paste meeting notes, status reports, or project specs..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: 13 }}
                />
              </div>
            )}

            <div>
              <label className="jira-field-label">Document Title (Optional)</label>
              <input
                type="text"
                className="jira-input"
                placeholder="e.g. Q4 Sprint Plan, Weekly Status Report Oct 6"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="jira-field-label">Document Purpose / Type</label>
              <select
                className="jira-select"
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value)}
              >
                <option value="STATUS">Project Status / Weekly Report</option>
                <option value="TIMELINE">Timeline & Project Plan / Milestones</option>
                <option value="RESOURCE">Resource / Team Allocation Document</option>
                <option value="PRD">Product Requirements Document (PRD)</option>
                <option value="ARCHITECTURE">Architecture & System Design</option>
                <option value="MEETING">Meeting Notes & Decisions</option>
                <option value="RETRO">Sprint Retrospective</option>
                <option value="CUSTOM">Custom Project Document (Auto-classify)</option>
              </select>
            </div>
          </div>

          <div className="jira-modal-footer">
            <button type="button" className="jira-btn-secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button type="submit" className="jira-btn-primary" disabled={uploading}>
              {uploading ? "Analyzing Document…" : "Upload & Analyze Document"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD PAGE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("ALL");

  // Project PMO Intelligence Data
  const [intelligenceData, setIntelligenceData] = useState(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState("");
  const [refreshingIntel, setRefreshingIntel] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [riskFilter, setRiskFilter] = useState("ALL"); // ALL, BLOCKER, RISK, CHALLENGE, DEPENDENCY
  const [updatesTab, setUpdatesTab] = useState("WEEKLY"); // WEEKLY, DELIVERIES, DECISIONS, ACTIVITY
  const [deliverablesTab, setDeliverablesTab] = useState("BACKLOG"); // BACKLOG, PIPELINE
  const [expandedMilestone, setExpandedMilestone] = useState(null);
  const [deliverablesStatusFilter, setDeliverablesStatusFilter] = useState("ALL"); // ALL, COMPLETED, IN_PROGRESS, PLANNED, DELAYED
  const [milestoneFilter, setMilestoneFilter] = useState("ALL"); // ALL, DELAYED, UPCOMING, COMPLETED
  const [highlightedDeliverable, setHighlightedDeliverable] = useState(null); // title of deliverable to highlight
  const [selectedWorkstream, setSelectedWorkstream] = useState("ALL"); // ALL, Zoho Requirement, Database requirements, etc.

  // Load global dashboard overview
  function loadGlobalData() {
    api.get("/auth/dashboard/")
      .then((res) => {
        setData(res.data);
        const urlProjectId = searchParams.get("project");
        if (urlProjectId) {
          setSelectedProjectId(urlProjectId);
        } else if (res.data.my_projects?.length === 1) {
          setSelectedProjectId(String(res.data.my_projects[0].id));
        }
      })
      .catch(() => setError("Could not load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadGlobalData();
  }, []);

  // Sync selected project with URL query param
  useEffect(() => {
    const urlProjectId = searchParams.get("project");
    if (urlProjectId) {
      if (urlProjectId !== selectedProjectId) {
        setSelectedProjectId(urlProjectId);
      }
    } else {
      if (selectedProjectId !== "ALL") {
        setSelectedProjectId("ALL");
      }
    }
  }, [searchParams]);

  // Load Project PMO Intelligence when specific project is selected
  function loadProjectIntelligence(projId) {
    if (!projId || projId === "ALL") {
      setIntelligenceData(null);
      setIntelError("");
      return;
    }
    setIntelLoading(true);
    setIntelError("");
    setIntelligenceData(null);
    api.get(`/projects/${projId}/intelligence/`)
      .then((res) => {
        setIntelligenceData(res.data);
        if (res.data?.weekly_comparison?.has_weekly_data) {
          setUpdatesTab("WEEKLY");
        } else if (res.data?.recent_updates?.completed_work?.length > 0) {
          setUpdatesTab("DELIVERIES");
        }
      })
      .catch((err) => {
        console.error("Error loading project intelligence", err);
        setIntelError(err.response?.data?.error || err.message || "Failed to load project intelligence.");
      })
      .finally(() => setIntelLoading(false));
  }

  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== "ALL") {
      loadProjectIntelligence(selectedProjectId);
    } else {
      setIntelligenceData(null);
      setIntelError("");
    }
  }, [selectedProjectId]);

  // Manual Re-sync action
  async function handleRefreshIntelligence() {
    if (!selectedProjectId || selectedProjectId === "ALL") return;
    setRefreshingIntel(true);
    setIntelError("");
    try {
      const res = await api.post(`/projects/${selectedProjectId}/refresh_intelligence/`);
      setIntelligenceData(res.data);
      loadGlobalData();
    } catch (err) {
      alert("Failed to refresh project intelligence. " + (err.response?.data?.error || err.message || ""));
    } finally {
      setRefreshingIntel(false);
    }
  }

  // Memoized executive summary bullet items (robust against list, string, or json repr)
  const summaryBullets = useMemo(() => {
    const raw = intelligenceData?.executive_summary;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((s) => String(s).trim()).filter(Boolean);
    }
    if (typeof raw === "string") {
      if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
          const parsed = JSON.parse(raw.replace(/'/g, '"'));
          if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
        } catch {}
      }
      if (raw.includes("\n\n")) return raw.split("\n\n").map((s) => s.trim()).filter(Boolean);
      if (raw.includes("\n- ")) return raw.split("\n- ").map((s) => s.trim()).filter(Boolean);
      if (raw.includes("\n* ")) return raw.split("\n* ").map((s) => s.trim()).filter(Boolean);
      if (raw.includes("\n")) return raw.split("\n").map((s) => s.trim()).filter(Boolean);
      return [raw.trim()];
    }
    return [String(raw)];
  }, [intelligenceData?.executive_summary]);

  function handleCopyBrief() {
    if (!summaryBullets.length) return;
    const textToCopy = summaryBullets.join("\n\n");
    navigator.clipboard?.writeText(textToCopy);
    setCopiedBrief(true);
    setTimeout(() => setCopiedBrief(false), 2000);
  }

  const selectedProject = useMemo(() => {
    if (selectedProjectId === "ALL") return null;
    const fromList = data?.my_projects?.find((p) => String(p.id) === String(selectedProjectId));
    if (fromList) return fromList;
    if (intelligenceData?.project && String(intelligenceData.project.id) === String(selectedProjectId)) {
      return intelligenceData.project;
    }
    return null;
  }, [data, selectedProjectId, intelligenceData]);

  // Filtered Risks & Blockers
  const filteredRisks = useMemo(() => {
    if (!intelligenceData?.challenges_and_risks) return [];
    if (riskFilter === "ALL") return intelligenceData.challenges_and_risks;
    return intelligenceData.challenges_and_risks.filter((r) => r.type === riskFilter);
  }, [intelligenceData, riskFilter]);

  // Count by Type for pie chart
  const pieData = useMemo(() => {
    if (selectedProjectId !== "ALL" && intelligenceData?.workstreams) {
      const counts = { TASK: 0, BUG: 0, STORY: 0, EPIC: 0 };
      intelligenceData.workstreams.forEach((w) => {
        if (counts[w.type] !== undefined) counts[w.type] = w.total;
      });
      return counts;
    }
    return data?.issue_type_counts || {};
  }, [selectedProjectId, intelligenceData, data]);

  // Milestone counts & filtering
  const milestoneCounts = useMemo(() => {
    const list = intelligenceData?.timeline?.milestones || [];
    let delayed = 0, upcoming = 0, completed = 0;
    list.forEach((m) => {
      const delayInfo = getMilestoneDelayInfo(m.title, intelligenceData);
      const isDel = m.status === "DELAYED" || (m.extension_days > 0) || (delayInfo?.extension_days > 0);
      if (m.status === "COMPLETED") completed++;
      else if (isDel) delayed++;
      else upcoming++;
    });
    return { all: list.length, delayed, upcoming, completed };
  }, [intelligenceData]);

  const filteredMilestones = useMemo(() => {
    const list = intelligenceData?.timeline?.milestones || [];
    if (milestoneFilter === "ALL") return list;
    return list.filter((m) => {
      const delayInfo = getMilestoneDelayInfo(m.title, intelligenceData);
      const isDel = m.status === "DELAYED" || (m.extension_days > 0) || (delayInfo?.extension_days > 0);
      if (milestoneFilter === "DELAYED") return isDel;
      if (milestoneFilter === "COMPLETED") return m.status === "COMPLETED";
      if (milestoneFilter === "UPCOMING") return !isDel && m.status !== "COMPLETED";
      return true;
    });
  }, [intelligenceData, milestoneFilter]);

  // Deliverables counts & filtering with workstream support
  const allDeliverablesList = useMemo(() => {
    return intelligenceData?.ranked_deliverables || intelligenceData?.deliverables || [];
  }, [intelligenceData]);

  const workstreamFilteredDeliverables = useMemo(() => {
    if (!selectedWorkstream || selectedWorkstream === "ALL") return allDeliverablesList;
    return allDeliverablesList.filter((d) => {
      const ws = d.workstream || d.phase || "";
      if (selectedWorkstream === "Operational Tasks") {
        return d.record_type === "OPERATIONAL_TASK" || ws === "Operational Tasks" || ws.toLowerCase().includes("regular");
      }
      return ws.toLowerCase() === selectedWorkstream.toLowerCase() ||
             (selectedWorkstream === "Zoho Requirement" && ws.toLowerCase().includes("zoho")) ||
             (selectedWorkstream === "Database requirements" && ws.toLowerCase().includes("database"));
    });
  }, [allDeliverablesList, selectedWorkstream]);

  const deliverableCounts = useMemo(() => {
    let completed = 0, inProgress = 0, planned = 0, delayed = 0;
    workstreamFilteredDeliverables.forEach((d) => {
      if (d.status === "COMPLETED") completed++;
      else if (d.status === "IN_PROGRESS") inProgress++;
      else planned++;
      if (d.has_extension || (d.extension_days > 0)) delayed++;
    });
    return { all: workstreamFilteredDeliverables.length, completed, inProgress, planned, delayed };
  }, [workstreamFilteredDeliverables]);

  const filteredDeliverables = useMemo(() => {
    if (deliverablesStatusFilter === "ALL") return workstreamFilteredDeliverables;
    if (deliverablesStatusFilter === "COMPLETED") return workstreamFilteredDeliverables.filter((d) => d.status === "COMPLETED");
    if (deliverablesStatusFilter === "IN_PROGRESS") return workstreamFilteredDeliverables.filter((d) => d.status === "IN_PROGRESS");
    if (deliverablesStatusFilter === "PLANNED") return workstreamFilteredDeliverables.filter((d) => d.status === "PLANNED" || d.status === "TODO" || d.status === "NOT_STARTED" || d.status === "IN_REVIEW");
    if (deliverablesStatusFilter === "DELAYED") return workstreamFilteredDeliverables.filter((d) => d.has_extension || (d.extension_days > 0));
    return workstreamFilteredDeliverables;
  }, [workstreamFilteredDeliverables, deliverablesStatusFilter]);

  // Architectural Pipeline Stages
  const pipelineStages = useMemo(() => {
    const items = allDeliverablesList;
    if (!items.length) return [];
    
    const stages = [
      {
        id: "ingestion",
        name: "Stage 1: Raw Ingestion",
        desc: "Landing operational datasets into Bronze object storage",
        badge: "Bronze Medallion",
        color: "#B07238",
        items: items.filter((i) => {
          const l = (i.title || "").toLowerCase();
          return l.includes("raw") || l.includes("bronze") || l.includes("ingestion");
        }),
      },
      {
        id: "cleansing",
        name: "Stage 2: Cleansing & Standardization",
        desc: "Formatting, validation schemas, and Silver medallion enrichment",
        badge: "Silver Medallion",
        color: "#5E6C84",
        items: items.filter((i) => {
          const l = (i.title || "").toLowerCase();
          return l.includes("formatted") || l.includes("silver") || l.includes("clean");
        }),
      },
      {
        id: "analytics",
        name: "Stage 3: Aggregations & Analytics",
        desc: "Gold dimension marts, KPI models, and executive dashboards",
        badge: "Gold Medallion",
        color: "#FFAB00",
        items: items.filter((i) => {
          const l = (i.title || "").toLowerCase();
          return l.includes("gold") || l.includes("analytic") || l.includes("report") || l.includes("aggregation");
        }),
      },
    ];

    const categorizedTitles = new Set(stages.flatMap((s) => s.items.map((i) => i.title)));
    const otherItems = items.filter((i) => !categorizedTitles.has(i.title));
    if (otherItems.length) {
      stages.push({
        id: "other",
        name: "Stage 4: Cross-Cutting & Integrations",
        desc: "Downstream integration endpoints and auxiliary pipelines",
        badge: "Auxiliary",
        color: "#0052CC",
        items: otherItems,
      });
    }
    return stages.filter((s) => s.items.length > 0);
  }, [allDeliverablesList]);

  const projBadge = selectedProject ? `${selectedProject.key} · ${selectedProject.name}` : "Portfolio Overview";

  return (
    <div className="jira-app-shell">
      <Navbar />
      <main className="jira-workspace-main" style={{ background: "#F4F5F7", minHeight: "100vh" }}>

        {/* ── Top Bar & Controls ── */}
        <div className="pmo-top-banner">
          <div className="pmo-top-left">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#172B4D", margin: 0 }}>
                  {selectedProject ? selectedProject.name : "Portfolio Intelligence Dashboard"}
                </h1>
                {selectedProject && (
                  <span className="jira-summary-key-pill">{selectedProject.key}</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "#6B778C", margin: "3px 0 0" }}>
                {selectedProject
                  ? `Lead: ${intelligenceData?.project?.created_by || selectedProject?.created_by?.username || selectedProject?.created_by || "Admin"} • Created: ${formatDateSafe(selectedProject?.created_at || intelligenceData?.project?.created_at)}`
                  : `Executive overview across ${data?.my_projects?.length || 0} active workspace projects`}
              </p>
            </div>

            {/* Project Quick Selector Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                className="jira-select-sm"
                style={{ fontWeight: 600, padding: "6px 12px", background: "#FFFFFF", cursor: "pointer" }}
                value={selectedProjectId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedProjectId(val);
                  setSearchParams(val === "ALL" ? {} : { project: val });
                }}
              >
                <option value="ALL">🌐 All Projects (Portfolio View)</option>
                {data?.my_projects?.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.key} - {p.name}
                  </option>
                ))}
                {selectedProjectId !== "ALL" && !data?.my_projects?.some((p) => String(p.id) === String(selectedProjectId)) && (
                  <option value={selectedProjectId}>
                    {selectedProject ? `${selectedProject.key} - ${selectedProject.name}` : `Project #${selectedProjectId}`}
                  </option>
                )}
              </select>

              {/* RAG Status Pill if Project View */}
              {selectedProjectId !== "ALL" && intelligenceData?.health && (
                <div
                  className={`pmo-rag-pill ${(intelligenceData.health.status || "ON_TRACK").toLowerCase()}`}
                  title={intelligenceData.health.rationale}
                >
                  <span className="pmo-rag-dot" />
                  <span>{intelligenceData.health.label || "Status"}</span>
                </div>
              )}

              {/* Current Phase Pill */}
              {selectedProjectId !== "ALL" && intelligenceData?.current_phase && (
                <div className="pmo-phase-pill" title="Current Active Workstream / Phase">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span>{intelligenceData.current_phase}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selectedProjectId !== "ALL" && (
              <>
                <button
                  className="jira-btn-secondary-sm"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px" }}
                  onClick={handleRefreshIntelligence}
                  disabled={refreshingIntel}
                  title="Re-scan documents and synchronize intelligence"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{ animation: refreshingIntel ? "db-spin 1s linear infinite" : "none" }}
                  >
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>{refreshingIntel ? "Syncing…" : "Sync Intelligence"}</span>
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#0052CC", color: "#FFFFFF", borderColor: "#0052CC" }}
                  onClick={() => setShowUploadModal(true)}
                  title="Upload Excel, Word, PDF or Markdown documents"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>Upload Document</span>
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ padding: "7px 14px" }}
                  onClick={() => {
                    setSelectedProjectId("ALL");
                    setSearchParams({});
                  }}
                >
                  All Projects
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ padding: "7px 14px" }}
                  onClick={() => navigate(`/projects/${selectedProjectId}/board`)}
                >
                  Open Board →
                </button>
              </>
            )}
          </div>
        </div>

        {/* Global Loading Spinner */}
        {(loading || (intelLoading && !intelligenceData)) && (
          <div className="db-loading">
            <div className="db-spinner" />
            Loading project intelligence overview…
          </div>
        )}

        {error && (
          <div className="jira-auth-alert-error" style={{ margin: "24px" }}>
            <div className="jira-auth-alert-msg">{error}</div>
          </div>
        )}

        {/* Project Intelligence Load Error Banner */}
        {selectedProjectId !== "ALL" && !intelLoading && intelError && (
          <div style={{ margin: "24px", padding: "24px", background: "#FFFFFF", border: "1px solid #FFBDAD", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#DE350B", fontWeight: 700, marginBottom: 8 }}>
              ⚠️ Unable to Load Project Intelligence
            </div>
            <p style={{ color: "#6B778C", fontSize: 13, marginBottom: 16 }}>
              {intelError}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                className="jira-btn-primary"
                onClick={() => loadProjectIntelligence(selectedProjectId)}
              >
                Retry
              </button>
              <button
                className="jira-btn-secondary"
                onClick={() => {
                  setSelectedProjectId("ALL");
                  setSearchParams({});
                }}
              >
                Return to Portfolio View
              </button>
            </div>
          </div>
        )}

        {/* Project Intelligence Empty State */}
        {selectedProjectId !== "ALL" && !intelLoading && !intelligenceData && !intelError && !loading && (
          <div style={{ margin: "24px", padding: "32px", background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#172B4D", marginBottom: 8 }}>
              No Intelligence Data Available Yet
            </div>
            <p style={{ color: "#6B778C", fontSize: 13, maxWidth: 480, margin: "0 auto 16px" }}>
              Click 'Sync Intelligence' to scan project documents, tickets, and timelines into the dashboard.
            </p>
            <button
              className="jira-btn-primary"
              onClick={handleRefreshIntelligence}
              disabled={refreshingIntel}
            >
              {refreshingIntel ? "Syncing Intelligence…" : "Sync Intelligence"}
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            MODE A: SPECIFIC PROJECT INTELLIGENCE DASHBOARD
            ══════════════════════════════════════════════════════════════════════ */}
        {selectedProjectId !== "ALL" && intelligenceData && (
          <div className="db-grid" style={{ paddingTop: 20 }}>

            {/* ── 1. AI Executive Project Summary ── */}
            <Card
              title="Executive Project Briefing (AI Synthesized)"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>}
              badge="Cross-Source Synthesis"
              actionBtn={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {(() => {
                    const telem = intelligenceData.ai_telemetry || intelligenceData.telemetry;
                    const isCached = telem?.served_from_cache ?? telem?.cache_hit ?? true;
                    const latencyMs = telem?.latency_ms ?? 4;
                    const modelName = telem?.serving_model || telem?.model || "Llama 3.3 70B";
                    const shortModel = modelName.includes(".") ? modelName.split(".").pop() : (modelName.includes("/") ? modelName.split("/").pop() : modelName);
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: isCached ? "#E3FCEF" : "#DEEBFF",
                            color: isCached ? "#006644" : "#0747A6",
                            border: `1px solid ${isCached ? "#ABF5D1" : "#B3D4FF"}`,
                            borderRadius: 12,
                            padding: "2px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                          title={isCached ? `Served from persistent cache in ${latencyMs}ms (0 redundant LLM calls)` : `Generated via Databricks Model Serving in ${latencyMs}ms`}
                        >
                          <span>{isCached ? "⚡" : "🤖"}</span>
                          <span>{isCached ? `Cached (${latencyMs}ms)` : `Live AI (${latencyMs}ms)`}</span>
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            color: "#42526E",
                            background: "#EBECF0",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontWeight: 600
                          }}
                          title={`AI Model: ${modelName}`}
                        >
                          {shortModel}
                        </span>
                      </div>
                    );
                  })()}
                  <button
                    className="jira-btn-secondary-sm"
                    style={{ fontSize: 11, padding: "3px 10px" }}
                    onClick={handleCopyBrief}
                    title="Copy executive brief to clipboard"
                  >
                    {copiedBrief ? "Copied!" : "Copy Brief"}
                  </button>
                </div>
              }
              style={{ gridColumn: "1 / -1" }}
            >
              <div className="pmo-brief-box" style={{ padding: "16px 20px" }}>
                {summaryBullets.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {summaryBullets.map((para, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "8px 12px",
                          background: "#FFFFFF",
                          border: "1px solid #EBECF0",
                          borderRadius: 6,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: "#172B4D"
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "#DEEBFF",
                            color: "#0747A6",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                            flexShrink: 0,
                            marginTop: 1
                          }}
                        >
                          {idx + 1}
                        </span>
                        <div
                          style={{ flex: 1 }}
                          dangerouslySetInnerHTML={{
                            __html: para.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "#6B778C", margin: 0 }}>No summary generated yet. Click 'Sync Intelligence' to analyze.</p>
                )}

                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #DFE1E6", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#6B778C", flexWrap: "wrap", gap: 6 }}>
                  <span>Synthesized from {intelligenceData.progress_metrics?.total_issues ?? 0} issues & {intelligenceData.recent_documents?.length ?? 0} project documents</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {intelligenceData.weekly_comparison?.current_week?.period && (
                      <span><strong>Reporting Period:</strong> {intelligenceData.weekly_comparison.current_week.period}</span>
                    )}
                    <span><strong>Last synced:</strong> {intelligenceData.last_synced_at ? formatDateSafe(intelligenceData.last_synced_at, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) : "Recently"}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── 2. Individual Completion Rate Cards & Performance Tracking ── */}
            <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                    Delivery Performance & Completion Rate Tracking
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B778C" }}>
                    Track individual deliverable completion rates, in-progress velocity, and active schedule extensions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${selectedProjectId}/board?tab=docs&docTab=manifest`)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#FFFFFF",
                    border: "1px solid #DFE1E6",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0052CC",
                    cursor: "pointer",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  View Audit Manifest & Governance →
                </button>
              </div>

              {/* 4 Individual Completion Rate Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
                {/* Rate Card 1: Overall Project Completion */}
                <div
                  className="db-card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: "pointer",
                    position: "relative",
                    border: deliverablesStatusFilter === "ALL" && deliverablesTab === "BACKLOG" ? "2px solid #0052CC" : "1px solid #E1E5EB",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => {
                    setDeliverablesStatusFilter("ALL");
                    setDeliverablesTab("BACKLOG");
                  }}
                  title="Click to view all deliverables in Backlog"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Overall Completion</span>
                    <span
                      className={`pmo-rag-pill ${(intelligenceData.health?.status || "ON_TRACK").toLowerCase()}`}
                      style={{ fontSize: 10, padding: "1px 7px" }}
                    >
                      {intelligenceData.health?.label || "Status"}
                    </span>
                  </div>
                  <CircularProgressGauge
                    percent={intelligenceData.completion_percent || 0}
                    color={intelligenceData.health?.badge_color || "#00875A"}
                    size={94}
                    strokeWidth={9}
                  />
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#172B4D", marginTop: 8 }}>
                    {intelligenceData.completion_percent || 0}% Completed
                  </div>
                  <div style={{ fontSize: 11.5, color: "#42526E", marginTop: 2 }}>
                    <strong>{intelligenceData.progress_metrics?.plan_tasks_done ?? intelligenceData.progress_metrics?.done_issues ?? 0}</strong> of <strong>{intelligenceData.progress_metrics?.plan_tasks_total ?? intelligenceData.progress_metrics?.total_issues ?? 0}</strong> resolved
                  </div>
                  <span style={{ fontSize: 10.5, color: "#0052CC", fontWeight: 600, marginTop: 8 }}>
                    {deliverablesStatusFilter === "ALL" && deliverablesTab === "BACKLOG" ? "● Showing All in Backlog" : "Click to view all →"}
                  </span>
                </div>

                {/* Rate Card 2: Workstream Standing & Progress */}
                <div
                  className="db-card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: "pointer",
                    position: "relative",
                    border: "1px solid #E1E5EB",
                    background: "#FFFFFF",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => {
                    setDeliverablesTab("BACKLOG");
                  }}
                  title="Click to view workstream details in Deliverables backlog"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#00875A", textTransform: "uppercase" }}>Workstream Standing</span>
                    <span style={{ background: "#E3FCEF", color: "#006644", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4 }}>
                      {intelligenceData.workstreams && intelligenceData.workstreams.length > 1 ? `${intelligenceData.workstreams.length} Streams` : "✓ Verified"}
                    </span>
                  </div>
                  {intelligenceData.workstreams && intelligenceData.workstreams.length > 1 ? (
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, margin: "6px 0", flex: 1, justifyContent: "center" }}>
                      {intelligenceData.workstreams.slice(0, 3).map((ws, wIdx) => {
                        const wsColor = ws.percent >= 98 ? "#00875A" : (ws.percent >= 80 ? "#0052CC" : "#FF8B00");
                        return (
                          <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#172B4D" }}>
                              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                                {ws.name}
                              </span>
                              <strong style={{ color: wsColor }}>
                                {ws.percent}% ({ws.done}/{ws.total})
                              </strong>
                            </div>
                            <div style={{ height: 4, width: "100%", background: "#EBECF0", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${ws.percent}%`, background: wsColor, borderRadius: 2 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <CircularProgressGauge
                        percent={intelligenceData.delivery_metrics?.completed?.percent ?? (intelligenceData.completion_percent || 0)}
                        color="#00875A"
                        size={94}
                        strokeWidth={9}
                      />
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#00875A", marginTop: 8 }}>
                        {intelligenceData.delivery_metrics?.completed?.percent ?? (intelligenceData.completion_percent || 0)}% Rate
                      </div>
                      <div style={{ fontSize: 11.5, color: "#42526E", marginTop: 2 }}>
                        <strong>{intelligenceData.delivery_metrics?.completed?.count ?? (intelligenceData.progress_metrics?.plan_tasks_done || 0)}</strong> of <strong>{intelligenceData.delivery_metrics?.completed?.total ?? (intelligenceData.progress_metrics?.plan_tasks_total || 0)}</strong> deliverables
                      </div>
                    </>
                  )}
                  <span style={{ fontSize: 10.5, color: "#00875A", fontWeight: 700, marginTop: 4 }}>
                    {intelligenceData.workstreams && intelligenceData.workstreams.length > 1 ? "Inspect workstream breakdown →" : (deliverablesStatusFilter === "COMPLETED" ? "✓ Filtering Completed" : "Click to filter completed →")}
                  </span>
                </div>

                {/* Rate Card 3: In-Progress Execution Rate */}
                <div
                  className="db-card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: "pointer",
                    position: "relative",
                    border: deliverablesStatusFilter === "IN_PROGRESS" ? "2px solid #0052CC" : "1px solid #E1E5EB",
                    background: deliverablesStatusFilter === "IN_PROGRESS" ? "#F5F8FF" : "#FFFFFF",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => {
                    setDeliverablesStatusFilter(deliverablesStatusFilter === "IN_PROGRESS" ? "ALL" : "IN_PROGRESS");
                    setDeliverablesTab("BACKLOG");
                  }}
                  title="Click to filter in-progress deliverables in Backlog"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#0052CC", textTransform: "uppercase" }}>In-Progress Velocity</span>
                    <span style={{ background: "#DEEBFF", color: "#0747A6", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4 }}>
                      ⚙️ Active
                    </span>
                  </div>
                  <CircularProgressGauge
                    percent={intelligenceData.delivery_metrics?.in_progress?.percent ?? 0}
                    color="#0052CC"
                    size={94}
                    strokeWidth={9}
                  />
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0052CC", marginTop: 8 }}>
                    {intelligenceData.delivery_metrics?.in_progress?.percent ?? 0}% In Dev
                  </div>
                  <div style={{ fontSize: 11.5, color: "#42526E", marginTop: 2 }}>
                    <strong>{intelligenceData.delivery_metrics?.in_progress?.count ?? 0}</strong> of <strong>{intelligenceData.delivery_metrics?.in_progress?.total ?? 0}</strong> deliverables active
                  </div>
                  <span style={{ fontSize: 10.5, color: "#0052CC", fontWeight: 700, marginTop: 8 }}>
                    {deliverablesStatusFilter === "IN_PROGRESS" ? "⚙️ Filtering In Progress" : "Click to filter active →"}
                  </span>
                </div>

                {/* Rate Card 4: Planned & Backlog Rate */}
                <div
                  className="db-card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    cursor: "pointer",
                    position: "relative",
                    border: deliverablesStatusFilter === "PLANNED" ? "2px solid #6554C0" : "1px solid #E1E5EB",
                    background: deliverablesStatusFilter === "PLANNED" ? "#F8F7FF" : "#FFFFFF",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => {
                    setDeliverablesStatusFilter(deliverablesStatusFilter === "PLANNED" ? "ALL" : "PLANNED");
                    setDeliverablesTab("BACKLOG");
                  }}
                  title="Click to filter planned deliverables in Backlog"
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6554C0", textTransform: "uppercase" }}>Planned & Backlog</span>
                    <span style={{ background: "#EAE6FF", color: "#403294", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4 }}>
                      📅 Queued
                    </span>
                  </div>
                  <CircularProgressGauge
                    percent={intelligenceData.delivery_metrics?.planned?.percent ?? 0}
                    color="#6554C0"
                    size={94}
                    strokeWidth={9}
                  />
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#6554C0", marginTop: 8 }}>
                    {intelligenceData.delivery_metrics?.planned?.percent ?? 0}% Queued
                  </div>
                  <div style={{ fontSize: 11.5, color: "#42526E", marginTop: 2 }}>
                    {intelligenceData.delivery_metrics?.operational_tasks?.total > 0 ? (
                      <span><strong>{intelligenceData.delivery_metrics.operational_tasks.count}</strong> ops tasks · <strong>{intelligenceData.delivery_metrics?.planned?.count ?? 0}</strong> in review</span>
                    ) : (
                      <span><strong>{intelligenceData.delivery_metrics?.planned?.count ?? 0}</strong> of <strong>{intelligenceData.delivery_metrics?.planned?.total ?? 0}</strong> deliverables</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#6B778C", marginTop: 8 }}>
                    {intelligenceData.project_issues && intelligenceData.project_issues.length > 0 ? (
                      <span style={{ color: "#00875A", fontWeight: 700 }}>🛡️ {intelligenceData.project_issues.length} issues resolved (0 blockers)</span>
                    ) : (
                      intelligenceData.delivery_metrics?.planned?.overdue_backlog_count > 0 ? (
                        <span style={{ color: "#BF2600", fontWeight: 700 }}>⚠️ {intelligenceData.delivery_metrics.planned.overdue_backlog_count} overdue backlog</span>
                      ) : (
                        <span style={{ color: "#00875A", fontWeight: 600 }}>✓ 0 overdue backlog</span>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Interactive Schedule Extension Alert Banner */}
              {(() => {
                const extCount = intelligenceData.delays_summary?.extended_count
                  || intelligenceData.audit_manifest?.deliverables_summary?.extended_count 
                  || 0;
                const totalExtDays = intelligenceData.delays_summary?.total_extension_days || 0;
                const delayedList = intelligenceData.delays_summary?.delayed_deliverables || [];
                if (extCount > 0) {
                  return (
                    <div style={{
                      padding: "14px 18px",
                      background: "#FFFBF0",
                      border: "1px solid #FFE380",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 12,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 22 }}>⚠️</span>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#172B4D" }}>
                            +{totalExtDays} working days extended across {extCount} deliverables
                          </div>
                          <div style={{ fontSize: 11.5, color: "#6B778C", marginTop: 2 }}>
                            Click any deliverable pill below to inspect root causes and team ownership in the backlog:
                          </div>
                        </div>
                      </div>

                      {/* Interactive Delayed Deliverables Pills */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {delayedList.map((deliv, idx) => {
                          const isSelected = highlightedDeliverable === deliv.name;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setHighlightedDeliverable(isSelected ? null : deliv.name);
                                setDeliverablesTab("BACKLOG");
                                setDeliverablesStatusFilter("ALL");
                              }}
                              style={{
                                background: isSelected ? "#DE350B" : "#FFEBE6",
                                color: isSelected ? "#FFFFFF" : "#BF2600",
                                border: `1px solid ${isSelected ? "#DE350B" : "#FFBDAD"}`,
                                borderRadius: 14,
                                padding: "4px 10px",
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                transition: "all 0.15s ease",
                                boxShadow: isSelected ? "0 0 0 2px rgba(222,53,11,0.25)" : "none"
                              }}
                            >
                              <span>{deliv.name}</span>
                              <span style={{
                                background: isSelected ? "rgba(255,255,255,0.25)" : "#FFBDAD",
                                borderRadius: 8,
                                padding: "1px 5px",
                                fontSize: 10
                              }}>
                                +{deliv.extension_days}d
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* ── 3. Deliverables Execution & Workstreams ── */}
            <Card
              title="Deliverables Execution & Workstreams"
              subtitle="Actionable backlog, team ownership, dependencies, and data pipeline layers"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>}
              badge={intelligenceData.progress_metrics?.progress_source || "Deliverables Plan"}
              count={filteredDeliverables.length}
              style={{ gridColumn: "span 2" }}
            >
              {/* Sub-tab Switcher: Backlog & Ownership vs Pipeline Architecture */}
              <div className="pmo-filter-chips" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`pmo-chip ${deliverablesTab === "BACKLOG" ? "active" : ""}`}
                  onClick={() => setDeliverablesTab("BACKLOG")}
                >
                  Backlog & Ownership ({deliverableCounts.all})
                </button>
                <button
                  type="button"
                  className={`pmo-chip ${deliverablesTab === "PIPELINE" ? "active" : ""}`}
                  onClick={() => setDeliverablesTab("PIPELINE")}
                >
                  Pipeline Architecture & Layers ({pipelineStages.length})
                </button>
              </div>

              {deliverablesTab === "BACKLOG" ? (
                /* ── Backlog & Ownership View (Priority Ranked #1 to #6) ── */
                <div>
                  {/* Workstream Filter Tabs */}
                  {intelligenceData?.workstreams && intelligenceData.workstreams.length > 1 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #EBECF0" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", alignSelf: "center", marginRight: 4 }}>
                        Workstream:
                      </span>
                      <button
                        type="button"
                        className={`pmo-chip ${selectedWorkstream === "ALL" ? "active" : ""}`}
                        onClick={() => setSelectedWorkstream("ALL")}
                      >
                        All Workstreams ({allDeliverablesList.length})
                      </button>
                      {intelligenceData.workstreams.map((ws, wIdx) => {
                        const isSelected = selectedWorkstream === ws.name;
                        return (
                          <button
                            key={wIdx}
                            type="button"
                            className={`pmo-chip ${isSelected ? "active" : ""}`}
                            onClick={() => setSelectedWorkstream(ws.name)}
                            style={{
                              fontWeight: isSelected ? 700 : 500,
                            }}
                          >
                            {ws.name} ({ws.done}/{ws.total})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Status Filter Chips */}
                  <div className="pmo-filter-chips" style={{ marginBottom: 12 }}>
                    <button
                      type="button"
                      className={`pmo-chip ${deliverablesStatusFilter === "ALL" ? "active" : ""}`}
                      onClick={() => setDeliverablesStatusFilter("ALL")}
                    >
                      All ({deliverableCounts.all})
                    </button>
                    <button
                      type="button"
                      className={`pmo-chip ${deliverablesStatusFilter === "COMPLETED" ? "active" : ""}`}
                      onClick={() => setDeliverablesStatusFilter("COMPLETED")}
                    >
                      ✓ Completed ({deliverableCounts.completed})
                    </button>
                    <button
                      type="button"
                      className={`pmo-chip ${deliverablesStatusFilter === "IN_PROGRESS" ? "active" : ""}`}
                      onClick={() => setDeliverablesStatusFilter("IN_PROGRESS")}
                    >
                      ⚙️ In Progress ({deliverableCounts.inProgress})
                    </button>
                    <button
                      type="button"
                      className={`pmo-chip ${deliverablesStatusFilter === "PLANNED" ? "active" : ""}`}
                      onClick={() => setDeliverablesStatusFilter("PLANNED")}
                    >
                      📅 Planned ({deliverableCounts.planned})
                    </button>
                    {deliverableCounts.delayed > 0 && (
                      <button
                        type="button"
                        className={`pmo-chip ${deliverablesStatusFilter === "DELAYED" ? "active" : ""}`}
                        onClick={() => setDeliverablesStatusFilter("DELAYED")}
                      >
                        ⚠️ Delayed / Extended ({deliverableCounts.delayed})
                      </button>
                    )}
                  </div>

                  {/* Active Inspection Banner if highlighted */}
                  {highlightedDeliverable && (
                    <div style={{
                      padding: "8px 12px",
                      background: "#DEEBFF",
                      border: "1px solid #B3D4FF",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#0747A6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10
                    }}>
                      <span>🔍 Highlighting: <strong>{highlightedDeliverable}</strong></span>
                      <button
                        type="button"
                        onClick={() => setHighlightedDeliverable(null)}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #B3D4FF",
                          borderRadius: 4,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#0747A6",
                          cursor: "pointer"
                        }}
                      >
                        Clear Inspection ✕
                      </button>
                    </div>
                  )}

                  {selectedWorkstream === "Project Issues" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 440, overflowY: "auto", paddingRight: 4 }}>
                      {(!intelligenceData.project_issues || intelligenceData.project_issues.length === 0) ? (
                        <div style={{ textAlign: "center", padding: "28px 0", color: "#6B778C" }}>
                          No project-level defect or issue records found.
                        </div>
                      ) : (
                        intelligenceData.project_issues.map((issue, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: "12px 14px",
                              background: "#F9FCFA",
                              border: "1px solid #C6E8D0",
                              borderRadius: 6,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <span style={{ background: "#E3FCEF", color: "#006644", border: "1px solid #ABF5D1", borderRadius: 10, padding: "2px 8px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
                                  DEFECT #{idx + 1}
                                </span>
                                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#172B4D" }}>
                                  {issue.title}
                                </span>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#E3FCEF", color: "#006644" }}>
                                {issue.status}
                              </span>
                            </div>
                            {issue.solution && (
                              <div style={{ background: "#F4F5F7", borderRadius: 4, padding: "8px 10px", fontSize: 11.5, color: "#172B4D", borderLeft: "3px solid #00875A" }}>
                                <strong style={{ color: "#006644" }}>Resolution Steps:</strong> {issue.solution}
                              </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#6B778C" }}>
                              <span>Owner: <strong>{issue.owner || issue.assignee || "Unassigned"}</strong></span>
                              <span>Source: <strong>{issue.source_location || "Issue tracker"}</strong></span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : filteredDeliverables.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "28px 0", color: "#6B778C" }}>
                      No deliverables match the selected filter ({deliverablesStatusFilter}).
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 440, overflowY: "auto", paddingRight: 4 }}>
                      {filteredDeliverables.map((item, idx) => {
                        const hasExt = item.has_extension || (item.extension_days > 0);
                        const extDays = item.extension_days || 0;
                        const exp = item.delay_explanation;
                        const rank = item.priority_rank || 4;
                        const rankLabel = item.priority_label || item.status;
                        const isHighlighted = highlightedDeliverable && (
                          item.title?.toLowerCase() === highlightedDeliverable.toLowerCase() ||
                          highlightedDeliverable.toLowerCase().includes(item.title?.toLowerCase() || "") ||
                          item.title?.toLowerCase().includes(highlightedDeliverable.toLowerCase())
                        );

                        const rankColors = {
                          1: { bg: "#FFEBE6", text: "#BF2600", border: "#FFBDAD" },
                          2: { bg: "#FFEBE6", text: "#BF2600", border: "#FFBDAD" },
                          3: { bg: "#FFF0B3", text: "#7F5F00", border: "#FFE380" },
                          4: { bg: "#DEEBFF", text: "#0747A6", border: "#B3D4FF" },
                          5: { bg: "#F4F5F7", text: "#42526E", border: "#DFE1E6" },
                          6: { bg: "#E3FCEF", text: "#006644", border: "#ABF5D1" },
                        };
                        const colorScheme = rankColors[rank] || rankColors[4];

                        return (
                          <div
                            key={idx}
                            style={{
                              padding: "12px 14px",
                              background: isHighlighted ? "#F0F5FF" : (item.status === "COMPLETED" ? "#F9FCFA" : (hasExt ? "#FFF8F6" : "#FAFBFC")),
                              border: isHighlighted ? "2px solid #0052CC" : `1px solid ${item.status === "COMPLETED" ? "#C6E8D0" : (hasExt ? "#FFD0C7" : "#E4E7EB")}`,
                              boxShadow: isHighlighted ? "0 0 0 3px rgba(0,82,204,0.18)" : "none",
                              borderRadius: 6,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              transition: "all 0.2s ease"
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <span
                                  style={{
                                    background: colorScheme.bg,
                                    color: colorScheme.text,
                                    border: `1px solid ${colorScheme.border}`,
                                    borderRadius: 10,
                                    padding: "2px 8px",
                                    fontSize: 10,
                                    fontWeight: 800,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  #{rank} {rankLabel}
                                </span>
                                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#172B4D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {item.title}
                                </span>
                                {isHighlighted && (
                                  <span style={{ background: "#0052CC", color: "#FFFFFF", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                    Inspecting
                                  </span>
                                )}
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                {hasExt && (
                                  <span style={{ background: "#FFEBE6", color: "#BF2600", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4, border: "1px solid #FFBDAD" }}>
                                    +{extDays}d extended
                                  </span>
                                )}
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 7px",
                                  borderRadius: 10,
                                  background: item.status === "COMPLETED" ? "#E3FCEF" : (item.status === "IN_PROGRESS" ? "#DEEBFF" : "#EBECF0"),
                                  color: item.status === "COMPLETED" ? "#006644" : (item.status === "IN_PROGRESS" ? "#0747A6" : "#42526E"),
                                }}>
                                  {item.status}
                                </span>
                              </div>
                            </div>

                            {/* Owner & Schedule Details */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#6B778C", flexWrap: "wrap", gap: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600, color: "#42526E" }}>
                                  👤 Owner: <strong>{item.owner || item.assignee || "Unassigned"}</strong>
                                </span>
                                {item.requester && (
                                  <span style={{ color: "#6B778C", background: "#F4F5F7", padding: "1px 6px", borderRadius: 3, fontSize: 10.5 }}>
                                    Req: {item.requester}
                                  </span>
                                )}
                                {item.has_conflict && item.conflict_reason && (
                                  <span style={{ color: "#BF2600", background: "#FFF0ED", padding: "1px 6px", borderRadius: 3, border: "1px solid #FFD0C7", fontWeight: 600, fontSize: 10.5 }}>
                                    ⚠️ {item.conflict_reason}
                                  </span>
                                )}
                                {item.workstream && item.workstream !== "General" && (
                                  <span style={{ color: "#0052CC", background: "#DEEBFF", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
                                    {item.workstream}
                                  </span>
                                )}
                                {item.dependency && item.dependency.toLowerCase() !== "none" && (
                                  <span style={{ color: "#BF2600", background: "#FFF0ED", padding: "1px 6px", borderRadius: 3, border: "1px solid #FFD0C7", fontWeight: 600 }}>
                                    Dep: {item.dependency}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {item.closed_date ? (
                                  <span>Closed: <strong>{item.closed_date}</strong> {item.requested_date ? `(Req: ${item.requested_date})` : ""}</span>
                                ) : item.start_date && item.end_date ? (
                                  <span>Target: <strong>{item.end_date}</strong> (started {item.start_date})</span>
                                ) : (
                                  <span>Duration: {item.duration || "—"} working days</span>
                                )}
                                {item.source_location && (
                                  <span style={{ color: "#97A0AF", fontSize: 10 }}>[{item.source_location}]</span>
                                )}
                              </div>
                            </div>

                            {/* Grounded Delay Reason if present */}
                            {hasExt && exp?.documented_reason && (
                              <div style={{
                                background: "#FFF0ED",
                                border: "1px solid #FFD0C7",
                                borderRadius: 4,
                                padding: "8px 10px",
                                fontSize: 11.5,
                                color: "#172B4D",
                                marginTop: 2,
                              }}>
                                <div>
                                  <strong style={{ color: "#BF2600" }}>Delay Cause:</strong> {exp.documented_reason}
                                </div>
                                {exp.recovery_action && (
                                  <div style={{ marginTop: 3, color: "#006644" }}>
                                    <strong>Action:</strong> {exp.recovery_action}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Pipeline Architecture & Layers View ── */
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {pipelineStages.map((stage) => {
                    const doneCount = stage.items.filter((i) => i.status === "COMPLETED").length;
                    const stagePct = stage.items.length ? Math.round((doneCount / stage.items.length) * 100) : 0;

                    return (
                      <div
                        key={stage.id}
                        style={{
                          background: "#FAFBFC",
                          border: "1px solid #DFE1E6",
                          borderRadius: 8,
                          padding: "12px 14px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                              background: "#EBECF0",
                              color: stage.color,
                              border: `1px solid ${stage.color}`,
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700
                            }}>
                              {stage.badge}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#172B4D" }}>
                              {stage.name}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: stagePct === 100 ? "#00875A" : "#0052CC" }}>
                            {doneCount} / {stage.items.length} Completed ({stagePct}%)
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "#6B778C", margin: "0 0 8px" }}>{stage.desc}</p>
                        
                        <div className="pmo-ws-bar-track" style={{ height: 6, marginBottom: 10 }}>
                          <div className="pmo-ws-bar-fill" style={{ width: `${stagePct}%`, background: stagePct === 100 ? "#00875A" : "#0052CC" }} />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
                          {stage.items.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: "#FFFFFF",
                                border: "1px solid #EBECF0",
                                borderRadius: 6,
                                padding: "8px 10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#172B4D" }}>{item.title}</span>
                                <span style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: item.status === "COMPLETED" ? "#E3FCEF" : (item.status === "IN_PROGRESS" ? "#DEEBFF" : "#EBECF0"),
                                  color: item.status === "COMPLETED" ? "#006644" : (item.status === "IN_PROGRESS" ? "#0747A6" : "#42526E"),
                                }}>
                                  {item.status}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, color: "#6B778C" }}>
                                <span>Owner: {item.owner || item.assignee || "Unassigned"}</span>
                                {item.extension_days > 0 && (
                                  <span style={{ color: "#BF2600", fontWeight: 700 }}>+{item.extension_days}d</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Workstreams breakdown if issue counts exist */}
                  {pieData && Object.keys(pieData).length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #DFE1E6" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Workstream Issue Distribution</span>
                      <div style={{ marginTop: 8 }}>
                        <PieChart data={pieData} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ── 4. Project Timeline & Milestones (Calendar Horizon) ── */}
            <Card
              title="Project Timeline & Milestones"
              subtitle="Milestone calendar horizon, phase gates, and schedule variance"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              badge={intelligenceData.timeline?.status_label || (intelligenceData.timeline?.has_delays ? "Behind Schedule" : "On Track")}
              count={filteredMilestones.length}
              style={{ gridColumn: "span 1" }}
            >
              {/* Milestone Filter Chips */}
              <div className="pmo-filter-chips" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`pmo-chip ${milestoneFilter === "ALL" ? "active" : ""}`}
                  onClick={() => setMilestoneFilter("ALL")}
                >
                  All ({milestoneCounts.all})
                </button>
                {milestoneCounts.delayed > 0 && (
                  <button
                    type="button"
                    className={`pmo-chip ${milestoneFilter === "DELAYED" ? "active" : ""}`}
                    onClick={() => setMilestoneFilter("DELAYED")}
                  >
                    ⚠️ Delayed ({milestoneCounts.delayed})
                  </button>
                )}
                <button
                  type="button"
                  className={`pmo-chip ${milestoneFilter === "UPCOMING" ? "active" : ""}`}
                  onClick={() => setMilestoneFilter("UPCOMING")}
                >
                  ⏱️ Upcoming ({milestoneCounts.upcoming})
                </button>
                <button
                  type="button"
                  className={`pmo-chip ${milestoneFilter === "COMPLETED" ? "active" : ""}`}
                  onClick={() => setMilestoneFilter("COMPLETED")}
                >
                  ✓ Done ({milestoneCounts.completed})
                </button>
              </div>

              {filteredMilestones.length === 0 ? (
                <p className="db-empty" style={{ margin: "20px 0" }}>No milestones match the selected filter ({milestoneFilter}).</p>
              ) : (
                <div className="pmo-timeline-track" style={{ maxHeight: 440, overflowY: "auto", paddingRight: 4 }}>
                  {filteredMilestones.map((m, idx) => {
                    const delayInfo = getMilestoneDelayInfo(m.title, intelligenceData);
                    const hasExt = m.extension_days > 0 || (delayInfo?.extension_days > 0);
                    const extDays = m.extension_days || delayInfo?.extension_days || 0;
                    const exp = delayInfo?.delay_explanation || m.delay_explanation;
                    const isExpanded = expandedMilestone === idx;

                    return (
                      <div key={idx} className="pmo-timeline-item">
                        <div className={`pmo-timeline-dot ${(m.status || "PENDING").toLowerCase()}`} />
                        <div className="pmo-timeline-content">
                          <div className="pmo-timeline-title">
                            <span>{m.title}</span>
                            <span
                              className="pmo-sev-badge"
                              style={{
                                background: m.status === "COMPLETED" ? "#E3FCEF" : (m.status === "DELAYED" ? "#FFEBE6" : "#DEEBFF"),
                                color: m.status === "COMPLETED" ? "#006644" : (m.status === "DELAYED" ? "#BF2600" : "#0052CC"),
                              }}
                            >
                              {m.status || "PENDING"}
                            </span>
                            {hasExt && (
                              <button
                                type="button"
                                onClick={() => setExpandedMilestone(isExpanded ? null : idx)}
                                style={{
                                  background: "#FFEBE6",
                                  color: "#BF2600",
                                  border: "1px solid #FFBDAD",
                                  borderRadius: 4,
                                  padding: "2px 7px",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  transition: "all 0.15s ease",
                                }}
                                title="Click to view documented delay reason and source citation"
                              >
                                <span>+{extDays}d</span>
                                <span style={{ fontSize: 9 }}>{isExpanded ? "▲" : "▼"}</span>
                              </button>
                            )}
                            {m.days_away !== null && m.days_away !== undefined && (
                              <span style={{ fontSize: 11, color: m.days_away < 0 ? "#DE350B" : "#6B778C" }}>
                                {m.days_away < 0 ? `${Math.abs(m.days_away)}d overdue` : `${m.days_away}d away`}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
                            {m.target_date && <span className="pmo-timeline-date">Target: {formatDateSafe(m.target_date)}</span>}
                            <span className="pmo-source-tag">Source: {m.source || "Timeline"} {m.source_location ? `(${m.source_location})` : ""}</span>
                          </div>

                          {/* Expandable Delay Explanation Box */}
                          {hasExt && isExpanded && (
                            <div style={{
                              marginTop: 8,
                              padding: "10px 12px",
                              background: "#FFF7F5",
                              border: "1px solid #FFD0C7",
                              borderRadius: 6,
                              fontSize: 11.5,
                              color: "#172B4D",
                              lineHeight: 1.5,
                            }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontWeight: 700, color: "#BF2600", fontSize: 11 }}>
                                  ⚠️ Documented Delay Cause
                                </span>
                                <span style={{ fontSize: 10, color: "#6B778C", background: "#FFFFFF", padding: "1px 6px", borderRadius: 3, border: "1px solid #FFD0C7" }}>
                                  +{extDays}d impact
                                </span>
                              </div>
                              <div style={{ color: "#172B4D" }}>
                                {exp?.documented_reason || "Schedule extended beyond baseline in primary work plan."}
                              </div>
                              {exp?.contributing_factors && (
                                <div style={{ fontSize: 11, color: "#5E6C84", marginTop: 4 }}>
                                  <strong>Contributing Factors:</strong> {exp.contributing_factors}
                                </div>
                              )}
                              {exp?.recovery_action && (
                                <div style={{ fontSize: 11, color: "#006644", marginTop: 4 }}>
                                  <strong>Recovery Action:</strong> {exp.recovery_action}
                                </div>
                              )}
                              <div style={{ fontSize: 10, color: "#6B778C", marginTop: 6, paddingTop: 4, borderTop: "1px dashed #FFD0C7" }}>
                                <strong>Source Citation:</strong> {exp?.source_citation || m.source || "Project Timeline"}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>


            {/* ── 5. Challenges, Risks & Blockers Radar ── */}
            <Card
              title="Challenges, Risks & Blockers Radar"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DE350B" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              count={filteredRisks.length}
              style={{ gridColumn: "span 2" }}
            >
              {/* Filter Chips */}
              <div className="pmo-filter-chips">
                {["ALL", "BLOCKER", "RISK", "CHALLENGE", "DEPENDENCY"].map((type) => (
                  <button
                    key={type}
                    className={`pmo-chip ${riskFilter === type ? "active" : ""}`}
                    onClick={() => setRiskFilter(type)}
                  >
                    {type === "ALL" ? "All Items" : type.charAt(0) + type.slice(1).toLowerCase() + "s"}
                  </button>
                ))}
              </div>

              {filteredRisks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#00875A" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00875A" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>No active {riskFilter.toLowerCase()} items identified</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filteredRisks.map((item, idx) => (
                    <div key={idx} className="pmo-radar-item">
                      <div className="pmo-radar-header">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`pmo-sev-badge ${(item.severity || "MEDIUM").toLowerCase()}`}>
                            {item.severity}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C" }}>
                            {item.type}
                          </span>
                        </div>
                        <span className="pmo-source-tag">
                          {item.source_type === "TICKET" ? "Ticket: " : "Doc: "}
                          {item.source_title || "Source"} {item.source_location ? `(${item.source_location})` : ""}
                          {item.sources && item.sources.length > 1 && (
                            <span style={{ marginLeft: 6, fontWeight: 700, color: "#0052CC" }} title={item.sources.map(s => typeof s === "object" ? `${s.title || ""} (${s.location || ""})` : String(s)).join("\n")}>
                              • {item.sources.length} sources
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="pmo-radar-title">{item.title}</div>
                      {item.description && <div className="pmo-radar-desc">{item.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 6. Team & Resource Allocation ── */}
            <Card
              title="Team & Resource Allocation"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              count={intelligenceData.team_resources?.members?.length || 0}
            >
              {(intelligenceData.team_resources?.unassigned_count || 0) > 0 && (
                <div style={{ background: "#FFEBE6", border: "1px solid #FFBDAD", borderRadius: 6, padding: "8px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#BF2600" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span><strong>{intelligenceData.team_resources.unassigned_count}</strong> unassigned task(s) needing triage</span>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(intelligenceData.team_resources?.members || []).map((m, idx) => {
                  const mName = m.name || m.username || "Team Member";
                  const initials = m.initials || getAvatarInitials(mName, "TM");
                  const assigned = m.assigned_count ?? m.total ?? 0;
                  const done = m.done_count ?? m.done ?? 0;
                  const inProgress = m.in_progress_count ?? m.in_progress ?? 0;
                  const planned = m.planned_count ?? m.planned ?? 0;
                  const overdue = m.overdue_count ?? 0;
                  const pct = m.completion_pct !== undefined ? m.completion_pct : (assigned ? Math.round((done / assigned) * 100) : 0);

                  return (
                    <div
                      key={idx}
                      style={{
                        background: "#FAFBFC",
                        border: "1px solid #DFE1E6",
                        borderRadius: 8,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            className="jira-avatar-circle"
                            style={{
                              width: 32,
                              height: 32,
                              fontSize: 12,
                              fontWeight: 800,
                              background: "#0052CC",
                              color: "#FFFFFF",
                              flexShrink: 0,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#172B4D" }}>{mName}</span>
                              <span className="jira-member-role-tag" style={{ fontSize: 10, padding: "1px 6px" }}>
                                {m.role || "Data Engineer"}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "#6B778C", marginTop: 2 }}>
                              {m.capacity_label || (m.working_days ? `${m.working_days} working days (${m.effort_hours} hrs)` : "Capacity data not recorded")}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: pct > 0 ? "#00875A" : "#6B778C" }}>
                            {pct}%
                          </div>
                          <div style={{ fontSize: 10.5, color: "#6B778C" }}>
                            {done} of {assigned} completed
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="pmo-ws-bar-track" style={{ height: 6 }}>
                        <div className="pmo-ws-bar-fill" style={{ width: `${pct}%`, background: "#00875A" }} />
                      </div>

                      {/* Work Breakdown Chips */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, flexWrap: "wrap" }}>
                        <span style={{ color: "#00875A", fontWeight: 600 }}>● {done} Done</span>
                        <span style={{ color: "#0052CC", fontWeight: 600 }}>● {inProgress} In Progress</span>
                        <span style={{ color: "#6B778C", fontWeight: 600 }}>● {planned} Planned</span>
                        {overdue > 0 && (
                          <span style={{ color: "#BF2600", fontWeight: 700, background: "#FFEBE6", padding: "1px 6px", borderRadius: 4, border: "1px solid #FFBDAD" }}>
                            ⚠️ {overdue} Overdue / Delayed
                          </span>
                        )}
                        {m.source_location && (
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "#8993A4" }}>
                            {m.source_location}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {(!intelligenceData.team_resources?.members || intelligenceData.team_resources.members.length === 0) && (
                  <p className="db-empty">No team members assigned.</p>
                )}
              </div>

              {/* Resource Notes from Docs */}
              {(intelligenceData.team_resources?.notes?.length || 0) > 0 && (
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #EBECF0" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Document Resource Notes</span>
                  {intelligenceData.team_resources.notes.map((n, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: "#42526E", marginTop: 4, display: "flex", gap: 6 }}>
                      <span>•</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 7. Recent Updates & Decisions ── */}
            <Card
              title="Recent Deliveries & Key Decisions"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
              style={{ gridColumn: "span 2" }}
            >
              {/* Sub-tabs */}
              <div className="pmo-filter-chips">
                <button
                  className={`pmo-chip ${updatesTab === "WEEKLY" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("WEEKLY")}
                >
                  Weekly Comparison
                </button>
                <button
                  className={`pmo-chip ${updatesTab === "DELIVERIES" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("DELIVERIES")}
                >
                  Completed Deliverables ({intelligenceData.recent_updates?.completed_work?.length || 0})
                </button>
                <button
                  className={`pmo-chip ${updatesTab === "DECISIONS" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("DECISIONS")}
                >
                  Document Decisions ({intelligenceData.recent_updates?.decisions?.length || 0})
                </button>
                <button
                  className={`pmo-chip ${updatesTab === "ACTIVITY" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("ACTIVITY")}
                >
                  Audit Activity ({intelligenceData.recent_updates?.activity_feed?.length || 0})
                </button>
              </div>

              {/* Sub-tab 0: Weekly Delivery Comparison */}
              {updatesTab === "WEEKLY" && (
                <div>
                  {intelligenceData.weekly_comparison?.has_weekly_data ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {/* Banner with Document Provenance */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#DEEBFF",
                        border: "1px solid #B3D4FF",
                        borderRadius: 6,
                        padding: "8px 14px",
                        fontSize: 12,
                        color: "#0747A6",
                        flexWrap: "wrap",
                        gap: 6
                      }}>
                        <span style={{ fontWeight: 700 }}>
                          📊 Weekly Delivery Comparison (Current Week vs. Previous Week)
                        </span>
                        <span style={{ fontSize: 11 }}>
                          Source: <strong>{intelligenceData.weekly_comparison.source_document || "Weekly Status Report"}</strong>
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                        {/* Current Week Box */}
                        <div style={{ background: "#FAFBFC", border: "2px solid #0052CC", borderRadius: 8, padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#0052CC", letterSpacing: "0.3px" }}>
                              CURRENT WEEK
                            </span>
                            <span style={{ background: "#DEEBFF", color: "#0747A6", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                              {intelligenceData.weekly_comparison.current_week?.period || "Latest Period"}
                            </span>
                          </div>

                          {/* Completed */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#00875A", textTransform: "uppercase", marginBottom: 4 }}>
                              ✓ Completed Deliverables ({intelligenceData.weekly_comparison.current_week?.completed?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.current_week?.completed?.length > 0 ? (
                              intelligenceData.weekly_comparison.current_week.completed.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#172B4D", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>No new completions this cycle</div>
                            )}
                          </div>

                          {/* Carried Forward */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#FF8B00", textTransform: "uppercase", marginBottom: 4 }}>
                              ⏳ Carried Forward / In Progress ({intelligenceData.weekly_comparison.current_week?.carried_forward?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.current_week?.carried_forward?.length > 0 ? (
                              intelligenceData.weekly_comparison.current_week.carried_forward.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#172B4D", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>None carried forward</div>
                            )}
                          </div>

                          {/* New Risks */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#DE350B", textTransform: "uppercase", marginBottom: 4 }}>
                              ⚠️ Challenges & Risks ({intelligenceData.weekly_comparison.current_week?.new_risks?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.current_week?.new_risks?.length > 0 ? (
                              intelligenceData.weekly_comparison.current_week.new_risks.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#BF2600", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>No new risks logged</div>
                            )}
                          </div>
                        </div>

                        {/* Previous Week Box */}
                        <div style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 8, padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#6B778C", letterSpacing: "0.3px" }}>
                              PREVIOUS WEEK
                            </span>
                            <span style={{ background: "#F4F5F7", color: "#6B778C", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                              {intelligenceData.weekly_comparison.previous_week?.period || "Prior Period"}
                            </span>
                          </div>

                          {/* Completed in Prior Period */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", marginBottom: 4 }}>
                              ✓ Completed in Prior Period ({intelligenceData.weekly_comparison.previous_week?.completed?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.previous_week?.completed?.length > 0 ? (
                              intelligenceData.weekly_comparison.previous_week.completed.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#42526E", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>No completions recorded</div>
                            )}
                          </div>

                          {/* Carried Forward */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", marginBottom: 4 }}>
                              ⏳ Work In Progress ({intelligenceData.weekly_comparison.previous_week?.carried_forward?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.previous_week?.carried_forward?.length > 0 ? (
                              intelligenceData.weekly_comparison.previous_week.carried_forward.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#42526E", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>None recorded</div>
                            )}
                          </div>

                          {/* Prior Risks */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", marginBottom: 4 }}>
                              ⚠️ Active Challenges ({intelligenceData.weekly_comparison.previous_week?.new_risks?.length || 0})
                            </div>
                            {intelligenceData.weekly_comparison.previous_week?.new_risks?.length > 0 ? (
                              intelligenceData.weekly_comparison.previous_week.new_risks.map((item, idx) => (
                                <div key={idx} style={{ fontSize: 12, color: "#5E6C84", padding: "4px 0", borderBottom: "1px dashed #EBECF0" }}>
                                  • {item.title || item}
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: 11, color: "#6B778C" }}>No challenges logged</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "32px 16px", textAlign: "center", background: "#FAFBFC", border: "1px dashed #DFE1E6", borderRadius: 8 }}>
                      <div style={{ fontSize: 26, marginBottom: 8 }}>📅</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#172B4D" }}>
                        No current-week report available.
                      </div>
                      <p style={{ fontSize: 12, color: "#6B778C", maxWidth: 440, margin: "6px auto 0", lineHeight: 1.5 }}>
                        {intelligenceData.weekly_comparison?.message || "Upload a weekly status report (PDF/Word/Excel) to automatically populate weekly delivery delta comparisons."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 1: Completed work */}
              {updatesTab === "DELIVERIES" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(!intelligenceData.recent_updates?.completed_work || intelligenceData.recent_updates.completed_work.length === 0) ? (
                    <p className="db-empty">No work items resolved in the last sprint cycle.</p>
                  ) : (
                    intelligenceData.recent_updates.completed_work.map((i) => (
                      <div
                        key={i.id || Math.random()}
                        className="db-issue-row"
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/projects/${selectedProjectId}/board?issue=${i.id}`)}
                      >
                        <span style={{ color: "#00875A", fontWeight: "bold" }}>✓</span>
                        <span className="db-issue-key">{i.key}</span>
                        <span className="db-issue-title">{i.title}</span>
                        <span style={{ fontSize: 11, color: "#6B778C" }}>
                          Resolved {formatDateSafe(i.updated_at)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Sub-tab 2: Key decisions */}
              {updatesTab === "DECISIONS" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(!intelligenceData.recent_updates?.decisions || intelligenceData.recent_updates.decisions.length === 0) ? (
                    <p className="db-empty">No key decisions extracted yet. Meeting notes & specs will appear here.</p>
                  ) : (
                    intelligenceData.recent_updates.decisions.map((d, idx) => (
                      <div key={idx} className="pmo-radar-item">
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D" }}>{d.title}</div>
                        <span className="pmo-source-tag" style={{ marginTop: 4 }}>
                          Source: {d.source || "Document"} {d.location ? `(${d.location})` : ""}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Sub-tab 3: Activity feed */}
              {updatesTab === "ACTIVITY" && (
                <div className="db-activity-list">
                  {(!intelligenceData.recent_updates?.activity_feed || intelligenceData.recent_updates.activity_feed.length === 0) ? (
                    <p className="db-empty">No audit activity recorded yet.</p>
                  ) : (
                    intelligenceData.recent_updates.activity_feed.map((a) => (
                      <div
                        key={a.id || Math.random()}
                        className="db-activity-row"
                        onClick={() => navigate(`/projects/${selectedProjectId}/board?issue=${a.issue_id}`)}
                      >
                        <div className="db-activity-avatar">{getAvatarInitials(a.actor, "SY")}</div>
                        <div className="db-activity-content">
                          <span className="db-activity-text">
                            <strong>{a.actor}</strong> changed <em>{a.field_changed}</em> to <code className="db-code">{a.new_value || "—"}</code> on <span className="db-activity-issue">{a.project_key}-{a.issue_id}</span>
                          </span>
                          <span className="db-activity-title">{a.issue_title}</span>
                        </div>
                        <span className="db-activity-time">
                          {formatDateSafe(a.created_at, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>

            {/* ── 8. Project Documentation Hub ── */}
            <Card
              title="Documentation Hub & Governance"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
              badge={intelligenceData.documentation_governance?.label || "Governance"}
              actionBtn={
                <button
                  className="jira-btn-primary-sm"
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setShowUploadModal(true)}
                >
                  + Upload
                </button>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(intelligenceData.recent_documents || []).map((d) => (
                  <div
                    key={d.id || Math.random()}
                    className="pmo-doc-card"
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/projects/${selectedProjectId}/board?tab=docs`)}
                    title="Click to open document in Docs Workspace"
                  >
                    <span className={`pmo-doc-badge ${(d.file_type || "DOC").toLowerCase()}`}>
                      {d.file_type === "MARKDOWN" ? "MD" : (d.file_type || "DOC")}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {d.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#6B778C" }}>
                        {d.template_label || "Project Document"} • {d.signals_count || 0} signals extracted
                      </div>
                    </div>
                  </div>
                ))}

                {(!intelligenceData.recent_documents || intelligenceData.recent_documents.length === 0) && (
                  <p className="db-empty">No documents uploaded yet. Upload a status report or project plan.</p>
                )}
              </div>

              {/* AI Agent Utilization Subsection */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #DFE1E6" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    AI Agent Utilization
                  </span>
                  <span style={{
                    background: "#F4F5F7",
                    border: "1px solid #DFE1E6",
                    color: "#5E6C84",
                    borderRadius: 4,
                    padding: "1px 6px",
                    fontSize: 10,
                    fontWeight: 700
                  }}>
                    {intelligenceData.agent_utilization?.status || "NOT_CAPTURED"}
                  </span>
                </div>
                <div style={{
                  background: "#FAFBFC",
                  border: "1px solid #EBECF0",
                  borderRadius: 6,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10
                }}>
                  <div style={{ fontSize: 20 }}>🤖</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#172B4D" }}>
                      {intelligenceData.agent_utilization?.label || "Agent information not captured"}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B778C", marginTop: 2, lineHeight: 1.4 }}>
                      {intelligenceData.agent_utilization?.message || "No autonomous agent configurations or activity logs are specified in current project documents."}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── 9. Document Contributions & Conflict Detection ── */}
            <Card
              title="Document Contributions & Conflict Detection"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>}
              badge={intelligenceData.cross_document_discrepancies?.length ? `${intelligenceData.cross_document_discrepancies.length} Conflicts Detected` : "Synchronized"}
              style={{ gridColumn: "1 / -1" }}
              actionBtn={
                <button
                  className="jira-btn-secondary-sm"
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => navigate(`/projects/${selectedProjectId}/board?tab=docs&docTab=manifest`)}
                >
                  Inspect Full Audit Manifest →
                </button>
              }
            >
              {/* Contributions Provenance Grid */}
              {(intelligenceData.cross_document_contributions?.length || 0) > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Metric Provenance (Which Document Powers What)
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginTop: 8 }}>
                    {intelligenceData.cross_document_contributions.map((c, idx) => (
                      <div key={idx} style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 6, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#172B4D" }}>{c.metric}</span>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: c.contribution_type === "AUTHORITATIVE_PRIMARY" ? "#DEEBFF" : "#EAE6FF",
                            color: c.contribution_type === "AUTHORITATIVE_PRIMARY" ? "#0747A6" : "#403294"
                          }}>
                            {c.contribution_type === "AUTHORITATIVE_PRIMARY" ? "Primary Source" : "Corroborating"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#0052CC", fontWeight: 600 }}>{c.value}</div>
                        <div style={{ fontSize: 11, color: "#5E6C84", marginTop: 4 }}>
                          📄 {c.source_doc_title} • <em>{c.source_location}</em>
                        </div>
                        {c.notes && (
                          <div style={{ fontSize: 11, color: "#6B778C", marginTop: 4 }}>{c.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detected Conflicting Information */}
              {(intelligenceData.cross_document_discrepancies?.length || 0) > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #DFE1E6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 14 }}>⚠️</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#BF2600", textTransform: "uppercase" }}>
                      Cross-Document Contradictions & Discrepancies ({intelligenceData.cross_document_discrepancies.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {intelligenceData.cross_document_discrepancies.map((disc) => (
                      <div
                        key={disc.id || Math.random()}
                        style={{
                          background: "#FFF7F5",
                          border: "1px solid #FFD0C7",
                          borderRadius: 6,
                          padding: "12px 14px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#BF2600" }}>{disc.title}</span>
                          <span style={{ background: "#FFEBE6", color: "#BF2600", border: "1px solid #FFBDAD", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                            {disc.severity || "MEDIUM"} SEVERITY
                          </span>
                        </div>
                        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#172B4D" }}>{disc.conflict_summary}</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: "#FFFFFF", padding: "8px 10px", borderRadius: 4, border: "1px solid #E4E7EB", fontSize: 11 }}>
                          <div>
                            <span style={{ color: "#6B778C", fontWeight: 600 }}>Source A ({disc.source_a?.doc || (typeof disc.source_a === "string" ? disc.source_a : "Source A")}):</span>
                            <div style={{ color: "#172B4D", marginTop: 2 }}>{disc.source_a?.reported_state || (typeof disc.source_a === "string" ? disc.source_a : "—")}</div>
                          </div>
                          <div>
                            <span style={{ color: "#6B778C", fontWeight: 600 }}>Source B ({disc.source_b?.doc || (typeof disc.source_b === "string" ? disc.source_b : "Source B")}):</span>
                            <div style={{ color: "#172B4D", marginTop: 2 }}>{disc.source_b?.reported_state || (typeof disc.source_b === "string" ? disc.source_b : "—")}</div>
                          </div>
                        </div>
                        {disc.reconciliation_action && (
                          <div style={{ marginTop: 8, fontSize: 11, color: "#006644", background: "#E3FCEF", padding: "4px 8px", borderRadius: 4 }}>
                            <strong>Recommendation:</strong> {disc.reconciliation_action}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            MODE B: GLOBAL PORTFOLIO VIEW (selectedProjectId === "ALL")
            ══════════════════════════════════════════════════════════════════════ */}
        {selectedProjectId === "ALL" && data && (
          <div className="db-grid">

            {/* 1. Executive Portfolio Health Snapshot */}
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                  Executive Portfolio Snapshot
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B778C" }}>
                  What is the aggregate health, completion, and risk posture across the enterprise?
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: "14px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Active Initiatives</span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#172B4D", marginTop: 4 }}>
                    {data.portfolio_health_summary?.total_projects || data.my_projects?.length || 0}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 11 }}>
                    <span style={{ color: "#00875A", fontWeight: 600 }}>● {data.portfolio_health_summary?.on_track_count || 0} On Track</span>
                    <span style={{ color: "#FF8B00", fontWeight: 600 }}>● {data.portfolio_health_summary?.at_risk_count || 0} At Risk</span>
                    {data.portfolio_health_summary?.critical_count > 0 && (
                      <span style={{ color: "#DE350B", fontWeight: 600 }}>● {data.portfolio_health_summary.critical_count} Critical</span>
                    )}
                  </div>
                </div>

                <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: "14px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Portfolio Progress</span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#0052CC", marginTop: 4 }}>
                    {data.portfolio_health_summary?.average_completion_pct || 0}%
                  </div>
                  <div style={{ fontSize: 11, color: "#6B778C", marginTop: 6 }}>
                    Average deliverable & sprint completion across projects
                  </div>
                </div>

                <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: "14px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Attention Required</span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: (data.projects_requiring_attention?.length > 0 ? "#BF2600" : "#00875A"), marginTop: 4 }}>
                    {data.projects_requiring_attention?.length || 0} Project(s)
                  </div>
                  <div style={{ fontSize: 11, color: "#6B778C", marginTop: 6 }}>
                    {data.projects_requiring_attention?.length > 0 ? "Initiatives with delayed deliverables or high risk" : "All projects on schedule"}
                  </div>
                </div>

                <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: "14px 18px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Active Risks & Blockers</span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#DE350B", marginTop: 4 }}>
                    {data.portfolio_health_summary?.total_active_risks || 0}
                  </div>
                  <div style={{ fontSize: 11, color: "#6B778C", marginTop: 6 }}>
                    Extracted across {data.portfolio_health_summary?.total_documents || 0} project documents
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Projects Requiring Immediate Attention */}
            <Card
              title="Projects Requiring Attention"
              subtitle="Which specific projects need immediate intervention or leadership escalation, and why?"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DE350B" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              badge={data.projects_requiring_attention?.length ? `${data.projects_requiring_attention.length} Projects Flagged` : "Clear"}
              style={{ gridColumn: "1 / -1" }}
            >
              {data.projects_requiring_attention?.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px 0", color: "#00875A" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00875A" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>No projects currently require leadership escalation.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.projects_requiring_attention.map((proj) => (
                    <div
                      key={proj.id}
                      style={{
                        padding: "12px 16px",
                        background: "#FFF7F5",
                        border: "1px solid #FFD0C7",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "#172B4D" }}>
                            [{proj.key}] {proj.name}
                          </span>
                          <span className={`pmo-rag-pill ${proj.health_status?.toLowerCase()}`} style={{ fontSize: 10, padding: "2px 8px" }}>
                            {proj.health_label || proj.health_status}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#0052CC" }}>
                            {proj.completion_percent}% complete
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#BF2600", marginTop: 4, fontWeight: 500 }}>
                          ⚠️ {proj.health_rationale || `${proj.delayed_milestones_count} deliverables extended / behind schedule`}
                        </div>
                        <div style={{ fontSize: 11, color: "#6B778C", marginTop: 3 }}>
                          Source: {proj.progress_source} • {proj.active_risks_count} active risks ({proj.high_risks_count} high/critical)
                        </div>
                      </div>
                      <button
                        className="jira-btn-primary-sm"
                        style={{ whiteSpace: "nowrap", padding: "6px 14px", fontSize: 11 }}
                        onClick={() => {
                          setSelectedProjectId(String(proj.id));
                          setSearchParams({ project: String(proj.id) });
                        }}
                      >
                        Open PMO View →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 3. Portfolio Initiative Health & Delivery Pace (Redesigned cross-project health & pace view) */}
            <Card
              title="Portfolio Initiative Health & Delivery Pace"
              subtitle="Where is execution progressing vs. stalling across active initiatives, and what phase is each in?"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>}
              count={data.cross_project_progress?.length || 0}
              style={{ gridColumn: "1 / -1" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                {(data.cross_project_progress || []).map((p) => {
                  const pct = p.completion_percent !== undefined ? p.completion_percent : (p.total > 0 ? Math.round((p.done / p.total) * 100) : 0);
                  const hStatus = p.health_status || "ON_TRACK";
                  const isAtRisk = hStatus === "AT_RISK" || hStatus === "CRITICAL";

                  return (
                    <div
                      key={p.id}
                      style={{
                        border: "1px solid #DFE1E6",
                        borderRadius: 8,
                        padding: "14px 16px",
                        background: "#FAFBFC",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ background: "#0052CC", color: "#FFFFFF", padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                              {p.key}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: 14, color: "#172B4D" }}>{p.name}</span>
                          </div>
                          <span className={`pmo-rag-pill ${hStatus.toLowerCase()}`} style={{ fontSize: 10, padding: "2px 8px" }}>
                            <span className="pmo-rag-dot" style={{ width: 6, height: 6 }} />
                            {hStatus.replace("_", " ")}
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#6B778C", marginBottom: 10 }}>
                          <span style={{ background: "#EAE6FF", color: "#403294", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                            {p.current_phase || "Active Development"}
                          </span>
                          <span>•</span>
                          <span>{p.documents_count ? `${p.documents_count} project docs` : "No docs yet"}</span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "#172B4D", marginBottom: 4 }}>
                          <span>Delivery Progress</span>
                          <span style={{ color: "#0052CC" }}>{pct}%</span>
                        </div>
                        <div className="db-project-bar" style={{ height: 7, borderRadius: 4 }}>
                          <div
                            className="db-project-bar-fill"
                            style={{
                              width: `${pct}%`,
                              background: hStatus === "CRITICAL" ? "#DE350B" : (hStatus === "AT_RISK" ? "#FF8B00" : "#00875A")
                            }}
                          />
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#6B778C", marginTop: 4 }}>
                          <span>{p.done_items || p.done || 0} of {p.total_items || p.total || 0} items resolved</span>
                          <span>{p.progress_source || "Deliverables"}</span>
                        </div>
                      </div>

                      <div>
                        {isAtRisk ? (
                          <div style={{ background: "#FFF0ED", border: "1px solid #FFD0C7", borderRadius: 4, padding: "6px 10px", fontSize: 11, color: "#BF2600" }}>
                            ⚠️ <strong>Pace Attention:</strong> {p.health_rationale || "Schedule extensions identified in work plan"}
                          </div>
                        ) : (
                          <div style={{ background: "#E3FCEF", border: "1px solid #ABF5D1", borderRadius: 4, padding: "6px 10px", fontSize: 11, color: "#006644" }}>
                            ✓ <strong>Pace Steady:</strong> Deliverables advancing on schedule
                          </div>
                        )}

                        <div style={{ marginTop: 10, textAlign: "right" }}>
                          <button
                            type="button"
                            className="jira-btn-secondary-sm"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => {
                              setSelectedProjectId(String(p.id));
                              setSearchParams({ project: String(p.id) });
                            }}
                          >
                            PMO View →
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* 4. Upcoming & Delayed Milestones (Renamed & Enhanced) */}
            <Card
              title="Upcoming & Delayed Milestones"
              subtitle="What key deadlines, delivery gates, and commitments are approaching or past target date across projects?"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              count={data.upcoming_overdue_milestones?.length || 0}
              style={{ gridColumn: "1 / -1" }}
            >
              {data.upcoming_overdue_milestones?.length === 0 ? (
                <p className="db-empty">No cross-project milestones recorded.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                        <th style={{ padding: "8px 10px" }}>Project</th>
                        <th style={{ padding: "8px 10px" }}>Milestone / Delivery Gate</th>
                        <th style={{ padding: "8px 10px" }}>Status</th>
                        <th style={{ padding: "8px 10px" }}>Target Date</th>
                        <th style={{ padding: "8px 10px" }}>Schedule Horizon</th>
                        <th style={{ padding: "8px 10px" }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.upcoming_overdue_milestones.map((m, idx) => (
                        <tr
                          key={idx}
                          style={{ borderBottom: "1px solid #EBECF0", cursor: "pointer" }}
                          onClick={() => {
                            setSelectedProjectId(String(m.project_id));
                            setSearchParams({ project: String(m.project_id) });
                          }}
                        >
                          <td style={{ padding: "8px 10px", fontWeight: 700, color: "#0052CC" }}>[{m.project_key}]</td>
                          <td style={{ padding: "8px 10px", fontWeight: 600, color: "#172B4D" }}>
                            {m.title}
                            {m.extension_days > 0 && (
                              <span style={{ marginLeft: 6, background: "#FFEBE6", color: "#BF2600", padding: "1px 5px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
                                +{m.extension_days}d extended
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span className="pmo-sev-badge" style={{
                              background: m.status === "COMPLETED" ? "#E3FCEF" : (m.status === "DELAYED" ? "#FFEBE6" : "#DEEBFF"),
                              color: m.status === "COMPLETED" ? "#006644" : (m.status === "DELAYED" ? "#BF2600" : "#0052CC"),
                              fontSize: 10
                            }}>
                              {m.status}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", color: "#42526E" }}>
                            {m.target_date ? new Date(m.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            {m.days_away !== null && m.days_away !== undefined && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: m.days_away < 0 ? "#DE350B" : "#00875A" }}>
                                {m.days_away < 0 ? `⚠️ ${Math.abs(m.days_away)}d overdue` : `⏱️ ${m.days_away}d away`}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", color: "#6B778C" }}>
                            {m.source || "Gantt Timeline"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* 5. Risks & Blockers Requiring Attention (Renamed) */}
            <Card
              title="Risks & Blockers Requiring Attention"
              subtitle="What critical vulnerabilities and operational blockers threaten portfolio delivery if unaddressed?"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DE350B" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              count={data.aggregate_risks_blockers?.length || 0}
            >
              {data.aggregate_risks_blockers?.length === 0 ? (
                <p className="db-empty">Zero critical or high risks active across projects.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                  {data.aggregate_risks_blockers.map((r, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 12px",
                        background: "#FFF7F5",
                        border: "1px solid #FFD0C7",
                        borderRadius: 6,
                        cursor: "pointer"
                      }}
                      onClick={() => {
                        setSelectedProjectId(String(r.project_id));
                        setSearchParams({ project: String(r.project_id) });
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 11, color: "#0052CC" }}>[{r.project_key}]</span>
                          <span className={`pmo-sev-badge ${r.severity?.toLowerCase()}`} style={{ fontSize: 9 }}>
                            {r.severity}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: "#6B778C" }}>{r.source_title || "Project Doc"}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#172B4D" }}>{r.title}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 6. Recent Portfolio Updates (Brand New!) */}
            <Card
              title="Recent Portfolio Updates"
              subtitle="What was recently delivered, decided, or changed across all active projects?"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
              count={data.recent_portfolio_updates?.length || 0}
            >
              {!data.recent_portfolio_updates || data.recent_portfolio_updates.length === 0 ? (
                <p className="db-empty">No recent portfolio events recorded yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                  {data.recent_portfolio_updates.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      style={{
                        padding: "10px 12px",
                        background: "#FAFBFC",
                        border: "1px solid #DFE1E6",
                        borderRadius: 6,
                        cursor: "pointer"
                      }}
                      onClick={() => {
                        setSelectedProjectId(String(item.project_id));
                        setSearchParams({ project: String(item.project_id) });
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 11, color: "#0052CC" }}>[{item.project_key}]</span>
                          <span
                            style={{
                              background: item.badge_color ? `${item.badge_color}18` : "#DEEBFF",
                              color: item.badge_color || "#0747A6",
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {item.badge}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, color: "#6B778C" }}>
                          {item.timestamp ? (
                            new Date(item.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          ) : (
                            item.source || "Update"
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#172B4D" }}>
                        {item.title}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

          </div>
        )}

      </main>

      {/* Upload Document Modal */}
      {selectedProjectId !== "ALL" && (
        <UploadDocModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          projectId={selectedProjectId}
          onUploaded={(res) => {
            if (res.intelligence) {
              setIntelligenceData(res.intelligence);
            } else {
              loadProjectIntelligence(selectedProjectId);
            }
            loadGlobalData();
          }}
        />
      )}
    </div>
  );
}
