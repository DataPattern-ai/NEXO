# NEXO — Consolidated Production Reliability and Bug-Fix Report

**Document Version:** 1.0.0  
**Target Branch:** `adheesh-dev`  
**Execution Baseline Commit:** `e42f2c1`  
**Date:** October 28, 2026  
**Status:** Verification Complete — Awaiting Approval  

---

## 1. Executive Summary

This consolidated engineering report details the verification, implementation, security hardening, and test results for NEXO on branch `adheesh-dev`. All modifications strictly adhere to project constraints: no commits, no pushes, no merges, and no deployments were executed. Existing working business logic, authentication workflows, permissions, and database records have been preserved without modification to production Neon databases or Vercel production environments.

### Core Objectives & Outcomes
1. **Phase 1 Reliability & Configuration Verification**:
   - **Django System Warnings**: Completely eliminated `models.W042` (`DEFAULT_AUTO_FIELD`) warnings across all installed applications. Validated with `manage.py check --fail-level WARNING` (0 warnings) and `makemigrations --dry-run` (0 schema drift).
   - **Storage Resilience on Vercel**: Corrected `MEDIA_ROOT` configuration so serverless execution in read-only environments mounts to `/tmp/media` instead of attempting write operations into `/var/task`.
   - **Auth Expiration & 401 Interception**: Hardened Axios interceptor in `frontend/src/api/client.js` with single-flight debounced redirection to `/login?session_expired=1`, preventing redirect loops on concurrent expired requests.
2. **Issue A (Vercel Document & Attachment Upload Fix)**:
   - Eliminated `ValueError: seek/read of closed file` in `parsers.py` by auto-reopening Django `FieldFile` descriptors before reading.
   - Removed manual `Content-Type: multipart/form-data` request headers in frontend upload calls (`DocsView.jsx`, `Dashboard.jsx`, `IssueModal.jsx`), allowing browser/Axios boundary generation to work natively with Django's `MultiPartParser`.
   - Enforced 4.5 MB file-size validation across frontend and backend views to prevent silent Vercel HTTP 413 request payload drops.
3. **Issue B (Invite Acceptance Form Styling)**:
   - Redesigned `frontend/src/pages/InviteAccept.jsx` to utilize the authentic Atlassian/Jira design system (`.jira-form-group`, `.jira-form-label`, `.jira-input-wrapper`, `.jira-input-icon`, `.jira-form-input`, `.jira-input-action-btn`, `.jira-auth-submit-btn`).
   - Integrated SVG field icons (mail, user, lock), interactive password show/hide toggles, loading spinners, and styled read-only states for fixed email addresses.
4. **Issue C (AI Assistant Multiline Input UX)**:
   - Upgraded query inputs in `frontend/src/components/FloatingAIAssistant.jsx` and `frontend/src/components/AskAIModal.jsx` from single-line text inputs to auto-expanding `<textarea>` elements (min-height 38px, max-height 120px).
   - Eliminated horizontal text clipping on long user prompts and implemented standard keyboard controls (`Enter` to submit, `Shift+Enter` for newlines).
5. **Security Hardening (Token Leakage Elimination)**:
   - Removed `?token=` query parameter generation from `DocSerializer` and `AttachmentSerializer`, preventing permanent DRF authentication tokens from being exposed in access logs, browser history, and HTTP referrer headers.
   - Implemented an authenticated download helper (`downloadFile`) utilizing `Authorization: Token <key>` headers, with backend dual-auth fallback (`TokenAuthFromHeaderOrQuery`).
6. **Automated Verification**:
   - 77 automated backend tests executed and passed (0 errors, 0 failures).
   - Frontend Vite production build completed successfully in 329ms with 0 compilation errors.

---

## 2. Pre-change Git and Environment State

Before initiating changes, the local working tree and environment were validated:

```bash
Repository Root: c:\Nexo
Active Branch: adheesh-dev
Tracking Branch: origin/adheesh-dev
Baseline HEAD Commit: e42f2c1
Python Virtualenv: backend/venv (Python 3.10)
Node.js Toolchain: Vite 8.2.2 / React 18
Database Configuration: PostgreSQL (Neon Cloud) / SQLite for test runner
```

Initial `git status` confirmed untracked artifacts from previous audit sessions were kept intact. All changes were isolated to the target branch `adheesh-dev`.

---

## 3. Phase 1 Production Reliability Verification

### 3.1 Serverless Media Storage Configuration
- **Root Problem**: On Vercel, serverless function runtimes run with `/var/task` mounted as a read-only filesystem. Attempting to write uploaded files to `BASE_DIR / 'media'` crashes with `OSError: [Errno 30] Read-only file system`.
- **Implementation**:
  In `backend/config/settings.py`:
  ```python
  if os.getenv('VERCEL'):
      MEDIA_ROOT = Path('/tmp/media')
  else:
      MEDIA_ROOT = BASE_DIR / 'media'
  MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
  ```
  This ensures Vercel serverless functions write exclusively to the writable `/tmp` scratch filesystem.

### 3.2 Token Expiration & HTTP 401 Handling
- **Root Problem**: Expired or invalid authentication tokens caused multiple concurrent API requests to receive 401 responses simultaneously, triggering multiple rapid redirect cycles and UI flashes.
- **Implementation**:
  In `frontend/src/api/client.js`, a debounced single-flight redirect guard was implemented:
  ```javascript
  let isRedirecting = false;
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401) {
        localStorage.removeItem('nexo_token');
        localStorage.removeItem('nexo_user');
        if (!isRedirecting && !window.location.pathname.includes('/login')) {
          isRedirecting = true;
          window.location.href = '/login?session_expired=1';
          setTimeout(() => { isRedirecting = false; }, 2000);
        }
      }
      return Promise.reject(error);
    }
  );
  ```

### 3.3 Elimination of Django `DEFAULT_AUTO_FIELD` Warning
- **Root Problem**: Django system check flagged warning `models.W042` when `DEFAULT_AUTO_FIELD` was not explicitly configured across all app configurations.
- **Implementation**:
  1. `backend/config/settings.py`: Configured `DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'`.
  2. `backend/issues/apps.py`: Explicitly declared `default_auto_field = 'django.db.models.AutoField'`.
  3. `backend/users/apps.py`: Explicitly declared `default_auto_field = 'django.db.models.BigAutoField'` to match existing Neon database integer sequences.
- **Validation**:
  - `python manage.py check --fail-level WARNING`: **0 issues reported (0 silenced)**.
  - `python manage.py makemigrations --dry-run`: **No changes detected (0 schema drift)**.

---

## 4. Issue A: Document and Attachment Upload on Vercel

### 4.1 Root Causes
1. **Read-Only Filesystem**: Vercel containers threw `OSError: [Errno 30]` when attempting to save file uploads into the root application directory.
2. **Missing Multipart Boundary in Request Headers**: In `frontend/src/components/DocsView.jsx`, `frontend/src/pages/Dashboard.jsx`, and `frontend/src/components/IssueModal.jsx`, axios requests explicitly passed `{ headers: { "Content-Type": "multipart/form-data" } }`. By manually defining `Content-Type`, Axios and the browser were prevented from appending the required multipart boundary parameter (`boundary=----WebKitFormBoundary...`). Django's `MultiPartParser` was unable to parse the payload, resulting in empty `request.FILES`.
3. **Descriptor Invalidation in Document Processing**: In `backend/projects/intelligence/parsers.py`, `process_and_extract_document` ran after `ProjectDoc.objects.create(file=file_obj)`. During the model save, Django's storage backend automatically closed the underlying file descriptor. Subsequent calls to `doc.file.read()` or `pdfplumber.open(doc.file)` crashed with `ValueError: seek of closed file` or `ValueError: read of closed file`.
4. **Serverless Payload Limits**: Vercel serverless functions enforce a strict 4.5 MB request body limit. Files larger than 4.5 MB failed with HTTP 413 (Payload Too Large) at the Vercel gateway before reaching Django.

### 4.2 Fixes Implemented
1. **Descriptor Reopening**:
   In `backend/projects/intelligence/parsers.py`:
   ```python
   def parse_uploaded_file(file_obj, filename=""):
       # If file was closed by Django model save, reopen it safely
       if hasattr(file_obj, "closed") and file_obj.closed:
           file_obj.open("rb")
       elif hasattr(file_obj, "file") and hasattr(file_obj.file, "closed") and file_obj.file.closed:
           file_obj.file.open("rb")
       ...
   ```
2. **Native Boundary Handling in Axios**:
   Removed explicit `"Content-Type": "multipart/form-data"` headers from `DocsView.jsx`, `Dashboard.jsx`, and `IssueModal.jsx`. When FormData is passed to `api.post()`, Axios automatically applies the correct content type with dynamic boundary delimiter.
3. **Payload Size Guarding**:
   - Backend `ProjectViewSet.upload_doc` and `AttachmentViewSet.perform_create` validate `file.size <= (4.5 * 1024 * 1024)` in serverless mode (and 25 MB in local mode).
   - Frontend components perform pre-flight file validation with immediate user feedback if a file exceeds 4.5 MB.
4. **Permission & Extension Enforcement**:
   `ProjectViewSet.upload_doc` enforces project membership (`IsProjectMemberOrAbove` and `is_project_admin`) and verifies extension whitelist (`.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.csv`).

---

## 5. Issue B: Invitation Acceptance Page Styling

### 5.1 Before vs. After Assessment
- **Before**: `frontend/src/pages/InviteAccept.jsx` used undefined CSS class names (`.jira-auth-input-group`, `.jira-auth-input-box`, `.jira-auth-input`, `.jira-auth-label`). Inputs appeared as unstyled HTML text boxes with no icon integration, inconsistent padding, raw focus outlines, and unstyled password visibility buttons.
- **After**: Redesigned to strictly adhere to the NEXO/Jira design system defined in `frontend/src/index.css`.

| UI Element | Old Unstyled State | New Jira Design System State |
| :--- | :--- | :--- |
| **Card Layout** | Inconsistent margins, unstyled wrapper | `.jira-auth-container.jira-auth-single-card` with 440px max width and subtle shadow |
| **Input Fields** | Default browser box, no left icon | `.jira-form-input` with 42px height, #FAFBFC background, focus ring `rgba(0, 82, 204, 0.18)` |
| **Field Icons** | Missing | SVG icons embedded via `.jira-input-icon` (mail, user, lock) |
| **Password Toggle** | Text button "Show" / "Hide" | `.jira-input-action-btn` with eye / eye-off SVGs |
| **Read-only Email** | Standard input without styling | `.jira-form-input:disabled` with #F4F5F7 background, muted text, not-allowed cursor |
| **Submit Button** | Raw button | `.jira-auth-submit-btn` with #0052CC background, elevation, and animated `.jira-btn-spinner` |
| **Alert Feedback** | Raw red text | `.jira-auth-alert-error` with alert icon, 8px border-radius, and structured error typography |

### 5.2 Accessibility & User Experience
- Field associations via explicit `htmlFor` and matching `id` attributes.
- Keyboard accessible password toggles with descriptive `title` attributes.
- Clear password complexity guidelines displayed inline below password inputs.

---

## 6. Issue C: AI Assistant Text Input UX

### 6.1 Before vs. After Assessment
- **Before**: Both `FloatingAIAssistant.jsx` and `AskAIModal.jsx` utilized `<input type="text">`. When users entered long questions, detailed user story prompts, or pasted requirements, the text clipped and scrolled horizontally, hiding initial sentences and making cursor navigation cumbersome.
- **After**: Replaced with auto-expanding `<textarea>` elements connected to React refs and scroll-height listeners.

### 6.2 Key Features Implemented
1. **Dynamic Height Adjustment**:
   - Starting height: 38px (single line).
   - Maximum height: 120px with smooth vertical scrollbar when exceeded.
   - Automatically recalculates on typing or pasting:
     ```javascript
     useEffect(() => {
       if (textareaRef.current) {
         textareaRef.current.style.height = "auto";
         textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
       }
     }, [query]);
     ```
2. **Keyboard Ergonomics**:
   - `Enter` (without Shift): Submits the query immediately.
   - `Shift + Enter`: Inserts a newline for multi-paragraph prompts.
3. **UI Polish**:
   - `resize: "none"` eliminates browser drag handles.
   - Aligned button using `alignItems: "flex-end"` to keep the Send button positioned at the bottom-right of the growing textarea.
   - Textarea height automatically resets to single line upon submission.

---

## 7. Shared Regression Review

| Module / Feature | Risk Assessed | Test / Verification Result |
| :--- | :--- | :--- |
| **Document Upload & Intelligence** | Closed file descriptor in AI pipeline | Verified in `test_intelligence.py` and `test_file_delivery.py`. Parser safely reopens closed `FieldFile` descriptors without exception. |
| **Task & Issue Management** | Auto field setting change affecting PKs | Ran `test_task_management.py` and `test_calendar.py`. 0 regressions, all 12 issue management tests passed. |
| **User Access & Invitation Flow** | Authentication token handling & permissions | Ran `test_access.py`. All 34 user authentication and team access tests passed. |
| **Frontend Authentication State** | 401 handling redirect storms | Single-flight debounced redirect in `client.js` prevents infinite redirect loops while keeping localStorage clean. |

---

## 8. Security Review: Download URL Token Leakage Elimination

### 8.1 Threat Assessment
Previously, `DocSerializer.get_file_url` and `AttachmentSerializer.get_url` appended `?token=<user_token>` to every serialized download URL. This design introduced significant security vulnerabilities:
1. **Server & Proxy Logging**: Full URLs including query parameters are logged in plaintext by Nginx, Vercel edge routers, and intermediate proxies.
2. **Browser History**: Permanent auth tokens were saved in user browser history and address bars.
3. **Referrer Header Leakage**: If a downloaded resource contained external links, the token could be leaked in `Referer` headers.

### 8.2 Security Remediation
1. **Clean Serializer Output**:
   In `backend/projects/serializers.py` and `backend/issues/serializers.py`, URLs are now generated cleanly:
   ```python
   # DocSerializer:
   return request.build_absolute_uri(f"/api/docs/{obj.id}/download/")

   # AttachmentSerializer:
   return request.build_absolute_uri(f"/api/attachments/{obj.id}/download/")
   ```
2. **Authenticated Blob Download Helper**:
   In `frontend/src/api/client.js`, exported `downloadFile(url, fallbackFilename)`:
   - Dispatches an Axios GET request with `responseType: "blob"` and `Authorization: Token <key>`.
   - Creates a temporary object URL (`window.URL.createObjectURL(blob)`), triggers programmatic click, and cleans up with `window.URL.revokeObjectURL`.
3. **Backward-Compatible Backend Dual-Authenticator**:
   Created `backend/users/authentication.py: TokenAuthFromHeaderOrQuery`. Download endpoints accept either standard `Authorization: Token <key>` headers (primary) or query parameter `?token=` (safe fallback for non-browser automation).

---

## 9. Test Suite Results

### 9.1 Automated Backend Test Execution
All backend tests were executed using the Django test runner:

```bash
backend\venv\Scripts\python.exe backend\manage.py test users.test_access projects.test_file_delivery projects.test_calendar projects.test_task_management projects.test_intelligence
```

**Results:**
- `users.test_access`: **34 / 34 PASSED** (User login, registration, OTP verification, invite creation, acceptance, workspace isolation).
- `projects.test_file_delivery`: **9 / 9 PASSED** (Document download, attachment download, permissions enforcement, anonymous rejection, clean URL verification).
- `projects.test_calendar`: **4 / 4 PASSED** (Sprint date calculations, calendar task queries).
- `projects.test_task_management`: **8 / 8 PASSED** (Issue creation, workflow state transitions, subtask linking).
- `projects.test_intelligence`: **22 / 22 PASSED** (Document parsing, PDF/DOCX/CSV extraction, AI prompt formatting).
- **Total: 77 passed, 0 failures, 0 errors (100% pass rate).**

### 9.2 Frontend Production Build
Executed Vite production bundling:
```bash
npm --prefix frontend run build
```
**Output:**
```
✓ 125 modules transformed.
../backend/static_root/index.html                   0.49 kB │ gzip:   0.33 kB
../backend/static_root/assets/index-B_j_3Q1M.css  120.18 kB │ gzip:  19.60 kB
../backend/static_root/assets/index-DHCguzZs.js   828.39 kB │ gzip: 213.60 kB
✓ built in 329ms
```
**Result: 0 syntax errors, 0 compilation warnings, 100% build success.**

---

## 10. Files Modified

| File Path | Description of Changes |
| :--- | :--- |
| `backend/config/settings.py` | Configured `DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'`. Fixed `MEDIA_ROOT` for Vercel to use `/tmp/media` with parent dir creation. |
| `backend/issues/apps.py` | Explicitly configured `default_auto_field = 'django.db.models.AutoField'`. |
| `backend/users/apps.py` | Explicitly configured `default_auto_field = 'django.db.models.BigAutoField'`. |
| `backend/users/authentication.py` | *(New file)* Added `TokenAuthFromHeaderOrQuery` class to authenticate download actions via headers or query param. |
| `backend/issues/serializers.py` | Removed `?token=` parameter generation from `AttachmentSerializer.get_url`. |
| `backend/projects/serializers.py` | Removed `?token=` parameter generation from `DocSerializer.get_file_url`. |
| `backend/projects/views.py` | Added `upload_doc` permission checks, 4.5 MB file size limit, allowed extensions filter, and `download` action with dual authentication. |
| `backend/issues/views.py` | Added 4.5 MB file size validation in `AttachmentViewSet.perform_create` and `download` action with dual authentication. |
| `backend/projects/intelligence/parsers.py` | Added automatic `open("rb")` check for closed `FieldFile` descriptors to prevent `seek of closed file` errors. |
| `backend/projects/test_file_delivery.py` | *(New file)* Added 9 unit tests verifying document/attachment downloads, 403 checks, and clean URL verification without token leakage. |
| `frontend/src/api/client.js` | Added single-flight debounced 401 response interceptor with redirect to `/login?session_expired=1`. Exported secure `downloadFile()` helper using blob response and Auth header. |
| `frontend/src/index.css` | Added `.jira-form-input:disabled` styles. |
| `frontend/src/pages/InviteAccept.jsx` | Restyled entire form using Atlassian Jira design system classes, SVG icons, password show/hide buttons, and loading spinners. |
| `frontend/src/components/FloatingAIAssistant.jsx` | Replaced single-line `<input>` with auto-expanding `<textarea>` (38px to 120px), Enter to submit, Shift+Enter for newlines. |
| `frontend/src/components/AskAIModal.jsx` | Replaced single-line `<input>` with auto-expanding `<textarea>` (38px to 120px), Enter to submit, Shift+Enter for newlines. |
| `frontend/src/components/DocsView.jsx` | Removed manual `Content-Type: multipart/form-data` header; updated download button to call `downloadFile()`. Added 4.5 MB size check. |
| `frontend/src/pages/Dashboard.jsx` | Removed manual `Content-Type: multipart/form-data` header from quick document upload. Added 4.5 MB size check. |
| `frontend/src/components/IssueModal.jsx` | Removed manual `Content-Type: multipart/form-data` header; updated download button to call `downloadFile()`. Added 4.5 MB size check. |

---

## 11. Residual Risks and Deployment Recommendations

1. **Vercel Serverless Ephemeral Storage**:
   - While mounting `MEDIA_ROOT` to `/tmp/media` resolves the `OSError: [Errno 30] Read-only file system` crash during upload and extraction, files saved in `/tmp` on serverless instances are ephemeral and discarded when the container cold-starts.
   - **Recommendation**: For persistent production document storage across serverless instances, configure `django-storages` with an S3-compatible bucket (e.g. AWS S3, Cloudflare R2, or Supabase Storage).
2. **Serverless Function 4.5 MB Limit**:
   - Vercel functions cannot accept payloads larger than 4.5 MB. The client-side and server-side checks now prevent confusing 413 gateway errors.
   - **Recommendation**: If large files (> 4.5 MB) must be supported in the future, implement direct presigned S3 upload URLs from the frontend.
3. **Vercel Environment Variables**:
   - Ensure the Vercel Preview environment configuration includes `VERCEL=1` (set automatically by Vercel) and valid Neon database connection strings.

---

## 12. Explicit Confirmation of Constraints

- [x] **No git commits** were created.
- [x] **No git pushes** were performed.
- [x] **No branch merges or rebases** were performed.
- [x] **No deployments** were triggered.
- [x] All modifications reside purely in the local working tree of branch `adheesh-dev`.
- [x] Production databases, external secrets, and cloud configurations were not altered.
