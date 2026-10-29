import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { userLabel } from "../utils/userLabel";
import api, { downloadFile } from "../api/client";

const TEMPLATES = [
  {
    id: "STATUS",
    name: "Project Status & Weekly Report",
    tag: "Weekly Status",
    icon: "RPT",
    content: `## Weekly Project Status Report\n**Period**: Week ending October 10, 2026\n**Status**: ON TRACK\n\n### Accomplishments & Completed Work\n- Finalized authentication microservice and user database schema\n- Deployed initial staging pipeline with CI/CD passing\n\n### In-Progress Focus Areas\n- Integrating real-time telemetry events\n- Drafting API documentation and swagger contracts\n\n### Blockers & Critical Risks\n- Critical Blocker: Upstream third-party payment webhook latency exceeding 1.2s\n- Risk: Potential delay on security audit sign-off if reports are not submitted by Friday\n\n### Upcoming Milestones\n- Milestone: Beta Release Candidate v1.0 on October 24, 2026`,
  },
  {
    id: "TIMELINE",
    name: "Timeline & Project Plan",
    tag: "Timeline Plan",
    icon: "PLN",
    content: `## Project Timeline & Work Breakdown\nHigh-level release roadmap, phases, and key deliverables.\n\n### Project Phases\n- Phase 1: Architectural Foundation (COMPLETED)\n- Phase 2: Core Feature Implementation (ACTIVE)\n- Phase 3: QA & Security Audit (PLANNED)\n- Phase 4: Production Rollout & Go-Live (PLANNED)\n\n### Target Milestones & Deliverables\n- Milestone: Alpha Test Build (Target: 2026-10-18)\n- Milestone: Security Compliance Sign-off (Target: 2026-10-28)\n- Milestone: Production Launch v1.0 (Target: 2026-11-15)\n\n### Technical Dependencies\n- Depends on Cloud Infrastructure provisioning ticket INFRA-102`,
  },
  {
    id: "RESOURCE",
    name: "Resource & Team Allocation",
    tag: "Resource Plan",
    icon: "RES",
    content: `## Resource & Team Allocation Plan\nTeam capacity, key roles, and workstream allocations.\n\n### Key Roles & Responsibilities\n- Tech Lead: Architecture, code reviews, and API contracts (100% allocation)\n- Frontend Engineer: Component design, Atlassian UI tokens, and board interactions (100% allocation)\n- Backend Engineer: Database indexing, ORM optimization, and unit tests (80% allocation)\n- DevOps Specialist: Docker containers, deployment, and monitoring (shared 50% with Core Platform)\n\n### Capacity Constraints\n- Bottleneck: DevOps bandwidth limited to 20 hours/week during active sprint deployment`,
  },
  {
    id: "PRD",
    name: "Product Requirements (PRD)",
    tag: "Product Specs",
    icon: "PRD",
    content: `## Objective & Goal\nDefine the business problem, user pain points, and success metrics for this feature.\n\n### Target Personas\n- **Primary Persona**: Data Scientist / Engineer\n- **Use Case**: Real-time batch predictions and automated pipeline execution\n\n### Functional Requirements\n1. **REST API**: Endpoint to trigger data ingestion pipeline with status callbacks\n2. **Validation**: Auto-check CSV schema before loading into model\n3. **Performance**: Process 10k rows in < 1.5 seconds\n\n### Key Performance Indicators (KPIs)\n- 99.9% uptime on prediction microservice\n- < 200ms latency for single-record inference`,
  },
  {
    id: "ARCHITECTURE",
    name: "Architecture & System Design",
    tag: "Architecture",
    icon: "ARC",
    content: `## System Architecture Overview\nHigh-level architectural design and service boundaries.\n\n### Technology Stack\n- **Backend**: Django REST Framework (Python 3.12)\n- **Frontend**: React 19 + Vite + Atlassian Design System\n- **Database**: PostgreSQL / SQLite with indexed key lookups\n- **Cache & Async**: Redis + Celery worker queue\n\n### API Endpoints\n- \`GET /api/projects/\`: List workspaces for authenticated user\n- \`POST /api/issues/\`: Create new task or subtask\n- \`PATCH /api/issues/{id}/\`: Update status, priority, or assignee`,
  },
  {
    id: "RETRO",
    name: "Sprint Retrospective",
    tag: "Sprint Notes",
    icon: "RET",
    content: `## Sprint Retrospective Summary\nReviewing sprint velocity, team feedback, and next sprint commitments.\n\n### What Went Well\n- Completed all priority backlog tasks on schedule\n- Zero blocker bugs introduced during sprint\n- Clean separation between frontend components\n\n### What Could Be Improved\n- Add automated end-to-end tests for issue status transitions\n- Improve ticket estimation precision for subtasks\n\n### Action Items\n- [ ] Set up GitHub Actions CI pipeline\n- [ ] Update API documentation and model schemas`,
  },
  {
    id: "MEETING",
    name: "Team Meeting Notes & Decisions",
    tag: "Meeting Notes",
    icon: "MTG",
    content: `## Weekly Standup & Planning\n**Agenda**: Review sprint burndown and align on API specifications.\n\n### Agenda Items\n1. Review sprint burndown trajectory\n2. Align on Figma UI design specifications\n3. Coordinate model deployment timeline\n\n### Key Decisions Made\n- Standardize on Atlassian design tokens for the entire project board\n- Use direct status transitions for seamless Kanban board updates`,
  },
];

export default function DocsView({ project, currentUser }) {
  const currentUserName = currentUser?.username || "Project Member";

  const [docs, setDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [searchParams] = useSearchParams();
  // Active view tab in document pane: "content", "signals", or "manifest"
  const [activeDocTab, setActiveDocTab] = useState(searchParams.get("docTab") || "content");
  const [docSignals, setDocSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [signalCategoryFilter, setSignalCategoryFilter] = useState("ALL");

  // Editor form state
  const [editTitle, setEditTitle] = useState("");
  const [editTemplateType, setEditTemplateType] = useState("PRD");
  const [editContent, setEditContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("PRD");

  // Upload modal state
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTemplateType, setUploadTemplateType] = useState("STATUS");
  const [uploading, setUploading] = useState(false);

  function loadDocs() {
    if (!project?.id) return;
    setLoading(true);
    api.get(`/docs/?project=${project.id}`)
      .then((res) => {
        const loadedDocs = res.data || [];
        setDocs(loadedDocs);
        if (loadedDocs.length > 0 && !selectedDocId) {
          setSelectedDocId(loadedDocs[0].id);
        } else if (loadedDocs.length === 0) {
          setSelectedDocId(null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const [crossDocIntelligence, setCrossDocIntelligence] = useState(null);

  function loadCrossDocIntelligence() {
    if (!project?.id) return;
    api.get(`/projects/${project.id}/intelligence/`)
      .then((res) => setCrossDocIntelligence(res.data))
      .catch(() => setCrossDocIntelligence(null));
  }

  useEffect(() => {
    loadDocs();
    loadCrossDocIntelligence();
  }, [project?.id]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) || docs[0];

  // Fetch signals for the selected document
  useEffect(() => {
    if (!selectedDoc?.id) {
      setDocSignals([]);
      return;
    }
    setSignalsLoading(true);
    api.get(`/docs/${selectedDoc.id}/signals/`)
      .then((res) => {
        setDocSignals(res.data || []);
      })
      .catch(() => {
        // Fallback to filtering signals viewset
        api.get(`/signals/?source_doc=${selectedDoc.id}`)
          .then((res) => setDocSignals(res.data || []))
          .catch(() => setDocSignals([]));
      })
      .finally(() => setSignalsLoading(false));
  }, [selectedDoc?.id]);

  function handleStartEdit() {
    if (!selectedDoc) return;
    setEditTitle(selectedDoc.title);
    setEditTemplateType(selectedDoc.template_type || "CUSTOM");
    setEditContent(selectedDoc.content);
    setIsEditing(true);
    setActiveDocTab("content");
  }

  async function handleSaveEdit() {
    if (!editTitle.trim() || !selectedDoc) return;
    setSaving(true);
    try {
      const res = await api.patch(`/docs/${selectedDoc.id}/`, {
        title: editTitle.trim(),
        template_type: editTemplateType,
        content: editContent,
      });
      setDocs((prev) => prev.map((d) => (d.id === selectedDoc.id ? res.data : d)));
      setIsEditing(false);
      // Reload signals as content edit may trigger re-extraction
      api.get(`/docs/${selectedDoc.id}/signals/`).then((s) => setDocSignals(s.data || []));
    } catch (e) {
      alert("Failed to save document to backend.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDoc(id) {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    try {
      await api.delete(`/docs/${id}/`);
      const nextDocs = docs.filter((d) => d.id !== id);
      setDocs(nextDocs);
      if (nextDocs.length > 0) {
        setSelectedDocId(nextDocs[0].id);
      }
      loadCrossDocIntelligence();
    } catch (e) {
      alert("Failed to delete document.");
    }
  }

  async function handleCreateFromTemplate(e) {
    e.preventDefault();
    if (!editTitle.trim() || !project?.id) return;
    setSaving(true);
    try {
      const chosenTmpl = TEMPLATES.find((t) => t.id === selectedTemplate);
      const res = await api.post("/docs/", {
        project: project.id,
        title: editTitle.trim(),
        template_type: selectedTemplate,
        content: editContent || chosenTmpl?.content || "",
      });
      setDocs((prev) => [res.data, ...prev]);
      setSelectedDocId(res.data.id);
      setShowNewModal(false);
      setEditTitle("");
      setEditContent("");
      setActiveDocTab("content");
      loadCrossDocIntelligence();
    } catch (e) {
      alert("Failed to create document.");
    } finally {
      setSaving(false);
    }
  }

  const [downloadingDoc, setDownloadingDoc] = useState(false);

  async function handleDownloadDoc(doc) {
    if (!doc?.file_url) return;
    setDownloadingDoc(true);
    try {
      await downloadFile(doc.file_url, doc.title || "document");
    } catch (e) {
      alert("Failed to download document: " + (e?.response?.data?.error || e.message));
    } finally {
      setDownloadingDoc(false);
    }
  }

  async function handleUploadDoc(e) {
    e.preventDefault();
    if (!uploadFile) {
      alert("Please select a file to upload.");
      return;
    }

    // Client-side file size validation for serverless upload limit
    if (uploadFile.size > 4.5 * 1024 * 1024) {
      alert(
        `"${uploadFile.name}" (${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 4.5 MB serverless upload limit. Please select a smaller file or reduce its size.`
      );
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    if (uploadTitle.trim()) {
      formData.append("title", uploadTitle.trim());
    }
    formData.append("template_type", uploadTemplateType);

    try {
      // Do not manually set Content-Type so Axios/browser computes the multipart boundary correctly
      const res = await api.post(`/projects/${project.id}/upload_doc/`, formData);
      const newDoc = res.data?.doc;
      if (newDoc) {
        setDocs((prev) => {
          const exists = prev.some((d) => d.id === newDoc.id);
          if (exists) {
            return prev.map((d) => (d.id === newDoc.id ? newDoc : d));
          }
          return [newDoc, ...prev];
        });
        setSelectedDocId(newDoc.id);
        setActiveDocTab("signals"); // Auto-switch to signals tab to view extracted insights
      }
      if (res.data?.is_duplicate) {
        alert(res.data.message || "Document has already been uploaded. Signals preserved without duplicate inflation.");
      }
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadTitle("");
      loadCrossDocIntelligence();
    } catch (err) {
      alert("Failed to upload document. " + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  }

  async function handleReextractSignals() {
    if (!selectedDoc?.id) return;
    setReextracting(true);
    try {
      const res = await api.post(`/docs/${selectedDoc.id}/reextract/`);
      const sigs = await api.get(`/docs/${selectedDoc.id}/signals/`);
      setDocSignals(sigs.data || []);
      if (res.data?.doc) {
        setDocs((prev) => prev.map((d) => (d.id === selectedDoc.id ? res.data.doc : d)));
      }
      loadCrossDocIntelligence();
    } catch (err) {
      alert("Failed to re-extract signals.");
    } finally {
      setReextracting(false);
    }
  }

  const filteredDocs = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.content?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredSignals = useMemo(() => {
    if (signalCategoryFilter === "ALL") return docSignals;
    return docSignals.filter((s) => s.category === signalCategoryFilter);
  }, [docSignals, signalCategoryFilter]);

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getDocBadgeInfo(doc) {
    if (doc.file_type === "XLSX") return { label: "XLS", color: "#217346", bg: "#E3FCEF" };
    if (doc.file_type === "DOCX") return { label: "DOC", color: "#2B579A", bg: "#DEEBFF" };
    if (doc.file_type === "PDF") return { label: "PDF", color: "#D9381E", bg: "#FFEBE6" };
    if (doc.template_type === "PRD") return { label: "PRD", color: "#0052CC", bg: "#DEEBFF" };
    if (doc.template_type === "STATUS") return { label: "RPT", color: "#00875A", bg: "#E3FCEF" };
    if (doc.template_type === "TIMELINE") return { label: "PLN", color: "#6554C0", bg: "#EAE6FF" };
    if (doc.template_type === "RESOURCE") return { label: "RES", color: "#FF8B00", bg: "#FFF0B3" };
    if (doc.template_type === "ARCHITECTURE") return { label: "ARC", color: "#0052CC", bg: "#DEEBFF" };
    if (doc.template_type === "RETRO") return { label: "RET", color: "#403294", bg: "#EAE6FF" };
    if (doc.template_type === "MEETING") return { label: "MTG", color: "#36B37E", bg: "#E3FCEF" };
    return { label: "DOC", color: "#42526E", bg: "#EBECF0" };
  }

  return (
    <div className="jira-docs-workspace">
      {/* Sidebar: Navigation List of Docs */}
      <div className="jira-docs-sidebar">
        <div className="jira-docs-sidebar-header">
          <div className="jira-docs-header-title-row">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div>
                <h3 className="jira-docs-sidebar-title">Project Docs</h3>
                <span className="jira-docs-cloud-sync-badge">PMO Intelligence</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="jira-btn-secondary-sm"
                onClick={() => setShowUploadModal(true)}
                title="Upload Excel, Word, PDF, or Markdown file"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Upload</span>
              </button>
              <button
                className="jira-btn-primary-sm"
                onClick={() => {
                  const tmpl = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0];
                  setEditTitle(`New ${tmpl.name.replace(/[^a-zA-Z ]/g, "").trim()}`);
                  setEditContent(tmpl.content);
                  setShowNewModal(true);
                }}
                title="Create new markdown document"
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                + New
              </button>
            </div>
          </div>

          <div className="jira-docs-search-wrap">
            <input
              type="text"
              className="jira-input-sm"
              placeholder="Search documentation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Pre-built Templates Quick Bar */}
        <div className="jira-docs-templates-section">
          <span className="jira-field-label" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>
            PRE-BUILT TEMPLATES
          </span>
          <div className="jira-docs-template-chips">
            {TEMPLATES.slice(0, 5).map((tmpl) => (
              <button
                key={tmpl.id}
                className="jira-tmpl-chip"
                onClick={() => {
                  setSelectedTemplate(tmpl.id);
                  setEditTitle(`${tmpl.name.replace(/[^a-zA-Z ]/g, "").trim()}`);
                  setEditContent(tmpl.content);
                  setShowNewModal(true);
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: "#0052CC", background: "#DEEBFF", borderRadius: 3, padding: "1px 5px" }}>{tmpl.icon}</span>
                <span>{tmpl.tag}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Document Items List */}
        <div className="jira-docs-tree-list">
          {loading && <div style={{ padding: 14, fontSize: 12.5, color: "var(--jira-text-muted)" }}>Loading documents...</div>}

          {!loading && filteredDocs.map((doc) => {
            const badge = getDocBadgeInfo(doc);
            return (
              <div
                key={doc.id}
                className={`jira-doc-tree-item ${selectedDocId === doc.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedDocId(doc.id);
                  setIsEditing(false);
                }}
              >
                <div className="jira-doc-tree-icon">
                  <span style={{ fontSize: 9, fontWeight: 800, color: badge.color, background: badge.bg, padding: "2px 4px", borderRadius: 3 }}>
                    {badge.label}
                  </span>
                </div>
                <div className="jira-doc-tree-info">
                  <div className="jira-doc-tree-title">{doc.title}</div>
                  <div className="jira-doc-tree-meta">
                    <span>{userLabel(doc.created_by) || currentUserName}</span>
                    {doc.signals_count > 0 && (
                      <>
                        <span>•</span>
                        <span style={{ color: "#0052CC", fontWeight: 700 }}>⚡ {doc.signals_count} signals</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && filteredDocs.length === 0 && (
            <div className="jira-docs-empty-state">
              {searchTerm ? `No documents match "${searchTerm}".` : "No documents yet. Click 'Upload' or '+ New' to add documents."}
            </div>
          )}
        </div>
      </div>

      {/* Main Document Content Pane */}
      <div className="jira-docs-main-content">
        {selectedDoc ? (
          <div>
            {/* Top Document Header Toolbar */}
            <div className="jira-docs-article-header">
              <div>
                <div className="jira-docs-breadcrumb">
                  <span>Spaces</span> / <span>{project?.name}</span> / <span className="current">{selectedDoc.title}</span>
                </div>
                <h1 className="jira-docs-article-title">{selectedDoc.title}</h1>
                <div className="jira-docs-article-meta" style={{ flexWrap: "wrap", gap: 10 }}>
                  <div className="jira-avatar-circle" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {(userLabel(selectedDoc.created_by) || currentUserName).substring(0, 2).toUpperCase()}
                  </div>
                  <span>Created by <strong>{userLabel(selectedDoc.created_by) || currentUserName}</strong></span>
                  <span>•</span>
                  <span>Updated: {new Date(selectedDoc.updated_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  
                  {/* Attached File Indicator */}
                  {selectedDoc.file_url && (
                    <span className="pmo-doc-badge" style={{ background: "#0052CC", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      {selectedDoc.file_type || "FILE"} ({formatFileSize(selectedDoc.file_size)})
                    </span>
                  )}

                  {/* Signals Count Indicator */}
                  <span
                    className="jira-status-pill jira-status-inprogress"
                    style={{ fontSize: 10, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
                    onClick={() => setActiveDocTab("signals")}
                    title="View extracted PMO intelligence signals"
                  >
                    <span>⚡</span>
                    <span>{docSignals.length} Extracted Signals</span>
                  </span>

                  {/* Audit Manifest Indicator */}
                  {selectedDoc.audit_manifest && (
                    <span
                      className="jira-status-pill"
                      style={{
                        fontSize: 10,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        background: selectedDoc.audit_manifest.deliverables_summary ? "#E3FCEF" : "#DEEBFF",
                        color: selectedDoc.audit_manifest.deliverables_summary ? "#006644" : "#0052CC",
                        fontWeight: 700,
                      }}
                      onClick={() => setActiveDocTab("manifest")}
                      title="View row-level verified audit manifest"
                    >
                      <span>📑</span>
                      <span>
                        {selectedDoc.audit_manifest.deliverables_summary
                          ? `${selectedDoc.audit_manifest.deliverables_summary.percent}% Verified (${selectedDoc.audit_manifest.deliverables_summary.completed}/${selectedDoc.audit_manifest.deliverables_summary.total})`
                          : "Audit Manifest"}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="jira-docs-article-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Download File Button */}
                {selectedDoc.file_url && (
                  <button
                    type="button"
                    onClick={() => handleDownloadDoc(selectedDoc)}
                    disabled={downloadingDoc}
                    className="jira-btn-secondary-sm"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}
                    title="Download original file attachment"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {downloadingDoc ? "Downloading…" : "Download File"}
                  </button>
                )}

                {/* Re-extract PMO Signals */}
                <button
                  className="jira-btn-secondary-sm"
                  onClick={handleReextractSignals}
                  disabled={reextracting}
                  title="Re-run semantic extraction on this document"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ animation: reextracting ? "jira-spin 0.6s linear infinite" : "none" }}
                  >
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>{reextracting ? "Analyzing…" : "Re-analyze"}</span>
                </button>

                {!isEditing ? (
                  <>
                    <button className="jira-btn-primary-sm" onClick={handleStartEdit}>
                      Edit Doc
                    </button>
                    <button
                      className="jira-btn-icon-danger"
                      onClick={() => handleDeleteDoc(selectedDoc.id)}
                      title="Delete document"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <button className="jira-btn-primary-sm" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button className="jira-btn-secondary-sm" onClick={() => setIsEditing(false)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Navigation Tabs Bar inside Document View */}
            {!isEditing && (
              <div style={{ display: "flex", gap: 16, borderBottom: "1px solid #DFE1E6", marginBottom: 18, marginTop: 4 }}>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeDocTab === "content" ? "2px solid #0052CC" : "2px solid transparent",
                    padding: "8px 4px",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeDocTab === "content" ? "#0052CC" : "#5E6C84",
                    cursor: "pointer",
                  }}
                  onClick={() => setActiveDocTab("content")}
                >
                  📄 Document Content
                </button>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeDocTab === "signals" ? "2px solid #0052CC" : "2px solid transparent",
                    padding: "8px 4px",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeDocTab === "signals" ? "#0052CC" : "#5E6C84",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onClick={() => setActiveDocTab("signals")}
                >
                  <span>⚡ Extracted PMO Signals</span>
                  <span style={{ background: "#DEEBFF", color: "#0052CC", padding: "1px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                    {docSignals.length}
                  </span>
                </button>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeDocTab === "manifest" ? "2px solid #0052CC" : "2px solid transparent",
                    padding: "8px 4px",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeDocTab === "manifest" ? "#0052CC" : "#5E6C84",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onClick={() => setActiveDocTab("manifest")}
                >
                  <span>📑 Audit Manifest & Intelligence</span>
                  {selectedDoc?.audit_manifest?.deliverables_summary && (
                    <span style={{ background: "#E3FCEF", color: "#006644", padding: "1px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                      {selectedDoc.audit_manifest.deliverables_summary.percent}% Verified
                    </span>
                  )}
                  {selectedDoc?.audit_manifest?.document_type === "PDF_STATUS_REPORT" && (
                    <span style={{ background: "#DEEBFF", color: "#0747A6", padding: "1px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                      {selectedDoc.audit_manifest.total_pages || selectedDoc.audit_manifest.pages_count || 1} Pages
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Document Content View / Markdown Editor */}
            <div className="jira-docs-article-body">
              {isEditing ? (
                <div className="jira-docs-editor-container">
                  <div className="jira-form-field">
                    <label className="jira-field-label">Document Title</label>
                    <input
                      type="text"
                      className="jira-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>

                  <div className="jira-form-field" style={{ marginTop: 12 }}>
                    <label className="jira-field-label">Content (Markdown Supported)</label>
                    <textarea
                      className="jira-doc-textarea"
                      rows={18}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="Write markdown documentation..."
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button className="jira-btn-secondary" onClick={() => setIsEditing(false)}>
                      Cancel
                    </button>
                    <button className="jira-btn-primary" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? "Saving to Database..." : "Save to Database"}
                    </button>
                  </div>
                </div>
              ) : activeDocTab === "content" ? (
                <div>
                  {selectedDoc.file_url && (
                    <div style={{ background: "#F4F5F7", border: "1px solid #DFE1E6", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span style={{ fontSize: 13, color: "#172B4D" }}>
                          Parsed from uploaded file <strong>{selectedDoc.title}</strong> ({formatFileSize(selectedDoc.file_size)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadDoc(selectedDoc)}
                        disabled={downloadingDoc}
                        className="jira-btn-secondary-sm"
                        style={{ cursor: "pointer" }}
                      >
                        {downloadingDoc ? "Downloading…" : "Download Original"}
                      </button>
                    </div>
                  )}
                  <div className="jira-markdown-renderer">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(selectedDoc.content),
                      }}
                    />
                  </div>
                </div>
              ) : activeDocTab === "signals" ? (
                /* Extracted PMO Intelligence Signals Tab */
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                        Signals Extracted from {selectedDoc.title}
                      </h3>
                      <span style={{ fontSize: 12, color: "#6B778C" }}>
                        These structured signals directly feed the executive PMO Dashboard, Risk Radar, and Timeline.
                      </span>
                    </div>

                    {/* Category Filter Chips */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {["ALL", "BLOCKER", "RISK", "MILESTONE", "DECISION", "UPDATE", "RESOURCE_NOTE", "DEPENDENCY"].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className={`pmo-chip ${signalCategoryFilter === cat ? "active" : ""}`}
                          onClick={() => setSignalCategoryFilter(cat)}
                          style={{ fontSize: 11, padding: "2px 8px" }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {signalsLoading && (
                    <div style={{ padding: 20, textAlign: "center", color: "#6B778C", fontSize: 13 }}>
                      Loading document intelligence signals…
                    </div>
                  )}

                  {!signalsLoading && filteredSignals.length === 0 && (
                    <div className="pmo-empty" style={{ padding: "30px 10px", background: "#FAFBFC", border: "1px dashed #DFE1E6", borderRadius: 8 }}>
                      No {signalCategoryFilter === "ALL" ? "" : signalCategoryFilter.toLowerCase()} signals extracted from this document. Click <strong>Re-analyze</strong> to refresh parsing.
                    </div>
                  )}

                  {!signalsLoading && filteredSignals.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {filteredSignals.map((sig) => {
                        const sevClass = (sig.severity || "medium").toLowerCase();
                        return (
                          <div
                            key={sig.id}
                            className="pmo-radar-card"
                            style={{
                              borderLeft:
                                sig.category === "BLOCKER"
                                  ? "4px solid #DE350B"
                                  : sig.category === "RISK"
                                  ? "4px solid #FF8B00"
                                  : sig.category === "MILESTONE"
                                  ? "4px solid #6554C0"
                                  : sig.category === "DECISION"
                                  ? "4px solid #00875A"
                                  : "4px solid #0052CC",
                            }}
                          >
                            <div className="pmo-radar-top">
                              <span className={`pmo-sev-badge ${sevClass}`}>{sig.category}</span>
                              {sig.status && (
                                <span className="jira-status-pill jira-status-todo" style={{ fontSize: 10 }}>
                                  {sig.status}
                                </span>
                              )}
                              {sig.target_date && (
                                <span style={{ fontSize: 11, color: "#6B778C", fontWeight: 600 }}>
                                  Target: {sig.target_date}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: "#6B778C", marginLeft: "auto" }}>
                                {Math.round((sig.confidence || 0.85) * 100)}% confidence
                              </span>
                            </div>
                            <div className="pmo-radar-title">{sig.title}</div>
                            {sig.description && sig.description !== sig.title && (
                              <div className="pmo-radar-desc">{sig.description}</div>
                            )}
                            <div className="pmo-radar-src">
                              <span>Source: <strong>{sig.source_location || selectedDoc.title}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Tab 3: Document Audit Manifest & Intelligence Verification */
                <div>
                  {selectedDoc?.audit_manifest ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                      {/* AI Document Intelligence & Purpose Card */}
                      {selectedDoc.audit_manifest.ai_understanding && (
                        <div style={{ background: "linear-gradient(135deg, #F4F0FF, #EAE6FF)", border: "1px solid #C0B6F2", borderRadius: 8, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 18 }}>🧠</span>
                              <strong style={{ fontSize: 13, color: "#403294", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                AI Document Intelligence & Purpose
                              </strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "#403294", color: "#FFFFFF", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                {Math.round((selectedDoc.audit_manifest.ai_understanding.confidence || 0.9) * 100)}% Confidence
                              </span>
                              <span style={{ background: "#FFFFFF", color: "#5E6C84", border: "1px solid #C0B6F2", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
                                {selectedDoc.audit_manifest.ai_understanding.telemetry?.status === "SUCCESS" ? "Live AI Model" : "Deterministic Grounding Engine"}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D" }}>
                            {selectedDoc.audit_manifest.ai_understanding.purpose}
                          </div>
                          <div style={{ fontSize: 12, color: "#42526E" }}>
                            <em>Reasoning:</em> {selectedDoc.audit_manifest.ai_understanding.reasoning}
                          </div>
                        </div>
                      )}

                      {/* Check if manifest is PDF or Excel */}
                      {selectedDoc.audit_manifest.document_type === "PDF_STATUS_REPORT" || selectedDoc.file_type === "PDF" ? (
                        <>
                          {/* PDF Top Header Card */}
                          <div style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 8, padding: "16px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span className="pmo-sev-badge critical" style={{ background: "#DE350B", color: "#FFFFFF", fontWeight: 700 }}>
                                    {selectedDoc.audit_manifest.document_type || "PDF_STATUS_REPORT"}
                                  </span>
                                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                    PDF Status Report & Operational Manifest
                                  </h2>
                                </div>
                                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B778C" }}>
                                  Deterministic section and accomplishment extraction feeding operational tracking and governance.
                                </p>
                              </div>
                              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#172B4D", background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 6, padding: "6px 12px" }}>
                                <span>Pages: <strong>{selectedDoc.audit_manifest.total_pages || selectedDoc.audit_manifest.pages_count || 1}</strong> Scanned</span>
                                <span>•</span>
                                <span>Status: <strong style={{ color: "#006644" }}>{selectedDoc.audit_manifest.status || "PROCESSED"}</strong></span>
                              </div>
                            </div>
                          </div>

                          {/* PDF Operational Scope Callout Box */}
                          <div style={{ background: "#DEEBFF", border: "1px solid #B3D4FF", borderRadius: 8, padding: "16px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 18 }}>📄</span>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#0747A6" }}>
                                Operational Intelligence & Scope Extraction Basis
                              </h3>
                              <span style={{ marginLeft: "auto", background: "#0052CC", color: "#FFFFFF", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                                {selectedDoc.audit_manifest.accomplishments?.length || 0} Accomplishments • {selectedDoc.audit_manifest.operational_issues?.length || 0} Blockers
                              </span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, fontSize: 13, color: "#172B4D", marginTop: 10 }}>
                              <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Pages Ingested</span>
                                <div style={{ fontWeight: 700, marginTop: 4, color: "#0747A6" }}>
                                  {selectedDoc.audit_manifest.total_pages || selectedDoc.audit_manifest.pages_count || 1} Pages Scanned
                                </div>
                              </div>
                              <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Weekly Accomplishments</span>
                                <div style={{ fontWeight: 700, marginTop: 4, color: "#006644" }}>
                                  {selectedDoc.audit_manifest.accomplishments?.length || 0} Validated Deliverables
                                </div>
                              </div>
                              <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Active Platform Blockers</span>
                                <div style={{ fontWeight: 700, marginTop: 4, color: "#BF2600" }}>
                                  {selectedDoc.audit_manifest.operational_issues?.length || 0} Identified Issues
                                </div>
                              </div>
                              <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Governance Role</span>
                                <div style={{ fontWeight: 600, marginTop: 4, color: "#403294", fontSize: 12 }}>
                                  Corroborating Operational Tracking
                                </div>
                              </div>
                            </div>
                            {selectedDoc.audit_manifest.calculation_basis?.governance_role && (
                              <div style={{ marginTop: 10, fontSize: 12, color: "#5E6C84" }}>
                                <strong>Synthesis Role:</strong> {selectedDoc.audit_manifest.calculation_basis.governance_role}
                              </div>
                            )}
                          </div>

                          {/* PDF Document Structure & Page Breakdown */}
                          {selectedDoc.audit_manifest.pages_summary?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#172B4D" }}>
                                Document Structure & Page Breakdown ({selectedDoc.audit_manifest.pages_summary.length} Pages)
                              </h3>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                                      <th style={{ padding: "8px 10px", width: 70 }}>Page #</th>
                                      <th style={{ padding: "8px 10px" }}>Section / Slide Title</th>
                                      <th style={{ padding: "8px 10px", width: 100 }}>Extracted Text</th>
                                      <th style={{ padding: "8px 10px" }}>Preview Snippet</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedDoc.audit_manifest.pages_summary.map((p, idx) => (
                                      <tr key={idx} style={{ borderBottom: "1px solid #EBECF0" }}>
                                        <td style={{ padding: "8px 10px", fontWeight: 700, color: "#0052CC" }}>Page {p.page}</td>
                                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "#172B4D" }}>{p.title}</td>
                                        <td style={{ padding: "8px 10px", color: "#6B778C" }}>{p.char_count} chars</td>
                                        <td style={{ padding: "8px 10px", color: "#5E6C84", fontStyle: "italic" }}>
                                          "{p.preview?.length > 110 ? p.preview.substring(0, 110) + "…" : p.preview}"
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* PDF Weekly Validated Accomplishments */}
                          {selectedDoc.audit_manifest.accomplishments?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                  Weekly Validated Accomplishments ({selectedDoc.audit_manifest.accomplishments.length})
                                </h3>
                                <span style={{ fontSize: 12, color: "#6B778C" }}>
                                  Extracted from weekly highlights slides
                                </span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {selectedDoc.audit_manifest.accomplishments.map((acc, idx) => (
                                  <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid #DFE1E6", borderRadius: 6, background: "#FAFBFC" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                      <span style={{ background: "#E3FCEF", color: "#006644", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                        Task {acc.task_number || idx + 1}
                                      </span>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: "#172B4D" }}>{acc.title}</span>
                                    </div>
                                    <span style={{ fontSize: 11, color: "#6B778C" }}>{acc.source_location || `Page ${acc.page}`}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PDF Active Operational Blockers & Challenges */}
                          {selectedDoc.audit_manifest.operational_issues?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#DE350B" }}>
                                  Active Operational Blockers & Challenges ({selectedDoc.audit_manifest.operational_issues.length})
                                </h3>
                                <span style={{ fontSize: 12, color: "#6B778C" }}>
                                  Platform data ingestion bottlenecks
                                </span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {selectedDoc.audit_manifest.operational_issues.map((issue, idx) => (
                                  <div key={idx} style={{ padding: "10px 14px", borderLeft: "4px solid #DE350B", borderTop: "1px solid #DFE1E6", borderRight: "1px solid #DFE1E6", borderBottom: "1px solid #DFE1E6", borderRadius: 6, background: "#FFF0F0" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ background: "#FFEBE6", color: "#BF2600", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                          Challenge #{issue.item_number || idx + 1}
                                        </span>
                                        <span className="pmo-sev-badge critical" style={{ fontSize: 10, padding: "1px 6px" }}>
                                          {issue.severity || "HIGH"}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: 11, color: "#6B778C" }}>{issue.source_location || `Page ${issue.page}`}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: "#172B4D", fontWeight: 500 }}>
                                      {issue.description}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PDF Risks Identified */}
                          {selectedDoc.audit_manifest.risks?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#FF8B00" }}>
                                Identified Documentation Risks ({selectedDoc.audit_manifest.risks.length})
                              </h3>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {selectedDoc.audit_manifest.risks.map((r, idx) => (
                                  <div key={idx} style={{ padding: "10px 14px", borderLeft: "4px solid #FF8B00", borderTop: "1px solid #DFE1E6", borderRight: "1px solid #DFE1E6", borderBottom: "1px solid #DFE1E6", borderRadius: 6, background: "#FFFAF0" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                      <span className="pmo-sev-badge high" style={{ fontSize: 10, padding: "1px 6px" }}>
                                        {r.severity || "HIGH"}
                                      </span>
                                      <span style={{ fontSize: 11, color: "#6B778C" }}>{r.source_location || `Page ${r.page}`}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: "#172B4D" }}>{r.title}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PDF Team Structure & Escalation Hierarchy */}
                          {selectedDoc.audit_manifest.team_structure?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#172B4D" }}>
                                Team Structure & Escalation Hierarchy
                              </h3>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                                {selectedDoc.audit_manifest.team_structure.map((tm, idx) => (
                                  <div key={idx} style={{ border: "1px solid #DFE1E6", borderRadius: 6, padding: "10px 12px", background: "#FAFBFC" }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: "#0052CC", textTransform: "uppercase" }}>{tm.role}</span>
                                    <div style={{ fontWeight: 600, fontSize: 12, color: "#172B4D", marginTop: 4, whiteSpace: "pre-line" }}>
                                      {tm.name?.trim()}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#6B778C", marginTop: 4 }}>Citing Page {tm.page}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Excel Top Header Card */}
                          <div style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 8, padding: "16px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span className="pmo-sev-badge critical" style={{ background: "#0052CC", color: "#FFFFFF", fontWeight: 700 }}>
                                    {selectedDoc.audit_manifest.document_type}
                                  </span>
                                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                    Document Audit Manifest & Verification Key
                                  </h2>
                                </div>
                                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B778C" }}>
                                  Deterministic, row-level extraction basis directly feeding the PMO overview and completion metrics.
                                </p>
                              </div>
                              {selectedDoc.audit_manifest.timeline_span && (
                                <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#172B4D", background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 6, padding: "6px 12px" }}>
                                  <span>Timeline: <strong>{selectedDoc.audit_manifest.timeline_span.start_date}</strong> → <strong>{selectedDoc.audit_manifest.timeline_span.end_date}</strong></span>
                                  <span>•</span>
                                  <span><strong>{selectedDoc.audit_manifest.timeline_span.working_days}</strong> Working Days</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Excel Calculation Basis Callout Box */}
                          {selectedDoc.audit_manifest.calculation_basis && (
                            <div style={{ background: "#DEEBFF", border: "1px solid #B3D4FF", borderRadius: 8, padding: "16px 20px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 18 }}>📐</span>
                                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#0747A6" }}>
                                  Formula & Metric Derivation Basis
                                </h3>
                                {selectedDoc.audit_manifest.deliverables_summary && (
                                  <span style={{ marginLeft: "auto", background: "#0052CC", color: "#FFFFFF", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                                    {selectedDoc.audit_manifest.deliverables_summary.percent}% Completion
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, fontSize: 13, color: "#172B4D", marginTop: 10 }}>
                                <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Numerator (Completed Work)</span>
                                  <div style={{ fontWeight: 600, marginTop: 4, color: "#006644" }}>
                                    {selectedDoc.audit_manifest.calculation_basis.numerator}
                                  </div>
                                </div>
                                <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Denominator (Deliverables Base)</span>
                                  <div style={{ fontWeight: 600, marginTop: 4, color: "#0747A6" }}>
                                    {selectedDoc.audit_manifest.calculation_basis.denominator}
                                  </div>
                                </div>
                                <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Calculation Formula</span>
                                  <div style={{ fontWeight: 700, marginTop: 4, color: "#172B4D", fontFamily: "monospace", fontSize: 14 }}>
                                    {selectedDoc.audit_manifest.calculation_basis.percentage_formula}
                                  </div>
                                </div>
                                <div style={{ background: "#FFFFFF", padding: "10px 14px", borderRadius: 6, border: "1px solid #C1C7D0" }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Active Workstreams & Risk</span>
                                  <div style={{ fontWeight: 600, marginTop: 4, color: "#BF2600" }}>
                                    {selectedDoc.audit_manifest.calculation_basis.active_workstreams}
                                  </div>
                                </div>
                              </div>
                              {selectedDoc.audit_manifest.calculation_basis.ignored_sheets?.length > 0 && (
                                <div style={{ marginTop: 10, fontSize: 12, color: "#5E6C84" }}>
                                  <strong>Excluded Draft/Hidden Worksheets:</strong> {selectedDoc.audit_manifest.calculation_basis.ignored_sheets.join(", ")}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Excel Formula Verification Card */}
                          {selectedDoc.audit_manifest.formulas_manifest?.has_formulas && (
                            <div style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 16 }}>⚡</span>
                                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                    Formula & Expression Verification ({selectedDoc.audit_manifest.formulas_manifest.formula_count} formulas detected)
                                  </h3>
                                </div>
                                <span style={{ background: "#E3FCEF", color: "#006644", padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                  {selectedDoc.audit_manifest.formulas_manifest.status}
                                </span>
                              </div>
                              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#5E6C84" }}>
                                {selectedDoc.audit_manifest.formulas_manifest.notes}
                              </p>
                              {selectedDoc.audit_manifest.formulas_manifest.sample_formulas?.length > 0 && (
                                <div style={{ overflowX: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 4 }}>
                                    <thead>
                                      <tr style={{ background: "#F4F5F7", textAlign: "left", borderBottom: "1px solid #DFE1E6" }}>
                                        <th style={{ padding: "6px 10px" }}>Worksheet</th>
                                        <th style={{ padding: "6px 10px" }}>Cell</th>
                                        <th style={{ padding: "6px 10px" }}>Formula Expression</th>
                                        <th style={{ padding: "6px 10px" }}>Cached Evaluated Value</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {selectedDoc.audit_manifest.formulas_manifest.sample_formulas.map((f, fIdx) => (
                                        <tr key={fIdx} style={{ borderBottom: "1px solid #F4F5F7" }}>
                                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{f.sheet}</td>
                                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#6B778C" }}>{f.cell}</td>
                                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#0052CC" }}>{f.expression}</td>
                                          <td style={{ padding: "6px 10px", fontWeight: 700, color: "#00875A" }}>{f.cached_value}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Excel Worksheet Governance & Roles Table */}
                          {selectedDoc.audit_manifest.sheets_summary?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#172B4D" }}>
                                Worksheet Visibility & Role Resolution
                              </h3>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                                      <th style={{ padding: "8px 10px" }}>Sheet Name</th>
                                      <th style={{ padding: "8px 10px" }}>Visibility</th>
                                      <th style={{ padding: "8px 10px" }}>Resolved Role</th>
                                      <th style={{ padding: "8px 10px" }}>Extraction Status</th>
                                      <th style={{ padding: "8px 10px" }}>Governance Justification</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedDoc.audit_manifest.sheets_summary.map((sh, idx) => (
                                      <tr key={idx} style={{ borderBottom: "1px solid #EBECF0" }}>
                                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>{sh.name}</td>
                                        <td style={{ padding: "8px 10px" }}>
                                          <span style={{
                                            padding: "2px 8px",
                                            borderRadius: 10,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            background: sh.visibility === "visible" ? "#E3FCEF" : "#FFEBE6",
                                            color: sh.visibility === "visible" ? "#006644" : "#BF2600"
                                          }}>
                                            {sh.visibility}
                                          </span>
                                        </td>
                                        <td style={{ padding: "8px 10px" }}>
                                          <span style={{
                                            padding: "2px 8px",
                                            borderRadius: 10,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: sh.role === "PRIMARY_TIMELINE" ? "#DEEBFF" : (sh.role === "SUPPORTING_WBS" ? "#EAE6FF" : "#F4F5F7"),
                                            color: sh.role === "PRIMARY_TIMELINE" ? "#0747A6" : (sh.role === "SUPPORTING_WBS" ? "#403294" : "#5E6C84")
                                          }}>
                                            {sh.role}
                                          </span>
                                        </td>
                                        <td style={{ padding: "8px 10px" }}>
                                          <strong style={{ color: sh.status === "PROCESSED" ? "#00875A" : "#6B778C" }}>
                                            {sh.status}
                                          </strong>
                                        </td>
                                        <td style={{ padding: "8px 10px", color: "#5E6C84" }}>{sh.reason}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Excel Visual Status Legend Swatches */}
                          {selectedDoc.audit_manifest.detected_legend && Object.keys(selectedDoc.audit_manifest.detected_legend).length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#172B4D" }}>
                                Workbook Dynamic Visual Legend
                              </h3>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                                {Object.entries(selectedDoc.audit_manifest.detected_legend).map(([hex, leg], idx) => (
                                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #DFE1E6", borderRadius: 6, background: "#FAFBFC" }}>
                                    <div style={{ width: 22, height: 22, borderRadius: 4, background: hex.startsWith("#") ? hex : "#4F81BD", border: "1px solid #C1C7D0", flexShrink: 0 }} />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#172B4D" }}>{leg.status}</span>
                                        <span style={{ fontSize: 10, color: "#6B778C", fontFamily: "monospace" }}>{hex}</span>
                                      </div>
                                      <div style={{ fontSize: 11, color: "#5E6C84", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={leg.label}>
                                        {leg.label}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Excel Primary Deliverables Breakdown Table */}
                          {selectedDoc.audit_manifest.deliverables?.length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                  Primary Project Deliverables ({selectedDoc.audit_manifest.deliverables.length})
                                </h3>
                                <span style={{ fontSize: 12, color: "#6B778C" }}>
                                  Source: <strong>{selectedDoc.audit_manifest.primary_timeline_sheet}</strong>
                                </span>
                              </div>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                  <thead>
                                    <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                                      <th style={{ padding: "8px 10px" }}>Row</th>
                                      <th style={{ padding: "8px 10px" }}>Deliverable / Workstream</th>
                                      <th style={{ padding: "8px 10px" }}>Owner</th>
                                      <th style={{ padding: "8px 10px" }}>Duration</th>
                                      <th style={{ padding: "8px 10px" }}>Execution Status</th>
                                      <th style={{ padding: "8px 10px" }}>Schedule Deviation</th>
                                      <th style={{ padding: "8px 10px" }}>Timeline Window</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedDoc.audit_manifest.deliverables.map((d, idx) => (
                                      <tr key={idx} style={{ borderBottom: "1px solid #EBECF0" }}>
                                        <td style={{ padding: "8px 10px", color: "#6B778C" }}>{d.row}</td>
                                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "#172B4D" }}>{d.title}</td>
                                        <td style={{ padding: "8px 10px" }}>{d.owner || "Unassigned"}</td>
                                        <td style={{ padding: "8px 10px" }}>{d.duration}</td>
                                        <td style={{ padding: "8px 10px" }}>
                                          <span style={{
                                            padding: "2px 8px",
                                            borderRadius: 10,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            background: d.status === "COMPLETED" ? "#E3FCEF" : (d.status === "IN_PROGRESS" ? "#DEEBFF" : "#F4F5F7"),
                                            color: d.status === "COMPLETED" ? "#006644" : (d.status === "IN_PROGRESS" ? "#0747A6" : "#42526E")
                                          }}>
                                            {d.status}
                                          </span>
                                        </td>
                                        <td style={{ padding: "8px 10px" }}>
                                          {d.has_extension ? (
                                            <span style={{ background: "#FFEBE6", color: "#BF2600", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                              ⚠️ +{d.extension_days}d extended
                                            </span>
                                          ) : (
                                            <span style={{ color: "#00875A", fontSize: 11, fontWeight: 600 }}>✓ On schedule</span>
                                          )}
                                        </td>
                                        <td style={{ padding: "8px 10px", color: "#5E6C84" }}>
                                          {d.start_date && d.end_date ? `${d.start_date} → ${d.end_date}` : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Excel Supporting WBS & Team Capacity Summary */}
                          {selectedDoc.audit_manifest.team_capacity && Object.keys(selectedDoc.audit_manifest.team_capacity).length > 0 && (
                            <div style={{ background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 8, padding: 16 }}>
                              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#172B4D" }}>
                                Supporting WBS & Engineer Capacity Allocation
                              </h3>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                                {Object.values(selectedDoc.audit_manifest.team_capacity).map((cap, idx) => (
                                  <div key={idx} style={{ border: "1px solid #DFE1E6", borderRadius: 6, padding: "12px 14px", background: "#FAFBFC" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <span style={{ fontWeight: 700, fontSize: 13, color: "#172B4D" }}>{cap.name}</span>
                                      <span style={{ background: "#EAE6FF", color: "#403294", padding: "1px 6px", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                                        {cap.effort_hours}h effort
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#6B778C", marginTop: 4 }}>
                                      Working span: {cap.working_days} working days • {cap.source_location}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {selectedDoc.audit_manifest.wbs_subtasks?.length > 0 && (
                                <div style={{ marginTop: 12, fontSize: 12, color: "#5E6C84" }}>
                                  <strong>{selectedDoc.audit_manifest.wbs_subtasks.length} detailed subtasks</strong> mapped from sheet <em>{selectedDoc.audit_manifest.supporting_wbs_sheet}</em>.
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Shared Cross-Document Alignment & Conflict Detection Section */}
                      <div style={{ background: "#FAFBFC", border: "1px solid #DFE1E6", borderRadius: 8, padding: 20, marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 18 }}>⚖️</span>
                              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                                Cross-Document Alignment & Metric Provenance
                              </h3>
                            </div>
                            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B778C" }}>
                              Multi-source reconciliation tracking authoritative contributors and detecting conflicting assertions across uploaded project assets.
                            </p>
                          </div>
                          {crossDocIntelligence?.ai_reconciliation_schema && (
                            <div style={{ background: "#EAE6FF", color: "#403294", padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                              <span>AI Reconciliation:</span>
                              <code>{crossDocIntelligence.ai_reconciliation_schema.reconciliation_mode || crossDocIntelligence.ai_reconciliation_schema.layer_status}</code>
                            </div>
                          )}
                        </div>

                        {/* AI Entity Matches & Scope Disambiguation Table */}
                        {crossDocIntelligence?.ai_reconciliation_schema?.matched_entities?.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "#5E6C84", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              AI Entity Matching & Scope Disambiguation ({crossDocIntelligence.ai_reconciliation_schema.matched_entities.length} aligned items)
                            </h4>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 6 }}>
                                <thead>
                                  <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                                    <th style={{ padding: "8px 10px" }}>Workstream / Entity</th>
                                    <th style={{ padding: "8px 10px" }}>Excel Timeline Deliverable</th>
                                    <th style={{ padding: "8px 10px" }}>Narrative Report Activity</th>
                                    <th style={{ padding: "8px 10px" }}>Scope Relation</th>
                                    <th style={{ padding: "8px 10px" }}>State Alignment</th>
                                    <th style={{ padding: "8px 10px" }}>Confidence</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {crossDocIntelligence.ai_reconciliation_schema.matched_entities.map((m, idx) => (
                                    <tr key={idx} style={{ borderBottom: "1px solid #EBECF0" }}>
                                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "#172B4D" }}>{m.entity_name}</td>
                                      <td style={{ padding: "8px 10px", color: "#0052CC" }}>{m.excel_item} ({m.excel_status})</td>
                                      <td style={{ padding: "8px 10px", color: "#403294" }}>{m.narrative_item}</td>
                                      <td style={{ padding: "8px 10px" }}>
                                        <span style={{ background: m.relationship === "SUBTASK_VALIDATION" ? "#EAE6FF" : "#E3FCEF", color: m.relationship === "SUBTASK_VALIDATION" ? "#403294" : "#006644", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                                          {m.relationship}
                                        </span>
                                      </td>
                                      <td style={{ padding: "8px 10px" }}>
                                        {m.has_conflict ? (
                                          <span style={{ color: "#BF2600", fontWeight: 700 }}>⚠️ Divergent ({m.excel_status} vs {m.report_status})</span>
                                        ) : (
                                          <span style={{ color: "#006644", fontWeight: 600 }}>✓ Aligned</span>
                                        )}
                                      </td>
                                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "#5E6C84" }}>
                                        {Math.round((m.confidence || 0.9) * 100)}%
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Metric Provenance Table */}
                        {crossDocIntelligence?.cross_document_contributions?.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <h4 style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "#5E6C84", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              Authoritative Metric Sources
                            </h4>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#FFFFFF", border: "1px solid #DFE1E6", borderRadius: 6 }}>
                                <thead>
                                  <tr style={{ background: "#F4F5F7", borderBottom: "2px solid #DFE1E6", textAlign: "left" }}>
                                    <th style={{ padding: "8px 10px" }}>Project Metric</th>
                                    <th style={{ padding: "8px 10px" }}>Authoritative Source</th>
                                    <th style={{ padding: "8px 10px" }}>Method / Status</th>
                                    <th style={{ padding: "8px 10px" }}>Corroborating Source</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {crossDocIntelligence.cross_document_contributions.map((c, idx) => (
                                    <tr key={idx} style={{ borderBottom: "1px solid #EBECF0" }}>
                                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "#172B4D" }}>{c.metric}</td>
                                      <td style={{ padding: "8px 10px" }}>
                                        <span style={{ background: "#DEEBFF", color: "#0747A6", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                                          {c.authoritative_source}
                                        </span>
                                      </td>
                                      <td style={{ padding: "8px 10px", color: "#172B4D" }}>{c.status || c.method}</td>
                                      <td style={{ padding: "8px 10px", color: "#5E6C84" }}>{c.corroborating_source || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Detected Cross-Document Discrepancies */}
                        {crossDocIntelligence?.cross_document_discrepancies?.length > 0 ? (
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <h4 style={{ fontSize: 12, fontWeight: 700, margin: 0, color: "#BF2600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                ⚠️ Detected Cross-Document Conflicts ({crossDocIntelligence.cross_document_discrepancies.length})
                              </h4>
                              <span style={{ fontSize: 11, color: "#6B778C" }}>Automated discrepancy engine</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {crossDocIntelligence.cross_document_discrepancies.map((disc, idx) => (
                                <div key={idx} style={{ background: "#FFFBF0", border: "1px solid #FFE380", borderRadius: 6, padding: "12px 14px" }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ background: disc.severity === "HIGH" ? "#FFEBE6" : "#FFFAE6", color: disc.severity === "HIGH" ? "#BF2600" : "#FF8B00", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                                        {disc.id} • {disc.severity}
                                      </span>
                                      <strong style={{ fontSize: 13, color: "#172B4D" }}>{disc.title}</strong>
                                    </div>
                                    <span style={{ fontSize: 10, color: "#6B778C", fontFamily: "monospace" }}>{disc.type}</span>
                                  </div>
                                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "#172B4D" }}>
                                    {disc.conflict_summary}
                                  </p>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8, fontSize: 11 }}>
                                    <div style={{ background: "#FFFFFF", padding: "8px 10px", borderRadius: 4, border: "1px solid #DFE1E6" }}>
                                      <div style={{ fontWeight: 700, color: "#0052CC", marginBottom: 2 }}>{disc.source_a?.doc}</div>
                                      <div style={{ color: "#172B4D" }}>{disc.source_a?.reported_state}</div>
                                      <div style={{ color: "#6B778C", fontSize: 10, marginTop: 2 }}>Location: {disc.source_a?.location}</div>
                                    </div>
                                    <div style={{ background: "#FFFFFF", padding: "8px 10px", borderRadius: 4, border: "1px solid #DFE1E6" }}>
                                      <div style={{ fontWeight: 700, color: "#6554C0", marginBottom: 2 }}>{disc.source_b?.doc}</div>
                                      <div style={{ color: "#172B4D" }}>{disc.source_b?.reported_state}</div>
                                      <div style={{ color: "#6B778C", fontSize: 10, marginTop: 2 }}>Location: {disc.source_b?.location}</div>
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#42526E", background: "#F4F5F7", padding: "6px 10px", borderRadius: 4 }}>
                                    <strong>Reconciliation Action:</strong> {disc.reconciliation_action}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: "#E3FCEF", border: "1px solid #ABF5D1", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#006644", display: "flex", alignItems: "center", gap: 8 }}>
                            <span>✓</span>
                            <span>All uploaded project documents are mathematically and semantically aligned with zero detected contradictions.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="pmo-empty" style={{ padding: "30px 10px", background: "#FAFBFC", border: "1px dashed #DFE1E6", borderRadius: 8 }}>
                      No audit manifest available for this document. Click <strong>Re-analyze</strong> to extract intelligence manifest.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="jira-docs-no-selection">
            <span>Select or create a document to view.</span>
          </div>
        )}
      </div>

      {/* New Document Markdown Modal */}
      {showNewModal && (
        <div className="jira-modal-backdrop" onClick={() => setShowNewModal(false)}>
          <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="jira-modal-header">
              <h2 className="jira-modal-title">Create Documentation Page</h2>
              <button className="jira-btn-icon-close" onClick={() => setShowNewModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleCreateFromTemplate} className="jira-modal-body">
              <div className="jira-form-field">
                <label className="jira-field-label">Choose Engineering Template</label>
                <div className="jira-template-picker-grid">
                  {TEMPLATES.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className={`jira-template-card ${selectedTemplate === tmpl.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedTemplate(tmpl.id);
                        setEditContent(tmpl.content);
                      }}
                    >
                      <span className="jira-tmpl-icon" style={{ fontSize: 10, fontWeight: 700, color: "#0052CC", background: "#DEEBFF", borderRadius: 3, padding: "1px 5px" }}>{tmpl.icon}</span>
                      <span className="jira-tmpl-name">{tmpl.name}</span>
                      <span className="jira-tmpl-tag">{tmpl.tag}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="jira-form-field" style={{ marginTop: 14 }}>
                <label className="jira-field-label">Page Title <span className="jira-req">*</span></label>
                <input
                  type="text"
                  className="jira-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. Q3 Sprint Retrospective"
                  required
                  autoFocus
                />
              </div>

              <div className="jira-form-field" style={{ marginTop: 14 }}>
                <label className="jira-field-label">Initial Content (Markdown)</label>
                <textarea
                  className="jira-doc-textarea"
                  rows={8}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </div>

              <div className="jira-modal-footer" style={{ padding: "14px 0 0 0", marginTop: 14 }}>
                <button type="button" className="jira-btn-secondary" onClick={() => setShowNewModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="jira-btn-primary" disabled={saving}>
                  {saving ? "Creating in DB..." : "Create Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload File Modal */}
      {showUploadModal && (
        <div className="jira-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="jira-modal-header">
              <div className="jira-modal-title-group">
                <h2 className="jira-modal-title">Upload Project Document</h2>
                <span className="jira-sub-key">Excel (.xlsx), Word (.docx), PDF (.pdf), or Markdown (.md)</span>
              </div>
              <button className="jira-btn-icon-close" onClick={() => setShowUploadModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleUploadDoc} className="jira-modal-body" style={{ gap: 14 }}>
              <div className="jira-form-field">
                <label className="jira-field-label">Select File <span className="jira-req">*</span></label>
                <div style={{ border: "2px dashed #DFE1E6", borderRadius: 8, padding: "20px 14px", textAlign: "center", background: "#FAFBFC" }}>
                  <input
                    type="file"
                    id="doc-file-input"
                    accept=".xlsx,.xls,.docx,.pdf,.md,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setUploadFile(f);
                        if (!uploadTitle.trim()) {
                          setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                        }
                      }
                    }}
                    style={{ display: "none" }}
                  />
                  <label htmlFor="doc-file-input" style={{ cursor: "pointer", display: "inline-block" }}>
                    <div style={{ color: "#0052CC", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {uploadFile ? uploadFile.name : "Click to select a document from your computer"}
                    </div>
                    <span style={{ fontSize: 12, color: "#6B778C" }}>
                      Supports Excel spreadsheets, Word documents, PDF reports, and Markdown
                    </span>
                  </label>
                </div>
              </div>

              <div className="jira-form-field">
                <label className="jira-field-label">Document Title</label>
                <input
                  type="text"
                  className="jira-input"
                  placeholder="e.g. Q4 Release Plan & Milestones"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
              </div>

              <div className="jira-form-field">
                <label className="jira-field-label">Document Classification</label>
                <select
                  className="jira-select"
                  value={uploadTemplateType}
                  onChange={(e) => setUploadTemplateType(e.target.value)}
                >
                  <option value="STATUS">Weekly / Project Status Report</option>
                  <option value="TIMELINE">Project Plan & Milestones Schedule</option>
                  <option value="RESOURCE">Resource & Team Allocation</option>
                  <option value="PRD">Product Requirements Document (PRD)</option>
                  <option value="ARCHITECTURE">Architecture & Technical Design</option>
                  <option value="MEETING">Meeting Notes & Decisions</option>
                  <option value="RETRO">Sprint Retrospective</option>
                  <option value="CUSTOM">Auto-classify Document</option>
                </select>
              </div>

              <div className="jira-modal-footer" style={{ padding: "14px 0 0 0", marginTop: 10 }}>
                <button type="button" className="jira-btn-secondary" onClick={() => setShowUploadModal(false)} disabled={uploading}>
                  Cancel
                </button>
                <button type="submit" className="jira-btn-primary" disabled={uploading || !uploadFile}>
                  {uploading ? "Analyzing Document…" : "Upload & Analyze Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple Markdown parser for headers, lists, code blocks, bold, etc.
function renderMarkdown(md = "") {
  if (!md) return "<p>No content in this document.</p>";

  return md
    .replace(/^### (.*$)/gim, '<h3 class="jira-md-h3">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="jira-md-h2">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="jira-md-h1">$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    .replace(/`([^`]+)`/gim, '<code class="jira-md-inline-code">$1</code>')
    .replace(/^- (.*$)/gim, '<li class="jira-md-li">$1</li>')
    .replace(/\[ \]/gim, '<input type="checkbox" disabled />')
    .replace(/\[x\]/gim, '<input type="checkbox" checked disabled />')
    .replace(/\n\n/gim, "<br/><br/>")
    .replace(/\n/gim, "<br/>");
}
