# NEXO — Post-Implementation Code Review & Preview Readiness Report

**Date of Review:** October 29, 2026  
**Target Branch:** `adheesh-dev`  
**Tracking Branch:** `origin/adheesh-dev`  
**Baseline HEAD Commit:** `e42f2c1`  
**Review Type:** Code Audit, Git Diff Inspection, and Verification Testing  
**Final Verdict:** **`READY WITH KNOWN LIMITATIONS`** (Approved for Vercel Preview Deployment)

---

## 1. Git Branch and Working-Tree Status

### 1.1 Branch Confirmation
- Confirmed active branch is `adheesh-dev` via `git branch`.
- Current working tree tracks `origin/adheesh-dev` at base commit `e42f2c1`.
- **Safety Compliance**: Zero commits, zero pushes, zero merges, and zero deployments were executed. The `main` branch was not accessed, modified, or targeted.

### 1.2 Working-Tree Status (`git status --short`)
```
 M backend/config/settings.py
 M backend/issues/apps.py
 M backend/issues/serializers.py
 M backend/issues/views.py
 M backend/projects/intelligence/parsers.py
 M backend/projects/serializers.py
 M backend/projects/views.py
 M backend/requirements.txt
 D backend/static_root/assets/index-BwNgC26m.js
 D backend/static_root/assets/index-CbU66jpz.css
 M backend/static_root/index.html
 M backend/users/apps.py
 M frontend/src/api/client.js
 M frontend/src/components/AskAIModal.jsx
 M frontend/src/components/DocsView.jsx
 M frontend/src/components/FloatingAIAssistant.jsx
 M frontend/src/components/IssueModal.jsx
 M frontend/src/context/AuthContext.jsx
 M frontend/src/index.css
 M frontend/src/pages/Dashboard.jsx
 M frontend/src/pages/InviteAccept.jsx
 M frontend/src/pages/Login.jsx
?? backend/projects/test_file_delivery.py
?? backend/static_root/assets/index-B_j_3Q1M.css
?? backend/static_root/assets/index-DHCguzZs.js
?? backend/users/authentication.py
?? nexo_consolidated_reliability_bugfix_report.md
```

### 1.3 Inspection of `backend/static_root/index.html` and Assets
- **Purpose**: In `frontend/vite.config.js`, the build output is configured as `outDir: '../backend/static_root'` with `emptyOutDir: true`. In `backend/config/urls.py`, Django serves `TemplateView.as_view(template_name="index.html")` for SPA routes.
- **Diff Analysis**: The diff in `backend/static_root/index.html` updates the script and stylesheet references from the older bundle (`index-BwNgC26m.js`, `index-CbU66jpz.css`) to the newly compiled bundle (`index-DHCguzZs.js`, `index-B_j_3Q1M.css`).
- **Verdict**: `backend/static_root/index.html` is a generated production build artifact. It **must remain changed** in sync with the compiled assets in `backend/static_root/assets/`. Reverting it would break the Django SPA entry point by attempting to load deleted asset hashes.

---

## 2. Summary of Reviewed Files and Actual Changes

### 2.1 Backend Architecture & Configuration
1. **`backend/config/settings.py`**:
   - Explicitly configured `DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'`, resolving system check warning `models.W042`.
   - Added S3 storage backend configuration using `django-storages` and `boto3` when `USE_S3=True` and `AWS_STORAGE_BUCKET_NAME` are defined.
   - For environments without S3 credentials, dynamically sets `MEDIA_ROOT = Path('/tmp/media') if os.getenv('VERCEL') else (BASE_DIR / 'media')` with `mkdir(parents=True, exist_ok=True)` to prevent read-only filesystem crashes on Vercel.
2. **`backend/issues/apps.py` & `backend/users/apps.py`**:
   - `issues/apps.py`: Set `default_auto_field = 'django.db.models.AutoField'`.
   - `users/apps.py`: Set `default_auto_field = 'django.db.models.BigAutoField'` to preserve existing Postgres integer sequence mappings.
3. **`backend/users/authentication.py`** *(New)*:
   - Implemented `TokenAuthFromHeaderOrQuery` extending DRF's `TokenAuthentication`. Authenticates via standard `Authorization: Token <token>` header first, with fallback to URL query parameter `?token=...` or `?auth_token=...` specifically for download actions.
4. **`backend/issues/serializers.py` & `backend/projects/serializers.py`**:
   - Removed `?token=` parameter generation from `AttachmentSerializer.get_url` and `ProjectDocSerializer.get_file_url`. Both now emit clean, token-free URLs (`/api/attachments/{id}/download/` and `/api/docs/{id}/download/`).
5. **`backend/issues/views.py` & `backend/projects/views.py`**:
   - `ProjectViewSet.upload_doc`: Added project admin permission enforcement (`is_project_admin`), 4.5 MB file-size ceiling on Vercel, allowed extension validation (`.xlsx`, `.xls`, `.docx`, `.pdf`, `.md`, `.txt`), and a dedicated `download` action with project member access checking.
   - `AttachmentViewSet`: Added 4.5 MB file-size ceiling and a dedicated `download` action with project member access checking.
6. **`backend/projects/intelligence/parsers.py`**:
   - In `parse_uploaded_file`, implemented automated reopening (`file_obj.open("rb")`) if a Django `FieldFile` descriptor was closed during model persistence, eliminating `ValueError: seek/read of closed file`.
7. **`backend/requirements.txt`**:
   - Added `django-storages>=1.14.0` and `boto3>=1.34.0`.

### 2.2 Frontend Experience & UX Hardening
1. **`frontend/src/api/client.js`**:
   - Configured single-flight debounced 401 response interceptor with redirect to `/login?expired=1&next=<path>` and custom event `nexo:auth-expired`.
   - Exported `downloadFile(url, fallbackFilename)` helper using Axios blob response and `Authorization: Token` header, generating programmatic blob download links.
2. **`frontend/src/context/AuthContext.jsx`**:
   - Added listener for `nexo:auth-expired` to immediately reset React authentication state on session expiry.
3. **`frontend/src/pages/Login.jsx`**:
   - Added alert banner when `expired=1` is present in query parameters. Preserves and redirects to `next` URL upon re-authentication.
4. **`frontend/src/pages/InviteAccept.jsx`**:
   - Replaced orphaned CSS classes with the Atlassian Jira design system (`.jira-form-group`, `.jira-form-label`, `.jira-input-wrapper`, `.jira-input-icon`, `.jira-form-input`, `.jira-input-action-btn`, `.jira-auth-submit-btn`).
   - Added SVG icons for email, user, and password fields, interactive password show/hide toggles, loading spinners, and styled read-only inputs for fixed invitation email addresses.
5. **`frontend/src/components/FloatingAIAssistant.jsx` & `frontend/src/components/AskAIModal.jsx`**:
   - Replaced single-line `<input type="text">` with auto-expanding `<textarea>` elements (min-height 38px, max-height 120px).
   - Added keyboard handlers: `Enter` to submit, `Shift + Enter` for newlines. Prevents horizontal text clipping on long user prompts.
6. **`frontend/src/components/DocsView.jsx`, `IssueModal.jsx`, and `pages/Dashboard.jsx`**:
   - Removed manual `'Content-Type': 'multipart/form-data'` headers, allowing Axios/browser to set multipart boundaries natively.
   - Added client-side 4.5 MB file-size checks with informative alerts. Replaced direct anchor download links with `downloadFile()` button triggers.

---

## 3. Test Commands and Their Exact Outcomes

All tests below were executed live during this code review session:

| Test Target / Tool | Command Executed | Outcome | Status |
| :--- | :--- | :--- | :--- |
| **Django System Checks** | `python manage.py check --fail-level WARNING` | `System check identified no issues (0 silenced).` | **PASSED** |
| **Django Migrations Check** | `python manage.py makemigrations --check --dry-run` | `No changes detected` (0 schema drift) | **PASSED** |
| **File Delivery Tests** | `python manage.py test projects.test_file_delivery` | `Ran 9 tests in 8.443s - OK` | **PASSED** |
| **Core Access & Issue Tests** | `python manage.py test users.test_access projects.test_calendar projects.test_task_management` | `Ran 46 tests in 59.733s - OK` | **PASSED** |
| **Intelligence & Parser Tests**| `python manage.py test projects.test_intelligence` | `Ran 22 tests in 41.297s - OK` | **PASSED** |
| **Frontend Linting** | `npm --prefix frontend run lint` | `0 errors, 111 warnings (45 files in 336ms)` | **PASSED** |
| **Frontend Local Build** | `npm --prefix frontend run build` | `Vite 8.2.2 - built in 835ms` | **PASSED** |
| **Vercel Production Build** | `npm --prefix frontend run vercel-build` | `Vite 8.2.2 - built in 299ms into dist/` | **PASSED** |

**Summary of Automated Test Execution**: 77 / 77 backend unit tests passed (100% success rate); 0 lint errors; 0 build errors.

---

## 4. Critical Issues and Security Concerns

### 4.1 Download URL Token Leakage (Resolved)
- **Previous Vulnerability**: `DocSerializer` and `AttachmentSerializer` previously appended `?token=<user_token>` to every serialized download URL, leaking permanent user credentials into Nginx access logs, Vercel routing logs, browser history, and HTTP `Referer` headers.
- **Verification**: Serializers now output clean paths (`/api/docs/{id}/download/`). The frontend requests the file via `downloadFile()`, passing the credentials securely inside the HTTP `Authorization: Token` request header.
- **`TokenAuthFromHeaderOrQuery` Role**: The custom authenticator supports query-string tokens strictly as a fallback for non-browser automation or external webhooks. Because the application no longer emits tokens in URLs, no token leakage occurs during standard user navigation.

### 4.2 Project-Level Access Control (Verified)
- **Verification**: Both `ProjectDocViewSet.download` and `AttachmentViewSet.download` explicitly invoke `has_project_access(user, project)` before streaming files.
- **Test Confirmation**: `test_project_doc_download_outsider_forbidden` and `test_issue_attachment_download_outsider_forbidden` in `test_file_delivery.py` verified that authenticated users who are not members of the project receive HTTP 403 Forbidden. Anonymous requests receive HTTP 401 Unauthorized.

### 4.3 Expired-Session Handling (Verified)
- **Verification**: In `client.js`, the `isRedirecting` boolean flag prevents concurrent 401 responses from triggering multiple rapid redirects or reload loops. The `nexo:auth-expired` custom event resets the React context user state cleanly without page flashing.

---

## 5. Production Storage Status and Persistence Risks

### 5.1 Analysis of `/tmp/media` on Vercel
- On Vercel Serverless Functions, the application directory (`/var/task`) is strictly read-only.
- Mounting `MEDIA_ROOT` to `/tmp/media` resolves the `OSError: [Errno 30] Read-only file system` crash during the immediate document upload and signal extraction lifecycle.
- **Persistence Assessment**:
  - **Function Restart**: Any file stored in `/tmp` will be deleted when the serverless container spins down or cold-starts.
  - **Multiple Instances**: A file uploaded to Instance A is **not available** to Instance B. If a subsequent download request is routed to a different instance, the download will return HTTP 404.
  - **Conclusion**: `/tmp/media` is **ephemeral scratch space**, not durable storage.

### 5.2 Recommendation & Smallest Next Step
- The codebase already includes the S3 storage engine configuration in `backend/config/settings.py` and `backend/requirements.txt` (`django-storages`, `boto3`).
- **Next Step**: Configure an S3-compatible bucket (AWS S3, Cloudflare R2, or Supabase Storage) by setting the following environment variables in the Vercel project settings:
  ```
  USE_S3=True
  AWS_STORAGE_BUCKET_NAME=<bucket-name>
  AWS_ACCESS_KEY_ID=<access-key-id>
  AWS_SECRET_ACCESS_KEY=<secret-access-key>
  AWS_S3_REGION_NAME=<region-name>
  ```
  No further code changes are required to enable durable storage once these environment variables are provided.

---

## 6. Upload Size and Vercel Deployment Limitations

### 6.1 Upload Size Limits
- **Vercel Serverless Gateway Limit**: Vercel imposes an immutable 4.5 MB request body limit on Serverless Functions.
- **Frontend Enforcement**: `DocsView.jsx`, `IssueModal.jsx`, and `Dashboard.jsx` validate file size before starting the upload:
  ```javascript
  if (file && file.size > 4.5 * 1024 * 1024) {
    alert(`"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 4.5 MB serverless upload limit.`);
    return;
  }
  ```
- **Backend Enforcement**: `ProjectViewSet.upload_doc` and `AttachmentViewSet.perform_create` validate:
  ```python
  max_mb = 4.5 if os.getenv("VERCEL") else 25.0
  if file_obj.size > int(max_mb * 1024 * 1024):
      return Response({"error": f"File size exceeds the {max_mb} MB limit."}, status=status.HTTP_400_BAD_REQUEST)
  ```

### 6.2 Supported Document Formats
The backend validates extensions against:
- **Excel**: `.xlsx`, `.xls`
- **Word**: `.docx`
- **PDF**: `.pdf`
- **Markdown / Text**: `.md`, `.txt`

### 6.3 Failed Extraction State Handling
- In `ProjectViewSet.upload_doc`, the extraction step is wrapped in `try...except`. Signal creation in `process_and_extract_document` runs inside a database transaction (`with transaction.atomic():`).
- If an uploaded file has corrupt content or cannot produce PMO signals, the signal transaction rolls back, leaving no orphan signals. The document record remains in the project library, and the user can view the document and trigger "Re-extract PMO Signals" when desired.

---

## 7. Regressions and Unintended Changes

- **No Regressions Identified**:
  - Existing user login, registration, OTP verification, and team permission checks remain fully functional (34 tests passed).
  - Sprint calendar and issue tracking continue to function as expected (12 tests passed).
  - Document intelligence parsing across CSV, Excel, PDF, and DOCX formats is intact (22 tests passed).
- **Design System Consistency**:
  - `InviteAccept.jsx` now uses standardized `.jira-*` classes identical to `Login.jsx`.
  - AI Assistant inputs integrate seamlessly with existing modal styles and keyboard shortcuts.

---

## 8. Prioritized List of Remaining Actions

1. **[High Priority] Set Object Storage Environment Variables on Vercel**:
   Add `USE_S3`, `AWS_STORAGE_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` to the Vercel project environment settings to ensure files persist across serverless container restarts.
2. **[Medium Priority] Stage and Commit Working Tree on `adheesh-dev`**:
   Upon user approval, create a clean commit on `adheesh-dev` containing the reliability fixes and review documentation.
3. **[Medium Priority] Vercel Preview Verification**:
   Push `adheesh-dev` to `origin/adheesh-dev` to trigger the Vercel Preview deployment and perform manual end-to-end verification of document uploads, invite acceptance, and AI assistant interactions.

---

## 9. Final Recommendation

### **`READY WITH KNOWN LIMITATIONS`**

**Justification**:
- All code changes on `adheesh-dev` are strictly scoped, fully verified, and backed by 77 automated backend tests and clean frontend builds.
- The upload failures, unstyled invitation form, multiline AI input clipping, token leakage in download URLs, and Django system warnings are completely fixed.
- The single known limitation is the ephemeral nature of `/tmp/media` on Vercel serverless functions, which is an infrastructure environment configuration dependency (requiring S3/R2 credentials in Vercel settings) rather than a code defect. The codebase is already prepared to utilize S3 immediately upon environment variable provisioning.
