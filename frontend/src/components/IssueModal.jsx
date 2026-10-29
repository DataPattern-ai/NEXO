import { useEffect, useRef, useState } from "react";
import { userLabel } from "../utils/userLabel";
import api, { downloadFile } from "../api/client";
import MentionTextarea from "./MentionTextarea";
import MarkdownRenderer from "./MarkdownRenderer";
import { FileIcon, AttachmentIcon, IssueTypeIcon, PriorityIcon } from "./Icons";
import { can as canPermission, ACTIONS } from "../permissions";
import { useAuth } from "../context/AuthContext";

export default function IssueModal({ issueId, projectKey, members = [], currentUser: currentUserProp, role: roleProp, isViewer = false, isAdmin = false, onClose, onUpdate }) {
  const { user: authUser } = useAuth();
  // Use prop if passed, fall back to auth context
  const currentUser = currentUserProp || authUser;
  // Derive role for can() — single source of truth
  const role = roleProp || (isAdmin ? "ADMIN" : isViewer ? "VIEWER" : "MANAGER");
  const can = (action, ctx = {}) => canPermission(role, action, ctx);
  // Members (and Viewers) can't edit fields; Members may still change status and resolution.
  const readOnly = !can(ACTIONS.EDIT_ISSUE);
  const statusLocked = !can(ACTIONS.CHANGE_ISSUE_STATUS);
  const resolutionLocked = !can(ACTIONS.CHANGE_RESOLUTION);
  const [issue, setIssue] = useState(null);
  const [newComment, setNewComment] = useState("");
  const [tab, setTab] = useState("comments");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descVal, setDescVal] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [showSubtaskAdd, setShowSubtaskAdd] = useState(false);
  const [workstreamVal, setWorkstreamVal] = useState("");

  // Attachments state
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  // Comment edit state
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentBody, setEditCommentBody] = useState("");

  function load() {
    api.get(`/issues/${issueId}/`).then((res) => {
      setIssue(res.data);
      setTitleVal(res.data.title);
      setDescVal(res.data.description || "");
      setWorkstreamVal(res.data.workstream || "");
    }).catch(() => {});
  }

  useEffect(() => {
    load();
  }, [issueId]);

  // Save one or several fields in a single request (so paired fields like status + resolution can't race).
  async function updateFields(payload) {
    try {
      const res = await api.patch(`/issues/${issueId}/`, payload);
      setIssue(res.data);
      if (payload.workstream !== undefined) {
        setWorkstreamVal(res.data.workstream || "");
      }
      onUpdate && onUpdate();
      return true;
    } catch (err) {
      const data = err?.response?.data;
      const first = data && typeof data === "object" ? Object.values(data).flat()[0] : null;
      alert(data?.detail || (typeof first === "string" ? first : "Could not save your change. Please try again."));
      return false;
    }
  }
  const updateField = (field, value) => updateFields({ [field]: value });

  // Each Save closes its editor only when the save really went through; failures show the server's message.
  async function handleSaveTitle(e) {
    e?.preventDefault();
    if (!titleVal.trim()) return;
    if (await updateFields({ title: titleVal.trim() })) setIsEditingTitle(false);
  }

  async function handleSaveDesc(e) {
    e?.preventDefault();
    if (await updateFields({ description: descVal })) setIsEditingDesc(false);
  }

  async function handleAddSubtask(e) {
    e.preventDefault();
    if (!subtaskTitle.trim() || !issue) return;
    try {
      await api.post("/issues/", {
        project: issue.project,
        parent: issue.id,
        title: subtaskTitle.trim(),
        issue_type: "TASK",
        priority: "MEDIUM",
        status: "TODO",
      });
      setSubtaskTitle("");
      setShowSubtaskAdd(false);
      load();
      onUpdate && onUpdate();
    } catch (err) {
      alert("Failed to add subtask.");
    }
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      await api.post("/comments/", { issue: issueId, body: newComment.trim() });
      setNewComment("");
      load();
    } catch (err) {
      alert("Error adding comment.");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleDeleteIssue() {
    if (!window.confirm("Are you sure you want to delete this issue? This cannot be undone.")) return;
    try {
      await api.delete(`/issues/${issueId}/`);
      onClose();
      onUpdate && onUpdate();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Could not delete issue.";
      alert(msg);
    }
  }

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadError("");
    setUploadingFile(true);
    try {
      for (const file of files) {
        if (file.size > 4.5 * 1024 * 1024) {
          setUploadError(`"${file.name}" exceeds the 4.5 MB serverless limit.`);
          continue;
        }
        const formData = new FormData();
        formData.append("file", file);
        formData.append("issue", issueId);
        await api.post("/attachments/", formData);
      }
      load();
    } catch (err) {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownloadAttachment(att) {
    if (!att?.url) return;
    try {
      await downloadFile(att.url, att.filename || "attachment");
    } catch (err) {
      alert("Failed to download attachment: " + (err?.response?.data?.error || err.message));
    }
  }

  async function handleDeleteAttachment(attachmentId) {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.delete(`/attachments/${attachmentId}/`);
      load();
    } catch {
      alert("Could not delete attachment.");
    }
  }

  async function handleEditComment(e) {
    e.preventDefault();
    if (!editCommentBody.trim()) return;
    try {
      await api.patch(`/comments/${editingCommentId}/`, { body: editCommentBody.trim() });
      setEditingCommentId(null);
      setEditCommentBody("");
      load();
    } catch {
      alert("Could not update comment.");
    }
  }

  async function handleDeleteComment(commentId) {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/comments/${commentId}/`);
      load();
    } catch {
      alert("Could not delete comment.");
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(contentType = "") {
    return <FileIcon contentType={contentType} size={18} />;
  }

  if (!issue) return null;

  const keyDisplay = `${projectKey || "KAN"}-${issue.id}`;
  const reporterName = userLabel(issue.reporter) || "Project Member";
  const reporterInitials = reporterName.substring(0, 2).toUpperCase();

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-issue-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Top Navigation */}
        <div className="jira-drawer-top">
          <div className="jira-drawer-key-group">
            <span className="jira-drawer-type-badge">
              {issue.parent ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <IssueTypeIcon type="SUBTASK" size={12} /> Subtask
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <IssueTypeIcon type={issue.issue_type} size={12} /> {issue.issue_type}
                </span>
              )}
            </span>
            <span className="jira-drawer-key">{keyDisplay}</span>
          </div>

          <div className="jira-drawer-actions">
            {/* Delete — org Admins only (the backend enforces it too) */}
            {can(ACTIONS.DELETE_ISSUE) && (
              <button className="jira-btn-icon-plain" onClick={handleDeleteIssue} title="Delete issue">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#de350b" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            )}
            <button className="jira-btn-icon-close" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content Layout: Two Columns */}
        <div className="jira-drawer-content">
          {/* Left Main Column */}
          <div className="jira-drawer-left">
            {/* Title */}
            {isEditingTitle && !readOnly ? (
              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  className="jira-input"
                  value={titleVal}
                  onChange={(e) => setTitleVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle(e);
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" className="jira-btn-primary-sm" onClick={handleSaveTitle}>Save</button>
                  <button type="button" className="jira-btn-secondary-sm" onClick={() => setIsEditingTitle(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <h1
                className="jira-drawer-title"
                onClick={() => {
                  if (readOnly) return;
                  setTitleVal(issue.title || "");
                  setIsEditingTitle(true);
                }}
                title={readOnly ? undefined : "Click to edit summary"}
                style={{ cursor: readOnly ? "default" : "pointer" }}
              >
                {issue.title}
              </h1>
            )}

            {/* Description */}
            <div className="jira-drawer-section">
              <label className="jira-drawer-label">Description</label>
              {isEditingDesc && !readOnly ? (
                <div>
                  <textarea
                    className="jira-textarea"
                    rows={4}
                    value={descVal}
                    onChange={(e) => setDescVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSaveDesc(e);
                      }
                      if (e.key === "Escape") {
                        setIsEditingDesc(false);
                      }
                    }}
                    placeholder="Add a description..."
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" className="jira-btn-primary-sm" onClick={handleSaveDesc}>Save</button>
                    <button type="button" className="jira-btn-secondary-sm" onClick={() => setIsEditingDesc(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  className="jira-desc-preview"
                  onClick={() => {
                    if (readOnly) return;
                    setDescVal(issue.description || "");
                    setIsEditingDesc(true);
                  }}
                  title={readOnly ? undefined : "Click to edit description"}
                  style={{ cursor: readOnly ? "default" : "pointer" }}
                >
                  {issue.description ? (
                    <div style={{ whiteSpace: "pre-wrap" }}>{issue.description}</div>
                  ) : (
                    <span className="jira-placeholder-text">{readOnly ? "No description." : "Add a description..."}</span>
                  )}
                </div>
              )}
            </div>

            {/* Subtasks Section */}
            {!issue.parent && (
              <div className="jira-drawer-section">
                <div className="jira-section-header-flex">
                  <label className="jira-drawer-label">Subtasks ({issue.subtasks?.length || 0})</label>
                  {can(ACTIONS.CREATE_SUBTASK) && (
                    <button className="jira-btn-link-sm" onClick={() => setShowSubtaskAdd(true)}>
                      + Add subtask
                    </button>
                  )}
                </div>

                {showSubtaskAdd && (
                  <form onSubmit={handleAddSubtask} className="jira-subtask-form">
                    <input
                      type="text"
                      className="jira-input-sm"
                      placeholder="What needs to be done in this subtask?"
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button type="submit" className="jira-btn-primary-sm">Add</button>
                      <button type="button" className="jira-btn-secondary-sm" onClick={() => setShowSubtaskAdd(false)}>Cancel</button>
                    </div>
                  </form>
                )}

                <div className="jira-subtasks-list">
                  {issue.subtasks?.map((st) => (
                    <div key={st.id} className="jira-subtask-row">
                      <div className="jira-subtask-row-left">
                        <span className={`jira-subtask-key ${st.status === "DONE" ? "strikethrough" : ""}`}>
                          {projectKey}-{st.id}
                        </span>
                        <span className="jira-subtask-title">{st.title}</span>
                      </div>
                      <span className={`jira-status-pill-mini ${st.status.toLowerCase()}`}>
                        {st.status === "IN_PROGRESS" ? "In Progress" : st.status === "DONE" ? "Done" : "To Do"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attachments Section */}
            <div className="jira-drawer-section">
              <div className="jira-section-header-flex">
                <label className="jira-drawer-label">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AttachmentIcon size={14} /> Attachments ({issue.attachments?.length || 0})
                  </span>
                </label>
                  {can(ACTIONS.UPLOAD_ATTACHMENT) && (
                    <button
                      className="jira-btn-link-sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                    >
                      {uploadingFile ? "Uploading..." : "+ Attach File"}
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFileUpload} />
              </div>

              {uploadError && (
                <div className="jira-auth-alert-error" style={{ marginBottom: 8 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div className="jira-auth-alert-msg">{uploadError}</div>
                </div>
              )}

              {/* Drop zone when no attachments */}
              {!issue.attachments?.length && !uploadingFile && (
                <div
                  className="jira-attachment-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dt = e.dataTransfer;
                    if (dt.files.length) {
                      const syntheticEvent = { target: { files: dt.files } };
                      handleFileUpload(syntheticEvent);
                    }
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B778C" strokeWidth="1.5">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  <span>Drop files here or click to upload</span>
                  <span style={{ fontSize: 11, color: "#97A0AF" }}>Max 10 MB per file</span>
                </div>
              )}

              {/* Attachment list */}
              {issue.attachments?.length > 0 && (
                <div className="jira-attachment-list">
                  {issue.attachments.map((att) => (
                    <div key={att.id} className="jira-attachment-row">
                      <span className="jira-attachment-icon">{getFileIcon(att.content_type)}</span>
                      <div className="jira-attachment-info">
                        <button
                          type="button"
                          onClick={() => handleDownloadAttachment(att)}
                          className="jira-attachment-name"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0052CC",
                            fontWeight: 500,
                            cursor: "pointer",
                            textAlign: "left",
                            textDecoration: "underline",
                          }}
                          title={`Download ${att.filename}`}
                        >
                          {att.filename}
                        </button>
                        <span className="jira-attachment-meta">
                          {formatBytes(att.file_size)} · {userLabel(att.uploaded_by)} · {new Date(att.uploaded_at).toLocaleDateString()}
                        </span>
                      </div>
                      {can(ACTIONS.DELETE_ATTACHMENT, { isOwnAttachment: att.uploaded_by?.id === currentUser?.id }) && (
                        <button
                          className="jira-btn-icon-plain"
                          title="Delete attachment"
                          onClick={() => handleDeleteAttachment(att.id)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#de350b" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  {/* Re-upload button when files already exist */}
                  <button
                    className="jira-btn-link-xs"
                    style={{ marginTop: 6 }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                  >
                    + Add more files
                  </button>
                </div>
              )}
            </div>

            {/* Activity & Comments Tabs */}
            <div className="jira-drawer-section">
              <div className="jira-tabs-bar-sm">
                <button
                  className={`jira-tab-btn-sm ${tab === "comments" ? "active" : ""}`}
                  onClick={() => setTab("comments")}
                >
                  Comments ({issue.comments?.length || 0})
                </button>
                <button
                  className={`jira-tab-btn-sm ${tab === "activity" ? "active" : ""}`}
                  onClick={() => setTab("activity")}
                >
                  Activity ({issue.activity_log?.length || 0})
                </button>
              </div>

              {tab === "comments" ? (
                <div className="jira-comments-wrap">
                  {issue.comments?.length === 0 && (
                    <p className="jira-empty-muted" style={{ padding: "12px 0" }}>No comments yet. Be the first to comment.</p>
                  )}
                  {issue.comments?.map((c) => (
                    <div key={c.id} className="jira-comment-item">
                      <div className="jira-avatar-circle small">
                        {c.author?.username?.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="jira-comment-body">
                        <div className="jira-comment-meta">
                          <strong>{userLabel(c.author)}</strong>
                          <span className="jira-comment-time">{new Date(c.created_at).toLocaleString()}</span>
                          {c.updated_at !== c.created_at && (
                            <span className="jira-comment-edited">(edited)</span>
                          )}
                        </div>

                        {editingCommentId === c.id ? (
                          <form onSubmit={handleEditComment} className="jira-comment-edit-form">
                            <MentionTextarea
                              value={editCommentBody}
                              onChange={setEditCommentBody}
                              members={members}
                              rows={3}
                            />
                            <div className="jira-comment-edit-actions">
                              <button type="submit" className="jira-btn-primary-sm">Save</button>
                              <button
                                type="button"
                                className="jira-btn-secondary-sm"
                                onClick={() => { setEditingCommentId(null); setEditCommentBody(""); }}
                              >Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="jira-comment-text">
                              <MarkdownRenderer>{c.body}</MarkdownRenderer>
                            </div>
                            <div className="jira-comment-actions">
                              {(can(ACTIONS.EDIT_OWN_COMMENT, { isOwnComment: c.author?.id === currentUser?.id })) && (
                                <button className="jira-comment-action-btn"
                                  onClick={() => { setEditingCommentId(c.id); setEditCommentBody(c.body); }}>Edit</button>
                              )}
                              {(can(ACTIONS.DELETE_OWN_COMMENT, { isOwnComment: c.author?.id === currentUser?.id })) && (
                                <button className="jira-comment-action-btn danger"
                                  onClick={() => handleDeleteComment(c.id)}>Delete</button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {can(ACTIONS.ADD_COMMENT) && (
                    <form onSubmit={submitComment} className="jira-add-comment-form">
                      <MentionTextarea
                        value={newComment}
                        onChange={setNewComment}
                        members={members}
                        rows={3}
                        disabled={submittingComment}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                        <button type="submit" className="jira-btn-primary-sm" disabled={submittingComment || !newComment.trim()}>
                          {submittingComment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div className="jira-activity-log-list">
                  {issue.activity_log?.map((a) => (
                    <div key={a.id} className="jira-activity-item">
                      <strong>{userLabel(a.actor) || "User"}</strong> changed <em>{a.field_changed}</em> from{" "}
                      <code>{a.old_value || "none"}</code> to <code>{a.new_value || "none"}</code>
                      <span className="jira-activity-time">{new Date(a.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {(!issue.activity_log || issue.activity_log.length === 0) && (
                    <p className="jira-empty-muted">No activity logged yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar Column */}
          <div className="jira-drawer-right">
            {/* Status Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Status</label>
              {statusLocked ? (
                <div className="jira-drawer-field-readonly">
                  <span>{issue.status === "IN_PROGRESS" ? "In Progress" : issue.status === "DONE" ? "Done" : "To Do"}</span>
                </div>
              ) : (
                <select className="jira-select" value={issue.status} onChange={(e) => updateField("status", e.target.value)}>
                  <option value="TODO">To Do</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              )}
            </div>

            {/* Resolution Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Resolution</label>
              {resolutionLocked ? (
                <div className="jira-drawer-field-readonly"><span>{issue.resolution || "Unresolved"}</span></div>
              ) : (
                <select
                  className="jira-select"
                  value={issue.resolution || (issue.status === "DONE" ? "Resolved" : "Unresolved")}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateFields(val === "Resolved" || val === "Solved" ? { resolution: val, status: "DONE" } : { resolution: val });
                  }}
                >
                  <option value="Unresolved">Unresolved</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Solved">Solved</option>
                  <option value="Won't Fix">Won't Fix</option>
                </select>
              )}
            </div>

            {/* Priority Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Priority</label>
              {readOnly ? (
                <div className="jira-drawer-field-readonly"><span>{issue.priority}</span></div>
              ) : (
                <select className="jira-select" value={issue.priority} onChange={(e) => updateField("priority", e.target.value)}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              )}
            </div>

            {/* Assignee Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Assignee</label>
              {readOnly ? (
                <div className="jira-drawer-field-readonly">
                  {issue.assignee ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="jira-avatar-circle small">{issue.assignee.username.substring(0, 2).toUpperCase()}</div>
                      {userLabel(issue.assignee)}
                    </span>
                  ) : (
                    <span style={{ color: "#97A0AF" }}>Unassigned</span>
                  )}
                  <span className="jira-admin-only-hint">Only Admins can assign</span>
                </div>
              ) : can(ACTIONS.ASSIGN_ISSUE_OTHERS) ? (
                /* Admin — full dropdown */
                <select
                  className="jira-select"
                  value={issue.assignee?.id || ""}
                  onChange={(e) => updateField("assignee_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user?.id || m.id} value={m.user?.id || m.id}>
                      {m.user ? userLabel(m.user) : m.username}
                    </option>
                  ))}
                </select>
              ) : (
                /* Member — full dropdown (can assign anyone including self) */
                <select
                  className="jira-select"
                  value={issue.assignee?.id || ""}
                  onChange={(e) => updateField("assignee_id", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user?.id || m.id} value={m.user?.id || m.id}>
                      {m.user ? userLabel(m.user) : m.username}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Workstream Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Workstream</label>
              {readOnly ? (
                <div className="jira-drawer-field-readonly"><span>{issue.workstream || "None"}</span></div>
              ) : (
                <input
                  type="text"
                  className="jira-input"
                  placeholder="e.g. Frontend, Auth, Billing"
                  value={workstreamVal}
                  onChange={(e) => setWorkstreamVal(e.target.value)}
                  onBlur={() => {
                    if (workstreamVal.trim() !== (issue.workstream || "")) {
                      updateField("workstream", workstreamVal.trim());
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.target.blur();
                    }
                  }}
                />
              )}
            </div>

            {/* Due Date Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Due Date</label>
              {readOnly ? (
                <div className="jira-drawer-field-readonly"><span>{issue.due_date || "Not set"}</span></div>
              ) : (
                <input type="date" className="jira-input" value={issue.due_date || ""} onChange={(e) => updateField("due_date", e.target.value || null)} />
              )}
            </div>

            {/* Reporter Field */}
            <div className="jira-drawer-field">
              <label className="jira-drawer-field-label">Reporter</label>
              <div className="jira-reporter-cell" style={{ marginTop: 4 }}>
                <div className="jira-reporter-avatar-badge">{reporterInitials}</div>
                <span className="jira-reporter-name">{reporterName}</span>
              </div>
            </div>

            {/* Created & Updated dates */}
            <div className="jira-drawer-field meta">
              <span className="jira-meta-text">
                <strong>Created:</strong> {new Date(issue.created_at).toLocaleString()}
              </span>
              <span className="jira-meta-text">
                <strong>Updated:</strong> {new Date(issue.updated_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
