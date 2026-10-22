import { useState, useEffect } from "react";
import api from "../api/client";

export default function ImportReconciliationModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  projectKey,
  onImportComplete,
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filterState, setFilterState] = useState("ALL"); // ALL, NEW, UPDATED, UNCHANGED
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editedItems, setEditedItems] = useState({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setLoading(true);
    setError("");
    api.get(`/projects/${projectId}/import_preview/`)
      .then((res) => {
        setData(res.data);
        // Default select all NEW and UPDATED items
        const initialSelected = new Set();
        const initialEdits = {};
        (res.data.items || []).forEach((item) => {
          if (item.reconciliation_state === "NEW" || item.reconciliation_state === "UPDATED") {
            initialSelected.add(item.temp_id);
          }
          initialEdits[item.temp_id] = {
            ...item,
            assignee_id: item.matched_user_id || "",
          };
        });
        setSelectedIds(initialSelected);
        setEditedItems(initialEdits);
      })
      .catch((err) => {
        setError(err?.response?.data?.error || err.message || "Failed to load import preview.");
      })
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const rawItems = data?.items || [];
  const members = data?.available_members || [];

  const filteredItems = rawItems.filter((item) => {
    if (filterState === "ALL") return true;
    return item.reconciliation_state === filterState;
  });

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.temp_id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredItems.forEach((i) => next.delete(i.temp_id));
      } else {
        filteredItems.forEach((i) => next.add(i.temp_id));
      }
      return next;
    });
  }

  function toggleSelectOne(tempId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }

  function handleItemChange(tempId, field, value) {
    setEditedItems((prev) => ({
      ...prev,
      [tempId]: {
        ...(prev[tempId] || {}),
        [field]: value,
      },
    }));
  }

  async function handleConfirmImport() {
    const toImport = [];
    selectedIds.forEach((tempId) => {
      if (editedItems[tempId]) {
        toImport.push(editedItems[tempId]);
      }
    });

    if (toImport.length === 0) {
      alert("Please select at least one deliverable to import.");
      return;
    }

    setImporting(true);
    try {
      const res = await api.post(`/projects/${projectId}/confirm_import/`, {
        selected_items: toImport,
      });
      alert(res.data.message || `Successfully imported ${toImport.length} deliverables!`);
      onClose();
      if (onImportComplete) onImportComplete();
    } catch (err) {
      alert(err?.response?.data?.error || err?.response?.data?.detail || "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="jira-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 960, width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="jira-modal-header" style={{ borderBottom: "1px solid #DFE1E6", padding: "16px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#DEEBFF", display: "flex", alignItems: "center", justifyContent: "center", color: "#0052CC" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div>
              <h2 className="jira-modal-title" style={{ fontSize: 18, margin: 0 }}>
                Document-to-Tracker Reconciliation
              </h2>
              <span className="jira-sub-key" style={{ color: "#6B778C", fontSize: 13 }}>
                Review and synchronize deliverables extracted from {projectName} documents into operational tracker
              </span>
            </div>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="jira-modal-body" style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#6B778C" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
              <div style={{ fontWeight: 600 }}>Analyzing Document Deliverables & Matching Users...</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Comparing workbook items against existing tracker records</div>
            </div>
          ) : error ? (
            <div style={{ padding: 20, background: "#FFEBE6", borderRadius: 8, color: "#DE350B" }}>
              <strong>Error:</strong> {error}
            </div>
          ) : rawItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 0", color: "#6B778C" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>No deliverables detected in project documents.</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                Upload an Excel timeline, PRD, or status report in the <strong>Docs</strong> tab to extract deliverables.
              </div>
            </div>
          ) : (
            <div>
              {/* Summary Stats & Filters */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className={`jira-filter-chip ${filterState === "ALL" ? "active" : ""}`}
                    onClick={() => setFilterState("ALL")}
                    style={{ padding: "4px 12px", borderRadius: 14, fontSize: 12, border: "1px solid #DFE1E6", background: filterState === "ALL" ? "#0052CC" : "#FAFBFC", color: filterState === "ALL" ? "#FFF" : "#172B4D", fontWeight: 600, cursor: "pointer" }}
                  >
                    All ({rawItems.length})
                  </button>
                  <button
                    className={`jira-filter-chip ${filterState === "NEW" ? "active" : ""}`}
                    onClick={() => setFilterState("NEW")}
                    style={{ padding: "4px 12px", borderRadius: 14, fontSize: 12, border: "1px solid #DFE1E6", background: filterState === "NEW" ? "#0052CC" : "#FAFBFC", color: filterState === "NEW" ? "#FFF" : "#0052CC", fontWeight: 600, cursor: "pointer" }}
                  >
                    New to Import ({data?.new_count || 0})
                  </button>
                  <button
                    className={`jira-filter-chip ${filterState === "UPDATED" ? "active" : ""}`}
                    onClick={() => setFilterState("UPDATED")}
                    style={{ padding: "4px 12px", borderRadius: 14, fontSize: 12, border: "1px solid #DFE1E6", background: filterState === "UPDATED" ? "#0052CC" : "#FAFBFC", color: filterState === "UPDATED" ? "#FFF" : "#FFAB00", fontWeight: 600, cursor: "pointer" }}
                  >
                    Updates ({data?.updated_count || 0})
                  </button>
                  <button
                    className={`jira-filter-chip ${filterState === "UNCHANGED" ? "active" : ""}`}
                    onClick={() => setFilterState("UNCHANGED")}
                    style={{ padding: "4px 12px", borderRadius: 14, fontSize: 12, border: "1px solid #DFE1E6", background: filterState === "UNCHANGED" ? "#0052CC" : "#FAFBFC", color: filterState === "UNCHANGED" ? "#FFF" : "#36B37E", fontWeight: 600, cursor: "pointer" }}
                  >
                    Already in Sync ({data?.unchanged_count || 0})
                  </button>
                </div>

                <div style={{ fontSize: 13, color: "#6B778C" }}>
                  Selected: <strong>{selectedIds.size}</strong> of {rawItems.length} items
                </div>
              </div>

              {/* Table */}
              <div style={{ border: "1px solid #DFE1E6", borderRadius: 6, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F4F5F7", borderBottom: "1px solid #DFE1E6", color: "#5E6C84", textAlign: "left" }}>
                      <th style={{ width: 40, padding: "10px 12px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAll}
                          style={{ cursor: "pointer" }}
                        />
                      </th>
                      <th style={{ padding: "10px 12px" }}>Deliverable Title</th>
                      <th style={{ padding: "10px 12px" }}>Workstream</th>
                      <th style={{ padding: "10px 12px" }}>Target Status</th>
                      <th style={{ padding: "10px 12px" }}>Priority</th>
                      <th style={{ padding: "10px 12px" }}>Due Date</th>
                      <th style={{ padding: "10px 12px" }}>Assignee Mapping</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>Reconciliation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const edited = editedItems[item.temp_id] || item;
                      const isSelected = selectedIds.has(item.temp_id);

                      let badgeBg = "#EAE6FF";
                      let badgeColor = "#403294";
                      if (item.reconciliation_state === "NEW") {
                        badgeBg = "#DEEBFF";
                        badgeColor = "#0747A6";
                      } else if (item.reconciliation_state === "UPDATED") {
                        badgeBg = "#FFF0B3";
                        badgeColor = "#172B4D";
                      } else if (item.reconciliation_state === "UNCHANGED") {
                        badgeBg = "#E3FCEF";
                        badgeColor = "#006644";
                      }

                      return (
                        <tr
                          key={item.temp_id}
                          style={{
                            borderBottom: "1px solid #EBECF0",
                            background: isSelected ? "#F4F8FD" : "transparent",
                          }}
                        >
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectOne(item.temp_id)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                            <input
                              type="text"
                              value={edited.title}
                              onChange={(e) => handleItemChange(item.temp_id, "title", e.target.value)}
                              style={{ width: "100%", padding: "4px 8px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 13, fontWeight: 500 }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              type="text"
                              value={edited.workstream || ""}
                              onChange={(e) => handleItemChange(item.temp_id, "workstream", e.target.value)}
                              placeholder="General"
                              style={{ width: 110, padding: "4px 6px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 12 }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <select
                              value={edited.status}
                              onChange={(e) => handleItemChange(item.temp_id, "status", e.target.value)}
                              style={{ padding: "4px 6px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 12 }}
                            >
                              <option value="TODO">To Do</option>
                              <option value="IN_PROGRESS">In Progress</option>
                              <option value="DONE">Done</option>
                            </select>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <select
                              value={edited.priority}
                              onChange={(e) => handleItemChange(item.temp_id, "priority", e.target.value)}
                              style={{ padding: "4px 6px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 12 }}
                            >
                              <option value="CRITICAL">Critical</option>
                              <option value="HIGH">High</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="LOW">Low</option>
                            </select>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              type="date"
                              value={edited.due_date || ""}
                              onChange={(e) => handleItemChange(item.temp_id, "due_date", e.target.value)}
                              style={{ padding: "4px 6px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 12 }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <select
                              value={edited.assignee_id || ""}
                              onChange={(e) => handleItemChange(item.temp_id, "assignee_id", e.target.value ? Number(e.target.value) : null)}
                              style={{ maxWidth: 140, padding: "4px 6px", border: "1px solid #DFE1E6", borderRadius: 4, fontSize: 12 }}
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.full_name || m.username}
                                </option>
                              ))}
                            </select>
                            {item.source_owner && !item.matched_user_id && (
                              <div style={{ fontSize: 10, color: "#DE350B", marginTop: 2 }}>
                                Source: {item.source_owner}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                background: badgeBg,
                                color: badgeColor,
                              }}
                            >
                              {item.reconciliation_state}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="jira-modal-footer"
          style={{ borderTop: "1px solid #DFE1E6", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div style={{ fontSize: 12, color: "#6B778C" }}>
            * Changes made in this table will be committed directly to your project tracker without modifying source documents.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="jira-btn-secondary"
              onClick={onClose}
              disabled={importing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="jira-btn-primary"
              onClick={handleConfirmImport}
              disabled={importing || selectedIds.size === 0}
              style={{ background: "#0052CC", minWidth: 160 }}
            >
              {importing ? "Importing to Tracker..." : `Confirm & Import (${selectedIds.size} Tasks)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
