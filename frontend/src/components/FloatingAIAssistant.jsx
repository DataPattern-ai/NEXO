import { useState, useRef, useEffect } from "react";
import api from "../api/client";

export default function FloatingAIAssistant({
  projectId,
  projectName,
  projectKey,
  onActionExecuted,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([
    {
      sender: "ai",
      text: `Hello! I'm your NEXO AI Assistant for **${projectName || "this project"}**. I can analyze your backlog, highlight blockers, or draft and update tasks with your explicit approval. What can I help with?`,
      proposal: null,
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [executingIdx, setExecutingIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  async function handleSend(promptText = null) {
    const textToSend = (promptText || query).trim();
    if (!textToSend || loading) return;

    const userMsg = { sender: "user", text: textToSend, proposal: null };
    setMessages((prev) => [...prev, userMsg]);
    if (!promptText) setQuery("");
    setLoading(true);

    try {
      const res = await api.post(`/projects/${projectId}/ai_assistant/`, {
        message: textToSend,
      });
      const data = res.data;
      const aiReply = {
        sender: "ai",
        text: data.reply || "I analyzed the project context.",
        proposal: data.proposal || null,
        proposalState: data.proposal ? "PENDING" : null, // PENDING, EXECUTED, DISMISSED
      };
      setMessages((prev) => [...prev, aiReply]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `⚠️ **Error**: ${err?.response?.data?.error || err.message || "Failed to contact AI service."}`,
          proposal: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExecuteProposal(msgIndex, proposal) {
    setExecutingIdx(msgIndex);
    try {
      const res = await api.post(`/projects/${projectId}/ai_execute/`, {
        proposal,
      });

      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === msgIndex ? { ...m, proposalState: "EXECUTED" } : m
        )
      );

      // Append confirmation message
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `✅ **Action Confirmed**: ${res.data.message || "Project tracker updated successfully."}`,
          proposal: null,
        },
      ]);

      if (onActionExecuted) {
        onActionExecuted();
      }
    } catch (err) {
      alert(err?.response?.data?.detail || err?.response?.data?.error || "Failed to execute action.");
    } finally {
      setExecutingIdx(null);
    }
  }

  function handleDismissProposal(msgIndex) {
    setMessages((prev) =>
      prev.map((m, idx) =>
        idx === msgIndex ? { ...m, proposalState: "DISMISSED" } : m
      )
    );
  }

  return (
    <>
      {/* Floating Launcher Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1050,
          width: 52,
          height: 52,
          borderRadius: 26,
          background: "linear-gradient(135deg, #0052CC 0%, #6554C0 100%)",
          color: "#FFFFFF",
          border: "none",
          boxShadow: "0 6px 20px rgba(0, 82, 204, 0.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
        title="NEXO AI Assistant"
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
        )}
      </button>

      {/* Floating Chat Panel */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 86,
            right: 24,
            zIndex: 1050,
            width: 420,
            maxWidth: "calc(100vw - 32px)",
            height: 560,
            maxHeight: "calc(100vh - 120px)",
            background: "#FFFFFF",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(9, 30, 66, 0.2), 0 0 1px rgba(9, 30, 66, 0.31)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: "1px solid #DFE1E6",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              background: "#0747A6",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>NEXO AI Assistant</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{projectName} ({projectKey})</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: "none",
                border: "none",
                color: "#FFFFFF",
                cursor: "pointer",
                padding: 4,
                opacity: 0.8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Quick Prompts */}
          <div
            style={{
              padding: "8px 12px",
              background: "#F4F5F7",
              borderBottom: "1px solid #EBECF0",
              display: "flex",
              gap: 6,
              overflowX: "auto",
            }}
          >
            <button
              onClick={() => handleSend("Summarize project health and progress")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              📊 Status Briefing
            </button>
            <button
              onClick={() => handleSend("What are my assigned tasks?")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              👤 My Tasks
            </button>
            <button
              onClick={() => handleSend("What are the active risks and blockers?")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              ⚠️ Risks & Blockers
            </button>
            <button
              onClick={() => handleSend("What are the upcoming deadlines?")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              📅 Deadlines
            </button>
            <button
              onClick={() => handleSend("How do I export to Excel or CSV?")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              📥 How to Export
            </button>
            <button
              onClick={() => handleSend("How do I import deliverables from documents?")}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 10,
                border: "1px solid #DFE1E6",
                background: "#FFFFFF",
                color: "#172B4D",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              📑 Import Docs
            </button>
          </div>

          {/* Messages Thread */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                    background: m.sender === "user" ? "#0052CC" : "#F4F5F7",
                    color: m.sender === "user" ? "#FFFFFF" : "#172B4D",
                    fontSize: 13,
                    lineHeight: 1.45,
                    wordBreak: "break-word",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: m.text
                      .replace(/\n/g, "<br/>")
                      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                  }}
                />

                {/* Structured Action Proposal Card */}
                {m.proposal && (
                  <div
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #C1C7D0",
                      borderRadius: 8,
                      padding: 12,
                      marginTop: 4,
                      boxShadow: "0 2px 6px rgba(9, 30, 66, 0.08)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: m.proposal.action === "CREATE_ISSUE" ? "#DEEBFF" : "#FFF0B3",
                          color: m.proposal.action === "CREATE_ISSUE" ? "#0747A6" : "#172B4D",
                        }}
                      >
                        {m.proposal.action === "CREATE_ISSUE" ? "PROPOSED NEW TASK" : "PROPOSED STATUS UPDATE"}
                      </span>
                      {m.proposalState === "EXECUTED" && (
                        <span style={{ fontSize: 11, color: "#00875A", fontWeight: 700 }}>✓ Executed</span>
                      )}
                      {m.proposalState === "DISMISSED" && (
                        <span style={{ fontSize: 11, color: "#6B778C" }}>Dismissed</span>
                      )}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D", marginBottom: 6 }}>
                      {m.proposal.fields?.title || m.proposal.description}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, fontSize: 11 }}>
                      {m.proposal.fields?.status && (
                        <span style={{ background: "#F4F5F7", padding: "2px 6px", borderRadius: 3, color: "#42526E" }}>
                          Status: <strong>{m.proposal.fields.status}</strong>
                        </span>
                      )}
                      {m.proposal.fields?.priority && (
                        <span style={{
                          background: m.proposal.fields.priority === "CRITICAL" ? "#FFEBE6" : m.proposal.fields.priority === "HIGH" ? "#FFF0B3" : "#F4F5F7",
                          color: m.proposal.fields.priority === "CRITICAL" ? "#DE350B" : m.proposal.fields.priority === "HIGH" ? "#172B4D" : "#42526E",
                          padding: "2px 6px",
                          borderRadius: 3,
                        }}>
                          Priority: <strong>{m.proposal.fields.priority}</strong>
                        </span>
                      )}
                      {m.proposal.fields?.assignee_name && (
                        <span style={{ background: "#EAE6FF", color: "#403294", padding: "2px 6px", borderRadius: 3 }}>
                          Assignee: <strong>{m.proposal.fields.assignee_name}</strong>
                        </span>
                      )}
                      {m.proposal.fields?.due_date && (
                        <span style={{ background: "#E3FCEF", color: "#006644", padding: "2px 6px", borderRadius: 3 }}>
                          Due: <strong>{m.proposal.fields.due_date}</strong>
                        </span>
                      )}
                      {m.proposal.fields?.workstream && (
                        <span style={{ background: "#E6FCFF", color: "#0049B0", padding: "2px 6px", borderRadius: 3 }}>
                          Workstream: <strong>{m.proposal.fields.workstream}</strong>
                        </span>
                      )}
                    </div>

                    {m.proposalState === "PENDING" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleExecuteProposal(idx, m.proposal)}
                          disabled={executingIdx === idx}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 4,
                            background: "#0052CC",
                            color: "#FFFFFF",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {executingIdx === idx ? "Applying..." : "Approve & Execute"}
                        </button>
                        <button
                          onClick={() => handleDismissProposal(idx)}
                          disabled={executingIdx === idx}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 4,
                            background: "#EBECF0",
                            color: "#42526E",
                            border: "none",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: "flex-start", padding: "8px 12px", background: "#F4F5F7", borderRadius: 12, fontSize: 12, color: "#6B778C" }}>
                AI is analyzing project data...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={{
              padding: "10px 12px",
              borderTop: "1px solid #DFE1E6",
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              background: "#FAFBFC",
            }}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Ask anything or request a task action... (Shift+Enter for newline)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid #DFE1E6",
                borderRadius: 4,
                fontSize: 13,
                fontFamily: "inherit",
                lineHeight: "1.4",
                outline: "none",
                resize: "none",
                minHeight: 38,
                maxHeight: 120,
                overflowY: "auto",
                boxSizing: "border-box",
                background: "#FFFFFF",
              }}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              style={{
                height: 38,
                padding: "0 14px",
                borderRadius: 4,
                background: query.trim() ? "#0052CC" : "#EBECF0",
                color: query.trim() ? "#FFFFFF" : "#A5ADBA",
                border: "none",
                fontWeight: 600,
                fontSize: 13,
                cursor: query.trim() ? "pointer" : "default",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
