import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function InviteAccept() {
  const { token } = useParams();
  const { user: currentUser, acceptInvite } = useAuth();
  const navigate = useNavigate();

  const [validating, setValidating] = useState(true);
  const [inviteData, setInviteData] = useState(null);
  const [inviteStatus, setInviteStatus] = useState("ok"); // ok | expired | invalid | already_accepted | deactivated | error
  const [errorMessage, setErrorMessage] = useState("");

  // Form fields for new user setup
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form fields for existing user acceptance
  const [existingPassword, setExistingPassword] = useState("");
  const [showExistingPassword, setShowExistingPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!token) {
      setValidating(false);
      setInviteStatus("invalid");
      setErrorMessage("No invitation token provided. Please check your invitation link.");
      return;
    }

    let isMounted = true;
    setValidating(true);

    api
      .get(`/auth/validate-invite/?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (!isMounted) return;
        const data = res.data;
        setInviteData(data);
        setFullName(data.name || "");
        setInviteStatus("ok");
        setValidating(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        const resp = err?.response?.data;
        const status = resp?.status || "invalid";
        const detail =
          resp?.detail ||
          "This invitation link is invalid or expired. Please ask an administrator to resend it.";
        setInviteStatus(status);
        setErrorMessage(detail);
        setValidating(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Handle new user account setup submission
  async function handleNewUserSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (!password) {
      setFormError("Please enter a password to secure your account.");
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setFormError("Password must contain at least one uppercase letter (A-Z).");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setFormError("Password must contain at least one digit (0-9).");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please re-enter.");
      return;
    }

    setSubmitting(true);
    try {
      await acceptInvite(token, {
        password: password,
        name: fullName.trim() || undefined,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.password?.[0] ||
        "Could not complete account setup. Please try again.";
      setFormError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  // Handle existing user acceptance submission
  async function handleExistingUserSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      const payload = {};
      const isAlreadyLoggedIn =
        currentUser && currentUser.email?.toLowerCase() === inviteData?.email?.toLowerCase();

      if (!isAlreadyLoggedIn && existingPassword) {
        payload.existing_password = existingPassword;
      }

      await acceptInvite(token, payload);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const detail =
        err?.response?.data?.detail || "Could not accept invitation. Please verify your credentials.";
      setFormError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  const isMatchingUserLoggedIn =
    currentUser && inviteData && currentUser.email?.toLowerCase() === inviteData.email?.toLowerCase();

  return (
    <div className="jira-auth-page">
      <div className="jira-auth-bg-blob jira-auth-bg-blob-1"></div>
      <div className="jira-auth-bg-blob jira-auth-bg-blob-2"></div>
      <div className="jira-auth-bg-pattern"></div>

      <div className="jira-auth-container jira-auth-single-card">
        <div className="jira-auth-card">
          <div className="jira-auth-card-inner">
            {/* Top Brand Logo */}
            <div
              className="jira-auth-header-brand"
              style={{
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                paddingBottom: 8,
                textAlign: "center",
              }}
            >
              <img
                src="/dp-logo.png"
                alt="DataPattern Logo"
                style={{ height: 40, width: "auto", objectFit: "contain" }}
              />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span
                  className="jira-auth-brand-name"
                  style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, color: "#172B4D" }}
                >
                  NEXO
                </span>
                <span style={{ fontSize: 11, color: "#6B778C", letterSpacing: 0.5 }}>
                  Powered by DataPattern
                </span>
              </div>
            </div>

            {/* State 1: Validating token */}
            {validating && (
              <div style={{ textAlign: "center", padding: "40px 12px" }}>
                <div
                  className="jira-btn-spinner"
                  style={{
                    margin: "0 auto 16px",
                    width: 28,
                    height: 28,
                    borderTopColor: "#0052CC",
                    borderColor: "rgba(0, 82, 204, 0.2)",
                  }}
                ></div>
                <div className="jira-auth-main-subtitle" style={{ fontSize: 14, color: "#42526E" }}>
                  Validating your invitation link…
                </div>
              </div>
            )}

            {/* State 2: Invalid, Expired, Already Accepted, or Deactivated */}
            {!validating && inviteStatus !== "ok" && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <div
                  className="jira-auth-alert-error"
                  style={{
                    margin: "16px 0",
                    textAlign: "left",
                    padding: "16px",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4, color: "#BF2600" }}>
                    {inviteStatus === "expired"
                      ? "Invitation Expired"
                      : inviteStatus === "already_accepted"
                      ? "Invitation Already Accepted"
                      : inviteStatus === "deactivated"
                      ? "Account Deactivated"
                      : "Invalid Invitation Link"}
                  </div>
                  <div className="jira-auth-alert-msg" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {errorMessage}
                  </div>
                </div>

                <div style={{ marginTop: 24 }}>
                  <Link
                    to="/login"
                    className="jira-auth-submit-btn"
                    style={{
                      display: "inline-flex",
                      textDecoration: "none",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "11px 24px",
                    }}
                  >
                    Go to Log In &rarr;
                  </Link>
                </div>
              </div>
            )}

            {/* State 3: Valid token — New User Setup (needs password) */}
            {!validating && inviteStatus === "ok" && inviteData?.needs_password && (
              <div>
                <div className="jira-auth-title-area" style={{ textAlign: "center", marginBottom: 20 }}>
                  <h2 className="jira-auth-main-title" style={{ fontSize: 20, marginBottom: 6 }}>
                    Complete Account Setup
                  </h2>
                  <p className="jira-auth-main-subtitle" style={{ fontSize: 13, color: "#6B778C" }}>
                    You have been invited to join the workspace as{" "}
                    <strong style={{ color: "#0052CC" }}>{inviteData.user_type || "Member"}</strong>. Set your password to activate your account.
                  </p>
                </div>

                {formError && (
                  <div className="jira-auth-alert-error" style={{ marginBottom: 16 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <div className="jira-auth-alert-msg">{formError}</div>
                  </div>
                )}

                <form onSubmit={handleNewUserSubmit} className="jira-auth-form">
                  {/* Email (Read-only) */}
                  <div className="jira-form-group">
                    <div className="jira-form-label-row">
                      <label className="jira-form-label" htmlFor="invite-email">
                        Email Address <span style={{ color: "#6B778C", fontSize: 11, fontWeight: "normal" }}>(assigned)</span>
                      </label>
                    </div>
                    <div className="jira-input-wrapper">
                      <span className="jira-input-icon">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </span>
                      <input
                        id="invite-email"
                        type="email"
                        className="jira-form-input"
                        value={inviteData.email}
                        disabled
                        readOnly
                      />
                    </div>
                    <span style={{ fontSize: 11.5, color: "#6B778C", marginTop: 2 }}>
                      This invitation is locked to this email address.
                    </span>
                  </div>

                  {/* Full Name */}
                  <div className="jira-form-group">
                    <label className="jira-form-label" htmlFor="invite-fullname">
                      Full Name <span style={{ color: "#DE350B" }}>*</span>
                    </label>
                    <div className="jira-input-wrapper">
                      <span className="jira-input-icon">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </span>
                      <input
                        id="invite-fullname"
                        type="text"
                        className="jira-form-input"
                        placeholder="e.g. Jane Doe"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (formError) setFormError("");
                        }}
                        required
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="jira-form-group">
                    <label className="jira-form-label" htmlFor="invite-password">
                      Create Password <span style={{ color: "#DE350B" }}>*</span>
                    </label>
                    <div className="jira-input-wrapper">
                      <span className="jira-input-icon">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                      <input
                        id="invite-password"
                        type={showPassword ? "text" : "password"}
                        className="jira-form-input"
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (formError) setFormError("");
                        }}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="jira-input-action-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                    </div>
                    <span style={{ fontSize: 11.5, color: "#6B778C", marginTop: 2 }}>
                      Must have at least 8 characters, 1 uppercase letter (A-Z), and 1 digit (0-9).
                    </span>
                  </div>

                  {/* Confirm Password */}
                  <div className="jira-form-group">
                    <label className="jira-form-label" htmlFor="invite-confirm-password">
                      Confirm Password <span style={{ color: "#DE350B" }}>*</span>
                    </label>
                    <div className="jira-input-wrapper">
                      <span className="jira-input-icon">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                      <input
                        id="invite-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        className="jira-form-input"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (formError) setFormError("");
                        }}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="jira-input-action-btn"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        title={showConfirmPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmPassword ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="jira-auth-submit-btn"
                    disabled={submitting}
                    style={{ marginTop: 8 }}
                  >
                    {submitting ? (
                      <span className="jira-btn-spinner-wrap">
                        <span className="jira-btn-spinner"></span>
                        Activating account…
                      </span>
                    ) : (
                      <span>Complete Setup & Join Workspace &rarr;</span>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* State 4: Valid token — Existing User Acceptance */}
            {!validating && inviteStatus === "ok" && !inviteData?.needs_password && (
              <div>
                <div className="jira-auth-title-area" style={{ textAlign: "center", marginBottom: 20 }}>
                  <h2 className="jira-auth-main-title" style={{ fontSize: 20, marginBottom: 6 }}>
                    Workspace Invitation
                  </h2>
                  <p className="jira-auth-main-subtitle" style={{ fontSize: 13, color: "#6B778C" }}>
                    You have been invited to join the workspace as{" "}
                    <strong style={{ color: "#0052CC" }}>{inviteData.user_type || "Member"}</strong>.
                  </p>
                </div>

                {formError && (
                  <div className="jira-auth-alert-error" style={{ marginBottom: 16 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <div className="jira-auth-alert-msg">{formError}</div>
                  </div>
                )}

                {isMatchingUserLoggedIn ? (
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        background: "#EAE6FF",
                        color: "#403294",
                        padding: "14px 18px",
                        borderRadius: "8px",
                        fontSize: 13.5,
                        marginBottom: 20,
                        lineHeight: 1.5,
                      }}
                    >
                      Currently signed in as <strong>{currentUser.email}</strong>.
                    </div>
                    <button
                      type="button"
                      className="jira-auth-submit-btn"
                      onClick={handleExistingUserSubmit}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <span className="jira-btn-spinner-wrap">
                          <span className="jira-btn-spinner"></span>
                          Accepting invitation…
                        </span>
                      ) : (
                        <span>Accept Invitation & Continue &rarr;</span>
                      )}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleExistingUserSubmit} className="jira-auth-form">
                    <div className="jira-form-group">
                      <label className="jira-form-label" htmlFor="existing-email">
                        Account Email
                      </label>
                      <div className="jira-input-wrapper">
                        <span className="jira-input-icon">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                          </svg>
                        </span>
                        <input
                          id="existing-email"
                          type="email"
                          className="jira-form-input"
                          value={inviteData.email}
                          disabled
                          readOnly
                        />
                      </div>
                    </div>

                    <div className="jira-form-group">
                      <label className="jira-form-label" htmlFor="existing-password">
                        Account Password <span style={{ color: "#DE350B" }}>*</span>
                      </label>
                      <div className="jira-input-wrapper">
                        <span className="jira-input-icon">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        </span>
                        <input
                          id="existing-password"
                          type={showExistingPassword ? "text" : "password"}
                          className="jira-form-input"
                          placeholder="Enter your password to verify"
                          value={existingPassword}
                          onChange={(e) => {
                            setExistingPassword(e.target.value);
                            if (formError) setFormError("");
                          }}
                          autoComplete="current-password"
                          required
                        />
                        <button
                          type="button"
                          className="jira-input-action-btn"
                          onClick={() => setShowExistingPassword(!showExistingPassword)}
                          title={showExistingPassword ? "Hide password" : "Show password"}
                        >
                          {showExistingPassword ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                              <line x1="1" y1="1" x2="23" y2="23"></line>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path>
                              <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="jira-auth-submit-btn"
                      disabled={submitting}
                      style={{ marginTop: 8 }}
                    >
                      {submitting ? (
                        <span className="jira-btn-spinner-wrap">
                          <span className="jira-btn-spinner"></span>
                          Verifying & Accepting…
                        </span>
                      ) : (
                        <span>Sign In & Accept Invitation &rarr;</span>
                      )}
                    </button>

                    <div style={{ textAlign: "center", marginTop: 16 }}>
                      <Link to="/login" className="jira-auth-link" style={{ fontSize: 13 }}>
                        Sign in with a different account
                      </Link>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
