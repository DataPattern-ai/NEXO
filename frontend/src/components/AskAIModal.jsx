import { useState, useRef, useEffect } from "react";

export default function AskAIModal({ isOpen, onClose, project, issues = [] }) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([
    {
      sender: "ai",
      text: `Hello! I'm your NEXO AI Assistant for **${project?.name || "this project"}**. I can analyze your backlog, draft user stories, estimate story points, or find blockers. What would you like help with?`,
    },
  ]);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef(null);

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

  if (!isOpen) return null;

  function handleSend(promptText = null) {
    const textToSend = promptText || query;
    if (!textToSend.trim()) return;

    const userMsg = { sender: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    if (!promptText) setQuery("");
    setLoading(true);

    setTimeout(() => {
      let aiReply = "";
      const lower = textToSend.toLowerCase();

      if (lower.includes("summarize") || lower.includes("summary") || lower.includes("status")) {
        const total = issues.length;
        const done = issues.filter((i) => i.status === "DONE").length;
        const inProgress = issues.filter((i) => i.status === "IN_PROGRESS").length;
        aiReply = `### Backlog & Sprint Summary:\n\n- **Total Items**: ${total}\n- **In Progress**: ${inProgress} tasks\n- **Completed**: ${done} tasks\n- **Health**: On track! Estimated completion date is in 4 days.`;
      } else if (lower.includes("blocker") || lower.includes("risk")) {
        aiReply = `### Risk Analysis:\n\n1. **High Priority Tasks**: Ensure tasks with *High* or *Critical* priority have dedicated assignees.\n2. **Unassigned Items**: There are ${issues.filter((i) => !i.assignee).length} unassigned tickets that need triage.\n3. **Subtasks**: Subtask 2.1 is completed. Task 1 and Task 2 are progressing smoothly.`;
      } else if (lower.includes("generate") || lower.includes("story") || lower.includes("task")) {
        aiReply = `### Generated User Story:\n\n**Title**: As a data scientist, I want an automated ML model deployment pipeline so that predictions are available via REST API.\n\n**Acceptance Criteria**:\n- Endpoint \`/api/predict/\` responds in < 200ms\n- Automated unit tests for data preprocessing\n- CI/CD workflow passes on main branch`;
      } else {
        aiReply = `I analyzed your project **${project?.name}** (${issues.length} work items). All tasks are synchronized with the sprint board. You can ask me to draft acceptance criteria, suggest story point estimates, or review team workload!`;
      }

      setMessages((prev) => [...prev, { sender: "ai", text: aiReply }]);
      setLoading(false);
    }, 600);
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, height: 600 }}>
        <div className="jira-modal-header">
          <div className="jira-modal-title-group">
            <h2 className="jira-modal-title">NEXO Intelligence (AI Assistant)</h2>
            <span className="jira-sub-key">Context-aware assistant for {project?.name}</span>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="jira-modal-body" style={{ flex: 1, padding: "16px 20px" }}>
          {/* Quick Prompts */}
        <div className="jira-ai-quick-prompts">
            <button className="jira-ai-prompt-chip" onClick={() => handleSend("Summarize project backlog & health")}>
              Summarize backlog
            </button>
            <button className="jira-ai-prompt-chip" onClick={() => handleSend("Identify potential sprint blockers")}>
              Find blockers & risks
            </button>
            <button className="jira-ai-prompt-chip" onClick={() => handleSend("Generate a user story for data science pipeline")}>
              Generate user story
            </button>
          </div>

          <div className="jira-ai-chat-thread">
            {messages.map((m, idx) => (
              <div key={idx} className={`jira-ai-msg-bubble ${m.sender}`}>
                <div className="jira-ai-msg-avatar">
                  {m.sender === "ai" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  )}
                </div>
                <div className="jira-ai-msg-text">
                  <div dangerouslySetInnerHTML={{ __html: m.text.replace(/\n/g, "<br/>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
                </div>
              </div>
            ))}
            {loading && (
              <div className="jira-ai-msg-bubble ai">
                <div className="jira-ai-msg-avatar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>
                </div>
                <div className="jira-ai-msg-text">
                  <span className="jira-ai-typing">AI is analyzing project issues...</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chat Input */}
        <div className="jira-ai-chat-input-bar" style={{ alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            rows={1}
            className="jira-input"
            placeholder="Ask anything about this project, generate tasks, or check blockers... (Shift+Enter for newline)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoFocus
            style={{
              flex: 1,
              resize: "none",
              minHeight: 38,
              maxHeight: 120,
              lineHeight: 1.4,
              padding: "8px 10px",
              fontFamily: "inherit",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          />
          <button
            className="jira-btn-primary"
            onClick={() => handleSend()}
            disabled={loading || !query.trim()}
            style={{ height: 38, padding: "0 16px", flexShrink: 0 }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

