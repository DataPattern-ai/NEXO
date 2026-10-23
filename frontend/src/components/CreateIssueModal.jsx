import { useState, useEffect } from "react";
import { userLabel } from "../utils/userLabel";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function CreateIssueModal({
  isOpen,
  onClose,
  onIssueCreated,
  currentProjectId = null,
  projects = [],
  members = [],
}) {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState(currentProjectId || "");
  const [issueType, setIssueType] = useState("TASK");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [workstream, setWorkstream] = useState("");
  const [parentId, setParentId] = useState("");
  const [existingIssues, setExistingIssues] = useState([]);
  const [projectMembers, setProjectMembers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (currentProjectId) {
      setProjectId(currentProjectId);
    } else if (projects.length > 0 && !projectId) {
      setProjectId(projects[0].id);
    }
  }, [currentProjectId, projects]);

  useEffect(() => {
    if (projectId) {
      api.get(`/issues/?project=${projectId}`)
        .then((res) => setExistingIssues(res.data))
        .catch(() => {});
      // Load members for the selected project
      api.get(`/projects/${projectId}/`)
        .then((res) => setProjectMembers(res.data.members || []))
        .catch(() => {});
    }
  }, [projectId]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        project: projectId,
        title: title.trim(),
        description: description.trim(),
        issue_type: issueType,
        priority: priority,
        due_date: dueDate || null,
        workstream: workstream.trim() || "",
        assignee_id: assigneeId ? Number(assigneeId) : null,
      };

      if (issueType === "SUBTASK" && parentId) {
        payload.parent = Number(parentId);
      }

      await api.post("/issues/", payload);
      setTitle("");
      setDescription("");
      setWorkstream("");
      setParentId("");
      onIssueCreated && onIssueCreated();
      onClose();
    } catch (err) {
      const data = err.response?.data;
      const first = data && typeof data === "object" ? Object.values(data).flat()[0] : null;
      setError(data?.detail || (typeof first === "string" ? first : "Failed to create issue. Please check fields."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="jira-modal-header">
          <h2 className="jira-modal-title">Create issue</h2>
          <button className="jira-btn-icon-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="jira-modal-body">
          {error && <div className="jira-alert-error">{error}</div>}

          {/* Project & Issue Type Selection */}
          <div className="jira-form-row-2">
            <div className="jira-form-field">
              <label className="jira-field-label">Project <span className="jira-req">*</span></label>
              <select
                className="jira-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </div>

            <div className="jira-form-field">
              <label className="jira-field-label">Issue type <span className="jira-req">*</span></label>
              <select
                className="jira-select"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                required
              >
                <option value="TASK">☑ Task</option>
                <option value="BUG">Bug</option>
                <option value="STORY">Story</option>
                <option value="EPIC">Epic</option>
                <option value="SUBTASK">Subtask</option>
              </select>
            </div>
          </div>

          {/* Summary / Title */}
          <div className="jira-form-field">
            <label className="jira-field-label">Summary <span className="jira-req">*</span></label>
            <input
              type="text"
              className="jira-input"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="jira-form-field">
            <label className="jira-field-label">Description</label>
            <textarea
              className="jira-textarea"
              placeholder="Add more details, acceptance criteria, or steps to reproduce..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* If Subtask, select Parent Issue */}
          {issueType === "SUBTASK" && (
            <div className="jira-form-field">
              <label className="jira-field-label">Parent Issue <span className="jira-req">*</span></label>
              <select
                className="jira-select"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                required={issueType === "SUBTASK"}
              >
                <option value="">Select parent issue...</option>
                {existingIssues.filter((i) => !i.parent).map((i) => (
                  <option key={i.id} value={i.id}>
                    #{i.id}: {i.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Priority & Assignee */}
          <div className="jira-form-row-2">
            <div className="jira-form-field">
              <label className="jira-field-label">Priority</label>
              <select
                className="jira-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>

            {/* Assignee — only visible to Admins */}
            {projectMembers.some((m) => (m.user?.id || m.id) === user?.id && m.role === "ADMIN") && (
              <div className="jira-form-field">
                <label className="jira-field-label">Assignee</label>
                <select
                  className="jira-select"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {projectMembers.map((m) => (
                    <option key={m.user?.id || m.id} value={m.user?.id || m.id}>
                      {m.user ? userLabel(m.user) : m.username}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Due Date & Workstream */}
          <div className="jira-form-row-2">
            <div className="jira-form-field">
              <label className="jira-field-label">Due Date (Optional)</label>
              <input
                type="date"
                className="jira-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="jira-form-field">
              <label className="jira-field-label">Workstream (Optional)</label>
              <input
                type="text"
                className="jira-input"
                placeholder="e.g. Frontend, Auth, Billing"
                value={workstream}
                onChange={(e) => setWorkstream(e.target.value)}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="jira-modal-footer">
            <button type="button" className="jira-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="jira-btn-primary" disabled={submitting}>
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
