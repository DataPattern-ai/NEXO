import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          resetError: this.handleReset,
        });
      }

      return (
        <div
          style={{
            margin: "32px auto",
            maxWidth: 720,
            padding: "24px 28px",
            background: "#FFFFFF",
            border: "1px solid #FFBDAD",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "#FFEBE6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#DE350B",
                fontSize: 18,
                fontWeight: "bold",
                flexShrink: 0,
              }}
            >
              ⚠️
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#172B4D" }}>
                {this.props.title || "Something went wrong loading this view"}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B778C" }}>
                An unexpected interface error occurred. You can retry or return to the overview.
              </p>
            </div>
          </div>

          <div
            style={{
              padding: "10px 14px",
              background: "#FFF0ED",
              border: "1px solid #FFD0C7",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "monospace",
              color: "#BF2600",
              margin: "14px 0",
              wordBreak: "break-word",
            }}
          >
            {this.state.error?.message || "Unknown rendering exception"}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={this.handleReset}
              className="jira-btn-primary"
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              Try Again
            </button>
            <button
              onClick={() => {
                window.location.href = "/dashboard";
              }}
              className="jira-btn-secondary"
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              Go to Portfolio Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
