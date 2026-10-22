import io
import json
import os
import urllib.error
from unittest.mock import MagicMock, patch
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import Project, ProjectDoc, ProjectSignal, ProjectIntelligenceSummary, ProjectMembership
from projects.intelligence.ai_provider import (
    AIProviderConfig,
    mask_secret,
    sanitize_url,
    sanitize_error_message,
    build_databricks_endpoint_url,
    extract_text_from_response,
    execute_llm_call,
    test_ai_connection,
    ai_classify_document,
    ai_interpret_excel_structure,
    ai_reconcile_cross_document,
    ai_synthesize_executive_briefing,
)
import time
import openpyxl
from projects.intelligence.parsers import parse_xlsx, classify_workbook_sheets
from projects.intelligence import process_and_extract_document, generate_project_intelligence

User = get_user_model()


class AIProjectIntelligenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pmo_lead", email="pmo@example.com", password="Password123!", user_type="ADMIN"
        )
        self.project = Project.objects.create(
            name="ACT Renewable Assets", key="ACT", created_by=self.user
        )
        ProjectMembership.objects.create(
            project=self.project, user=self.user, role=ProjectMembership.Role.ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_provider_configuration_and_masking(self):
        """Verifies AI provider config abstraction and safe secret masking."""
        cfg = AIProviderConfig.get_config()
        self.assertIn("provider", cfg)
        self.assertIn("model", cfg)
        self.assertIn("endpoint_type", cfg)
        self.assertIn("has_credentials", cfg)

        # Test secret masking
        masked = mask_secret("TESTING_SECRET_KEY_FOR_UNIT_TESTS_12345")
        self.assertTrue(masked.startswith("TEST..."))
        self.assertTrue(masked.endswith("2345"))
        self.assertNotIn("KEY_FOR_UNIT_TESTS", masked)
        self.assertEqual(mask_secret(""), "<not_set>")
        self.assertEqual(mask_secret("short"), "***")

        # Test token masking
        db_masked = mask_secret("mock_token_for_testing_masking_1234")
        self.assertTrue(db_masked.startswith("mock..."))
        self.assertTrue(db_masked.endswith("1234"))

    def test_databricks_url_builder_and_sanitizer(self):
        """Verifies Databricks AI Gateway & Model Serving URL construction and credential redaction."""
        # 1. AI Gateway with system.ai model name auto-routing
        url_gateway = build_databricks_endpoint_url(
            "https://dbc-bc498a13-d140.cloud.databricks.com",
            "system.ai.meta-llama-3-3-70b-instruct",
        )
        self.assertEqual(
            url_gateway,
            "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
        )

        # 2. AI Gateway direct URL override
        url_direct = build_databricks_endpoint_url(
            "https://ignored.cloud.databricks.com",
            "system.ai.meta-llama-3-3-70b-instruct",
            direct_url="https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
        )
        self.assertEqual(
            url_direct,
            "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
        )

        # 3. Classic Model Serving invocations route for custom served endpoint
        url_classic = build_databricks_endpoint_url(
            "https://adb-123456789.azuredatabricks.net",
            "my-custom-endpoint",
        )
        self.assertEqual(
            url_classic,
            "https://adb-123456789.azuredatabricks.net/serving-endpoints/my-custom-endpoint/invocations",
        )

        # 4. Host without scheme with trailing slash
        url_host_clean = build_databricks_endpoint_url(
            "dbc-bc498a13-d140.cloud.databricks.com/",
            "system.ai.meta-llama-3-3-70b-instruct",
        )
        self.assertEqual(
            url_host_clean,
            "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
        )

        # 5. URL Sanitizer
        safe_url = sanitize_url("https://generativelanguage.googleapis.com/v1beta/models?key=test_api_key_secret_123&alt=json")
        self.assertNotIn("test_api_key_secret_123", safe_url)
        self.assertIn("alt=json", safe_url)

        # 6. Error sanitization
        raw_err = "Error accessing https://host with Bearer secret_tok_9999 and mock_secret_pat_9999 failed"
        sanitized = sanitize_error_message(raw_err, ["secret_tok_9999", "mock_secret_pat_9999"])
        self.assertNotIn("secret_tok_9999", sanitized)
        self.assertNotIn("mock_secret_pat_9999", sanitized)
        self.assertIn("[REDACTED", sanitized)

    def test_databricks_response_extraction_formats(self):
        """Verifies parsing of OpenAI format, Databricks MLflow predictions, and raw responses."""
        # Format 1: Standard OpenAI Chat Completion (Databricks AI Gateway format)
        openai_resp = {
            "choices": [{"message": {"content": "{\"status\": \"ok\", \"from\": \"openai_format\"}"}}]
        }
        self.assertIn("openai_format", extract_text_from_response(openai_resp))

        # Format 2: Databricks MLflow Predictions (list of dicts with content)
        db_preds_resp = {
            "predictions": [{"content": "{\"status\": \"ok\", \"from\": \"databricks_preds\"}"}]
        }
        self.assertIn("databricks_preds", extract_text_from_response(db_preds_resp))

        # Format 3: Databricks Candidates format
        db_cand_resp = {
            "predictions": [{"candidates": [{"text": "{\"status\": \"ok\", \"from\": \"candidates\"}"}]}]
        }
        self.assertIn("candidates", extract_text_from_response(db_cand_resp))

    @patch("urllib.request.urlopen")
    def test_databricks_ai_gateway_payload_and_headers_mock(self, mock_urlopen):
        """Verifies exact headers, URL, and JSON payload sent to Databricks AI Gateway chat/completions."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "id": "chatcmpl-test",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "{\"template_type\": \"TIMELINE\", \"confidence\": 0.96, \"purpose\": \"Project Schedule\", \"reasoning\": \"Gantt milestones\"}"
                }
            }]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        env_patch = {
            "DATABRICKS_ENDPOINT_URL": "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
            "DATABRICKS_MODEL": "system.ai.meta-llama-3-3-70b-instruct",
            "DATABRICKS_TOKEN": "mock_token_for_tests_databricks_1234",
            "AI_PROVIDER": "databricks",
        }
        with patch.dict(os.environ, env_patch):
            cls_res = ai_classify_document("Project_Timeline.xlsx", "WBS deliverables phase 1", "XLSX")
            self.assertEqual(cls_res["mode"], "ACTIVE_AI_CLASSIFICATION")
            self.assertEqual(cls_res["template_type"], "TIMELINE")
            self.assertEqual(cls_res["ai_telemetry"]["status"], "SUCCESS")
            self.assertEqual(cls_res["ai_telemetry"]["provider"], "databricks")

            # Verify the exact request passed to urlopen
            self.assertTrue(mock_urlopen.called)
            req = mock_urlopen.call_args[0][0]
            self.assertEqual(req.full_url, "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions")
            self.assertEqual(req.headers.get("Authorization"), "Bearer mock_token_for_tests_databricks_1234")
            self.assertEqual(req.headers.get("Content-type"), "application/json")

            # Verify request JSON body contains model, messages, max_tokens, temperature
            body = json.loads(req.data.decode("utf-8"))
            self.assertEqual(body["model"], "system.ai.meta-llama-3-3-70b-instruct")
            self.assertIn("messages", body)
            self.assertGreater(len(body["messages"]), 0)
            self.assertEqual(body["max_tokens"], 2048)
            self.assertEqual(body["temperature"], 0.1)

    @patch("urllib.request.urlopen")
    def test_databricks_safe_connection_probe_success_mock(self, mock_urlopen):
        """Verifies safe connection probe success with Databricks AI Gateway (mocked)."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "choices": [{"message": {"content": "{\"status\": \"ok\", \"message\": \"connected to llama-3\"}"}}]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        env_patch = {
            "DATABRICKS_HOST": "https://dbc-bc498a13-d140.cloud.databricks.com",
            "DATABRICKS_MODEL": "system.ai.meta-llama-3-3-70b-instruct",
            "DATABRICKS_TOKEN": "mock_token_for_tests_databricks_5678",
            "AI_PROVIDER": "databricks",
        }
        with patch.dict(os.environ, env_patch):
            res = test_ai_connection(timeout=5)
            self.assertEqual(res["status"], "CONNECTED")
            self.assertEqual(res["provider"], "databricks")
            self.assertEqual(res["endpoint_name"], "system.ai.meta-llama-3-3-70b-instruct")
            self.assertEqual(
                res["endpoint_url"],
                "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
            )
            self.assertEqual(res["http_status"], 200)
            self.assertTrue(res["has_credentials"])
            self.assertEqual(res["masked_token"], "mock...5678")
            self.assertIsNone(res["error"])
            self.assertNotIn("mock_token_for_tests_databricks_5678", str(res))

    @patch("urllib.request.urlopen")
    def test_databricks_connection_probe_deliberately_invalid_credential(self, mock_urlopen):
        """Verifies safe connection probe error reporting with deliberately invalid credential."""
        invalid_token = "invalid_token_sample_test_999999999"
        mock_err = urllib.error.HTTPError(
            url="https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=io.BytesIO(b'{"error": "Invalid access token provided: invalid_token_sample_test_999999999"}'),
        )
        mock_urlopen.side_effect = mock_err

        env_patch = {
            "DATABRICKS_ENDPOINT_URL": "https://dbc-bc498a13-d140.cloud.databricks.com/ai-gateway/mlflow/v1/chat/completions",
            "DATABRICKS_TOKEN": invalid_token,
            "DATABRICKS_MODEL": "system.ai.meta-llama-3-3-70b-instruct",
            "AI_PROVIDER": "databricks",
        }
        with patch.dict(os.environ, env_patch):
            res = test_ai_connection(timeout=5)
            self.assertEqual(res["status"], "ERROR")
            self.assertEqual(res["provider"], "databricks")
            self.assertEqual(res["http_status"], 401)
            self.assertTrue(res["has_credentials"])
            self.assertIn("HTTP 401", res["error"])
            # Ensure the raw token was never exposed in the error message
            self.assertNotIn(invalid_token, res["error"])
            self.assertNotIn(invalid_token, str(res))

    @patch("urllib.request.urlopen")
    def test_databricks_execute_llm_call_fallback_on_invalid_credential(self, mock_urlopen):
        """
        Verifies that when Databricks credentials fail (e.g. 401 / 403),
        all downstream AI functions explicitly fallback to deterministic engines
        without breaking or throwing exceptions.
        """
        mock_err = urllib.error.HTTPError(
            url="https://databricks/invocations",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(b'{"error": "Access denied to endpoint"}'),
        )
        mock_urlopen.side_effect = mock_err

        env_patch = {
            "DATABRICKS_HOST": "https://adb-123456789.azuredatabricks.net",
            "DATABRICKS_TOKEN": "mock_invalid_pat_for_testing",
            "DATABRICKS_SERVING_ENDPOINT": "meta-llama-3",
            "AI_PROVIDER": "databricks",
        }
        with patch.dict(os.environ, env_patch):
            # 1. Classification
            cls_res = ai_classify_document("Project_Timeline.xlsx", "WBS deliverables", "XLSX")
            self.assertEqual(cls_res["template_type"], "TIMELINE")
            self.assertEqual(cls_res["mode"], "DETERMINISTIC_FALLBACK")
            self.assertEqual(cls_res["ai_telemetry"]["status"], "FALLBACK")
            self.assertIn("HTTP 403", cls_res["ai_telemetry"]["error"])

            # 2. Excel Structure Interpretation
            excel_res = ai_interpret_excel_structure(
                [
                    {"name": "Project Timeline_Updated", "visibility": "visible"},
                    {"name": "Task", "visibility": "visible"},
                    {"name": "Project Timeline 1", "visibility": "hidden"},
                ],
                {},
                {},
            )
            self.assertEqual(excel_res["primary_timeline_sheet"], "Project Timeline_Updated")
            self.assertEqual(excel_res["mode"], "DETERMINISTIC_EXCEL_FALLBACK")
            self.assertEqual(excel_res["ai_telemetry"]["status"], "FALLBACK")

            # 3. Reconciliation
            recon_res = ai_reconcile_cross_document(
                [{"title": "AE Formatted", "status": "IN_PROGRESS", "has_extension": True, "extension_days": 14}],
                [{"filename": "Weekly.pdf", "accomplishments": [{"title": "AE Formatted Validation"}]}],
            )
            self.assertEqual(recon_res["reconciliation_mode"], "DETERMINISTIC_RECONCILIATION_FALLBACK")
            self.assertEqual(recon_res["ai_telemetry"]["status"], "FALLBACK")

            # 4. Executive Briefing
            brief_res = ai_synthesize_executive_briefing({
                "health": {"status": "AT_RISK"},
                "progress": {"percent": 20, "done_items": 2, "total_items": 10},
                "deliverables": [{"title": "AE Formatted", "status": "IN_PROGRESS", "has_extension": True, "extension_days": 14}],
                "risks_and_blockers": [],
            })
            self.assertEqual(brief_res["mode"], "DETERMINISTIC_SYNTHESIS_FALLBACK")
            self.assertEqual(brief_res["ai_telemetry"]["status"], "FALLBACK")

    def test_ai_status_api_endpoint(self):
        """Verifies GET /api/projects/ai_status/ DRF endpoint returns safe provider telemetry."""
        response = self.client.get("/api/projects/ai_status/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("status", data)
        self.assertIn("provider", data)
        self.assertIn("has_credentials", data)
        self.assertIn("masked_token", data)
        self.assertIn("latency_ms", data)
        # Ensure no secrets leaked
        self.assertNotIn("TESTING_SECRET_KEY", json.dumps(data))
        db_token = os.environ.get("DATABRICKS_TOKEN", "")
        if db_token and len(db_token) > 10:
            self.assertNotIn(db_token, json.dumps(data))
        self.assertTrue("..." in data.get("masked_token", "") or data.get("masked_token") == "<not_set>")

    def test_ai_document_classification_fallback_resilience(self):
        """Verifies AI document classification falls back safely with high precision."""
        res_timeline = ai_classify_document("Nexus_Project_Timeline.xlsx", "Gantt timeline deliverables phase 1", "XLSX")
        self.assertEqual(res_timeline["template_type"], "TIMELINE")
        self.assertGreaterEqual(res_timeline["confidence"], 0.7)
        self.assertIn("purpose", res_timeline)
        self.assertIn("ai_telemetry", res_timeline)

        res_status = ai_classify_document("Weekly_Report_Oct10.pdf", "Accomplishments, completed tasks, and blockers", "PDF")
        self.assertEqual(res_status["template_type"], "STATUS")
        self.assertGreaterEqual(res_status["confidence"], 0.7)

    def test_excel_strict_worksheet_visibility_and_formula_manifest(self):
        """
        Critical test: Verifies that hidden worksheets (Project Timeline 1, MVP 2)
        are completely excluded from processing, text, sections, and metrics,
        while visible sheets and formulas are verified.
        """
        excel_path = r"C:\Nexo\backend\media\project_docs\20261008\Nexus_Project_Timeline_1.xlsx"
        if not os.path.exists(excel_path):
            self.skipTest("Nexus_Project_Timeline_1.xlsx fixture not found on disk")

        with open(excel_path, "rb") as f:
            parsed = parse_xlsx(f.read(), "Nexus_Project_Timeline_1.xlsx")

        section_headings = [s.heading for s in parsed.sections]
        # Visible sheets must be present
        self.assertIn("Sheet: Project Timeline_Updated", section_headings)
        self.assertIn("Sheet: Project Timeline ", section_headings)
        self.assertIn("Sheet: Task", section_headings)

        # Hidden sheets MUST be excluded
        self.assertNotIn("Sheet: Project Timeline 1", section_headings)
        self.assertNotIn("Sheet: MVP 2", section_headings)
        self.assertNotIn("Project Timeline 1", parsed.raw_text)
        self.assertNotIn("MVP 2", parsed.raw_text)

        # Audit manifest checks
        manifest = parsed.metadata.get("audit_manifest", {})
        self.assertEqual(manifest.get("primary_timeline_sheet"), "Project Timeline_Updated")
        self.assertEqual(manifest.get("supporting_wbs_sheet"), "Task")

        # Excluded sheets verified
        ignored = manifest.get("calculation_basis", {}).get("ignored_sheets", [])
        self.assertIn("Project Timeline 1", ignored)
        self.assertIn("MVP 2", ignored)

        # Deliverables count and deterministic progress (reconciled timeline: 5 completed, 50%)
        deliv_sum = manifest.get("deliverables_summary", {})
        self.assertEqual(deliv_sum.get("total"), 10)
        self.assertEqual(deliv_sum.get("completed"), 5)
        self.assertEqual(deliv_sum.get("percent"), 50)

        # Formula inspection verification
        formulas_mf = manifest.get("formulas_manifest", {})
        self.assertTrue(formulas_mf.get("has_formulas"))
        self.assertEqual(formulas_mf.get("status"), "EVALUATED_FROM_CACHED_VALUES")
        self.assertGreater(formulas_mf.get("formula_count", 0), 100)

        # AI structure interpretation check
        self.assertIn("ai_structure_interpretation", manifest)
        self.assertEqual(manifest["ai_structure_interpretation"]["primary_timeline_sheet"], "Project Timeline_Updated")

    def test_cross_document_reconciliation_and_discrepancies(self):
        """Verifies entity matching and detection of status contradictions (DISC-01)."""
        deliverables = [
            {"title": "Prod -> Dev environment match", "status": "COMPLETED", "has_extension": False, "source_location": "Row 4"},
            {"title": "AE Formatted", "status": "IN_PROGRESS", "has_extension": True, "extension_days": 14, "source_location": "Row 8"},
            {"title": "Aderis Acuity Raw", "status": "COMPLETED", "has_extension": False, "source_location": "Row 7"},
        ]
        narrative_docs = [
            {
                "filename": "ACT_Weekly_Report.pdf",
                "accomplishments": [
                    {"title": "AE Formatted Parsing Validation", "source_location": "Page 5"},
                    {"title": "Aderis Acuity Raw Ingestion Framework", "source_location": "Page 5"},
                ],
                "operational_issues": [
                    {"title": "Inverter outages in PowerTrack", "location": "Page 5"},
                    {"title": "Data mismatches beyond tolerance", "location": "Page 5"},
                ],
            }
        ]
        with patch.dict(os.environ, {"AI_PROVIDER": "none"}):
            recon = ai_reconcile_cross_document(deliverables, narrative_docs)
            self.assertIn("matched_entities", recon)
            self.assertIn("discrepancies", recon)

            # DISC-01: AE Formatted contradiction
            disc_ids = [d["id"] for d in recon["discrepancies"]]
            self.assertIn("DISC-01", disc_ids)
            ae_disc = next(d for d in recon["discrepancies"] if d["id"] == "DISC-01")
            self.assertEqual(ae_disc["type"], "STATUS_CONTRADICTION")

            # DISC-02: Operational blockers
            self.assertIn("DISC-02", disc_ids)

    def test_reprocessing_deduplication(self):
        """Verifies that re-running document extraction protects against duplicate signals."""
        doc = ProjectDoc.objects.create(
            project=self.project,
            title="Sample Retro Notes",
            template_type=ProjectDoc.TemplateType.RETRO,
            content="## Retro\n### What Went Well\n- Completed backend API on schedule\n### Action Items\n- Add automated tests",
            created_by=self.user,
        )
        # Run 1
        res1 = process_and_extract_document(doc)
        count1 = ProjectSignal.objects.filter(source_doc=doc).count()
        self.assertGreater(count1, 0)

        # Run 2 (Reprocess)
        res2 = process_and_extract_document(doc)
        count2 = ProjectSignal.objects.filter(source_doc=doc).count()
        self.assertEqual(count1, count2)

    def test_project_intelligence_api_endpoint(self):
        """Verifies GET /api/projects/:id/intelligence/ returns canonical normalized_state."""
        ProjectDoc.objects.create(
            project=self.project,
            title="Roadmap Spec",
            template_type=ProjectDoc.TemplateType.PRD,
            content="## Scope\n- Phase 1: Engine Integration\n- Phase 2: User Validation",
            created_by=self.user,
        )
        response = self.client.get(f"/api/projects/{self.project.id}/intelligence/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("normalized_state", data)
        self.assertIn("health", data["normalized_state"])
        self.assertIn("progress", data["normalized_state"])
        self.assertIn("ai_briefing", data["normalized_state"])

    def test_empty_project_fast_path_latency_and_schema(self):
        """
        Verifies that newly created empty projects (0 issues, 0 docs) bypass remote LLMs,
        execute in sub-50ms via the deterministic fast path, and return a complete C-level schema.
        """
        empty_proj = Project.objects.create(
            name="Greenfield Solar Grid", key="GSG", created_by=self.user
        )
        t0 = time.time()
        res = generate_project_intelligence(empty_proj)
        elapsed = time.time() - t0

        # Latency must be near-instantaneous (well under 150ms in testing environments)
        self.assertLess(elapsed, 0.15)
        self.assertEqual(res["signals_count"], 0)
        self.assertEqual(res["completion_percent"], 0)
        self.assertEqual(res["health"]["status"], "HEALTHY")
        self.assertIn("ai_telemetry", res)
        self.assertEqual(res["ai_telemetry"]["source"], "fast_path")
        self.assertEqual(res["ai_telemetry"]["llm_requests_count"], 0)

        # Full C-level dashboard schema validation
        norm = res["normalized_state"]
        for key in [
            "project", "health", "progress", "timeline", "workstreams",
            "challenges_and_risks", "agent_utilization", "weekly_comparison",
            "delays_summary", "documentation_governance",
        ]:
            self.assertIn(key, norm, f"Missing required dashboard key: {key}")

        # Summary must be persisted in database
        summary = ProjectIntelligenceSummary.objects.filter(project=empty_proj).first()
        self.assertIsNotNone(summary)
        self.assertEqual(summary.health_status, "HEALTHY")

    def test_raw_data_sheet_exclusion_and_bounded_parsing(self):
        """
        Verifies that worksheets with >2000 rows or matching raw dataset patterns
        (e.g., 'Daily Loads', 'Dump', 'Telemetry') are classified as RAW_DATA_TABLE and IGNORED,
        preventing infinite loop hangs during schedule extraction.
        """
        wb = openpyxl.Workbook()
        ws_timeline = wb.active
        ws_timeline.title = "Project Plan"
        ws_timeline.cell(row=1, column=1, value="Task Name")
        ws_timeline.cell(row=2, column=1, value="Core Foundation")

        ws_daily = wb.create_sheet(title="Daily Loads")
        ws_daily.cell(row=1, column=1, value="Transaction ID")
        ws_daily.cell(row=2, column=1, value="TX-1001")

        ws_huge = wb.create_sheet(title="Audit Log")
        ws_huge.cell(row=2500, column=1, value="End of audit log")

        classified = classify_workbook_sheets(wb)
        manifest = {s["name"]: s for s in classified["manifest"]}

        # Daily Loads flagged as RAW_DATA_TABLE and IGNORED
        self.assertEqual(manifest["Daily Loads"]["role"], "RAW_DATA_TABLE")
        self.assertEqual(manifest["Daily Loads"]["status"], "IGNORED")

        # Audit Log (>2000 rows) flagged as RAW_DATA_TABLE and IGNORED
        self.assertEqual(manifest["Audit Log"]["role"], "RAW_DATA_TABLE")
        self.assertEqual(manifest["Audit Log"]["status"], "IGNORED")

        # Project Plan selected as PRIMARY_TIMELINE
        self.assertEqual(classified["primary_timeline_sheet"], "Project Plan")
        self.assertEqual(manifest["Project Plan"]["role"], "PRIMARY_TIMELINE")
        self.assertEqual(manifest["Project Plan"]["status"], "PROCESSED")

    @patch("projects.intelligence.ai_classify_document")
    def test_template_classification_bypass_for_user_selection(self, mock_classify):
        """
        Verifies that when a document template is explicitly selected during upload (e.g. STATUS),
        expensive remote AI classification is bypassed entirely. When CUSTOM is selected,
        AI classification is invoked.
        """
        doc_explicit = ProjectDoc.objects.create(
            project=self.project,
            title="Weekly PMO Summary",
            template_type=ProjectDoc.TemplateType.STATUS,
            content="## Weekly Status\nAll engineering deliverables on schedule.",
            created_by=self.user,
        )
        process_and_extract_document(doc_explicit)
        mock_classify.assert_not_called()

        doc_custom = ProjectDoc.objects.create(
            project=self.project,
            title="Ad-hoc Notes",
            template_type=ProjectDoc.TemplateType.CUSTOM,
            content="## Notes\nDiscussion on database scaling.",
            created_by=self.user,
        )
        mock_classify.return_value = {
            "template_type": "PRD",
            "confidence": 0.9,
            "purpose": "Product Requirements Document",
            "reasoning": "Detected feature specification format.",
            "ai_telemetry": {"status": "LIVE_AI", "latency_ms": 10},
        }
        process_and_extract_document(doc_custom)
        mock_classify.assert_called_once()

    @patch("projects.intelligence.parsers.parse_uploaded_file")
    def test_parsed_doc_override_in_synthesizer(self, mock_parser):
        """
        Verifies that parsed_doc_override avoids re-reading and re-parsing
        newly uploaded files from disk during synthesis.
        """
        doc = ProjectDoc.objects.create(
            project=self.project,
            title="Design Guidelines",
            template_type=ProjectDoc.TemplateType.PRD,
            content="## Guidelines\nAll components must follow NEXO design tokens.",
            created_by=self.user,
        )
        mock_parsed = MagicMock()
        mock_parsed.metadata = {"audit_manifest": {"document_type": "PRD"}}

        # With override provided, parse_uploaded_file should not be invoked for this doc
        generate_project_intelligence(
            self.project,
            force_refresh=True,
            parsed_doc_override={doc.id: mock_parsed},
        )
        mock_parser.assert_not_called()

    def test_excel_only_project_intelligence_generation(self):
        """
        Verifies that projects containing ONLY Excel documents (and no narrative/PDF documents)
        synthesize cleanly without UnboundLocalError: delivs or 500 status codes.
        """
        excel_project = Project.objects.create(
            name="Phibro Agricultural Assets", key="PAA", created_by=self.user
        )
        mock_parsed = MagicMock()
        mock_parsed.file_type = "XLSX"
        mock_parsed.raw_text = "Primary Timeline: Phase 1\nTask 1 Done"
        mock_parsed.metadata = {
            "audit_manifest": {
                "document_type": "EXCEL_WORKBOOK",
                "filename": "Phibro_Master_Tracker.xlsx",
                "deliverables_summary": {"total": 5, "completed": 1, "percent": 20},
                "deliverables": [
                    {"title": "Sensor Calibration", "status": "COMPLETED", "has_extension": False}
                ],
            }
        }
        doc = ProjectDoc.objects.create(
            project=excel_project,
            title="Phibro Master Tracker",
            template_type=ProjectDoc.TemplateType.TIMELINE,
            file_type="XLSX",
            created_by=self.user,
        )

        res = generate_project_intelligence(
            excel_project,
            force_refresh=True,
            parsed_doc_override={doc.id: mock_parsed},
        )
        self.assertIsNotNone(res)
        self.assertIn("normalized_state", res)
        self.assertEqual(res["normalized_state"]["project"]["name"], "Phibro Agricultural Assets")
        self.assertIn("ai_reconciliation_schema", res)
        self.assertEqual(res["normalized_state"]["progress"]["total_items"], 5)
        self.assertEqual(res["delivery_metrics"]["completed"]["count"], 1)

    def test_multi_sheet_workstream_separation_and_ambiguous_skipping(self):
        """
        Verifies that:
        1. 'Zoho Requirement' and 'Database requirements' are detected as separate workstreams with independent progress.
        2. 'Issue tracker' is ingested into shared project-level risks (not as a delivery workstream).
        3. Ambiguous/operational sheets with 'Status' (Reconciliation tracker, Merge_list, Exception request) are safely skipped.
        """
        phibro_path = r"C:\Nexo\backend\media\project_docs\20261013\Phibro_Master_Tracker.xlsx"
        if not os.path.exists(phibro_path):
            self.skipTest("Phibro workbook not present at path.")

        with open(phibro_path, "rb") as f:
            content = f.read()

        parsed = parse_xlsx(content, "Phibro_Master_Tracker.xlsx")
        structured = parsed.metadata.get("structured_excel", {})
        phases = {p["name"]: p for p in structured.get("phases", [])}

        # 1. Assert separate workstreams are detected
        self.assertIn("Zoho Requirement", phases)
        self.assertIn("Database requirements", phases)
        self.assertTrue("Operational Tasks" in phases or "Regular task" in phases)

        # 2. Assert independent progress calculations
        zoho = phases["Zoho Requirement"]
        self.assertEqual(zoho["total"], 86)
        self.assertEqual(zoho["done"], 84)
        self.assertEqual(zoho["in_progress"], 2)
        self.assertEqual(zoho["percent"], 98)

        db_req = phases["Database requirements"]
        self.assertEqual(db_req["total"], 62)
        self.assertEqual(db_req["done"], 60)
        self.assertEqual(db_req["percent"], 97)

        # 3. Assert ambiguous sheets with 'Status' are NOT in workstreams
        self.assertNotIn("Reconciliation tracker", phases)
        self.assertNotIn("Merge list", phases)
        self.assertNotIn("Merge_list", phases)
        self.assertNotIn("Exception request", phases)
        self.assertNotIn("Daily Loads", phases)
        self.assertNotIn("Daily Checks", phases)

        # 4. Assert shared issue tracker is captured as project-level risks
        risks = structured.get("risks", [])
        self.assertGreaterEqual(len(risks), 17)
        resolved_issues = [r for r in risks if r["status"] == "RESOLVED"]
        self.assertGreaterEqual(len(resolved_issues), 17)
        # Check resolution steps are preserved
        self.assertTrue(any("Resolution: 1. Delete the incorrectly loaded invoice" in (r.get("description") or "") for r in risks))

    def test_synthetic_ambiguous_sheet_with_status_column_skipped(self):
        """
        Confirms the parser does not classify every sheet as a task tracker simply because
        it contains a column called 'Status'. Ambiguous non-task tables must be skipped.
        """
        import openpyxl
        wb = openpyxl.Workbook()
        
        # Sheet 1: Genuine task tracker with Activity + Status + Assignee
        ws_tasks = wb.active
        ws_tasks.title = "Core Features"
        ws_tasks.append(["Activity", "Status", "Handled by", "Requested Date"])
        ws_tasks.append(["Build authentication flow", "Completed", "Alice", "2026-10-01"])
        ws_tasks.append(["Configure database replica", "In Progress", "Bob", "2026-10-02"])

        # Sheet 2: Operational server health log with 'Status' (NOT a task tracker)
        ws_servers = wb.create_sheet(title="Server Telemetry")
        ws_servers.append(["Server Hostname", "IP Address", "Status", "Uptime Hours"])
        ws_servers.append(["prod-web-01", "10.0.0.1", "Online", 720])
        ws_servers.append(["prod-db-01", "10.0.0.2", "Online", 1440])

        # Sheet 3: Financial transaction ledger with 'Status' (NOT a task tracker)
        ws_finance = wb.create_sheet(title="Invoice Ledger")
        ws_finance.append(["Invoice Number", "Customer ID", "Amount", "Status"])
        ws_finance.append(["INV-1001", "CUST-99", 5400.00, "Paid"])
        ws_finance.append(["INV-1002", "CUST-88", 1200.50, "Pending"])

        bio = io.BytesIO()
        wb.save(bio)
        content = bio.getvalue()

        parsed = parse_xlsx(content, "synthetic_project.xlsx")
        structured = parsed.metadata.get("structured_excel", {})
        phases = {p["name"]: p for p in structured.get("phases", [])}

        # Genuine task tracker must be recognized
        self.assertIn("Core Features", phases)
        self.assertEqual(phases["Core Features"]["total"], 2)
        self.assertEqual(phases["Core Features"]["done"], 1)

        # Ambiguous sheets with 'Status' must be safely skipped
        self.assertNotIn("Server Telemetry", phases)
        self.assertNotIn("Invoice Ledger", phases)

    def test_phibro_crm_source_of_truth_and_dashboard_reconciliation(self):
        """
        Acceptance test for Phibro-CRM.xlsx:
        1. Source of truth counts:
           - Zoho Requirement: 86 valid records (84 Completed, 2 In Progress)
           - Database requirements: 74 valid records (72 Completed, 2 pending review)
           - Operational Tasks: 12 valid records (12 Completed from '✅')
           - Issue tracker: 17 valid records (17 Resolved, solution steps preserved)
        2. Blank row 2 on Database requirements is safely skipped.
        3. Issue tracker header detected at Row 3 (Rows 1-2 banners skipped).
        4. Ownership:
           - Sneha Singh & Gowtham is preserved and mapped to owner.
           - Uma is preserved and mapped to owner.
           - Deliverable cards never collapse to 'Unassigned' when Handled by is present.
        5. Denominators:
           - Core requirements total = 160 (86 + 74).
           - Operational tasks = 12.
           - Resolved issues = 17.
        6. Synthesis:
           - Overall requirements completion = 98% (156 / 160).
        """
        crm_path = r"C:\Nexo\backend\media\project_docs\20261014\Phibro-CRM.xlsx"
        if not os.path.exists(crm_path):
            self.skipTest("Phibro-CRM workbook not present on disk.")

        with open(crm_path, "rb") as f:
            content = f.read()

        parsed = parse_xlsx(content, "Phibro-CRM.xlsx")
        structured = parsed.metadata.get("structured_excel", {})
        calc = structured.get("audit_manifest", {}).get("calculation_basis", {})
        phases = {p["name"]: p for p in structured.get("phases", [])}

        # 1. Source counts verification
        self.assertEqual(calc.get("requirements_total"), 160)
        self.assertEqual(calc.get("requirements_completed"), 156)
        self.assertEqual(calc.get("requirements_in_progress"), 2)
        self.assertEqual(calc.get("operational_tasks_total"), 12)
        self.assertEqual(calc.get("operational_tasks_completed"), 12)
        self.assertEqual(calc.get("issues_total"), 17)
        self.assertEqual(calc.get("issues_resolved"), 17)

        # 2. Workstream breakdown verification
        zoho = phases.get("Zoho Requirement")
        self.assertIsNotNone(zoho)
        self.assertEqual(zoho["total"], 86)
        self.assertEqual(zoho["done"], 84)
        self.assertEqual(zoho["in_progress"], 2)
        self.assertEqual(zoho["percent"], 98)

        db = phases.get("Database requirements")
        self.assertIsNotNone(db)
        self.assertEqual(db["total"], 74)
        self.assertEqual(db["done"], 72)
        self.assertEqual(db["percent"], 97)

        ops = phases.get("Operational Tasks")
        self.assertIsNotNone(ops)
        self.assertEqual(ops["total"], 12)
        self.assertEqual(ops["done"], 12)
        self.assertEqual(ops["percent"], 100)

        # 3. Ownership and field preservation
        tasks = structured.get("tasks", [])
        sneha_tasks = [t for t in tasks if "sneha" in (t.get("owner") or "").lower()]
        self.assertGreaterEqual(len(sneha_tasks), 80)
        for st in sneha_tasks:
            self.assertNotEqual(st.get("owner"), "Unassigned")
            self.assertTrue(bool(st.get("owner")))
            self.assertEqual(st.get("owner"), st.get("assignee"))

        uma_tasks = [t for t in tasks if "uma" in (t.get("owner") or "").lower()]
        self.assertGreaterEqual(len(uma_tasks), 60)
        for ut in uma_tasks:
            self.assertNotEqual(ut.get("owner"), "Unassigned")

        # 4. Issue tracker resolution steps
        risks = structured.get("risks", [])
        self.assertEqual(len(risks), 17)
        self.assertTrue(all(r.get("status") == "RESOLVED" for r in risks))
        self.assertTrue(any("Delete the incorrectly loaded invoice" in (r.get("solution") or "") for r in risks))

        # 5. Project intelligence synthesis test
        p, _ = Project.objects.get_or_create(key="PHI", defaults={"name": "Phibro", "created_by": self.user})
        p.docs.all().delete()
        doc = ProjectDoc.objects.create(
            project=p,
            title="Phibro-CRM",
            file_type="XLSX",
            template_type=ProjectDoc.TemplateType.TIMELINE,
            created_by=self.user,
        )
        with open(crm_path, "rb") as f:
            doc.file.save("Phibro-CRM.xlsx", f)

        intel = generate_project_intelligence(p, force_refresh=True)
        self.assertEqual(intel["completion_percent"], 98)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_total"], 160)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_done"], 156)
        self.assertEqual(len(intel["workstreams"]), 4)
        self.assertEqual(len(intel["project_issues"]), 17)

    def test_act_timeline_chronological_completion(self):
        """
        Acceptance test for ACT timeline reconciliation:
        1. Verifies that red extension marks followed by terminal green marks
           result in status == COMPLETED with schedule_status == EXTENDED.
        2. Verifies AE Raw (+6d), AE Formatted (+14d), and Bronze (+8d) are COMPLETED.
        3. Verifies Silver (+2d) remains IN_PROGRESS (terminal mark is red, no green).
        4. Verifies total completed count is 5 of 10 deliverables (50% completion).
        """
        timeline_path = os.path.join(
            settings.BASE_DIR, "media", "project_docs", "20261008", "Nexus_Project_Timeline_1.xlsx"
        )
        if not os.path.exists(timeline_path):
            self.skipTest(f"ACT workbook not found at {timeline_path}")

        with open(timeline_path, "rb") as f:
            content = f.read()

        parsed = parse_xlsx(content, "Nexus_Project_Timeline_1.xlsx")
        structured = parsed.metadata.get("structured_excel", {})
        audit = structured.get("audit_manifest", {})
        d_summary = audit.get("deliverables_summary", {})
        deliverables = audit.get("deliverables", [])

        # 1. Summary counts verification
        self.assertEqual(d_summary.get("total"), 10)
        self.assertEqual(d_summary.get("completed"), 5)
        self.assertEqual(d_summary.get("in_progress"), 2)
        self.assertEqual(d_summary.get("planned"), 3)
        self.assertEqual(d_summary.get("extended"), 4)
        self.assertEqual(d_summary.get("percent"), 50)

        # 2. Chronological completion verification
        ae_raw = next(d for d in deliverables if "ae raw" == d["title"].lower())
        self.assertEqual(ae_raw["status"], "COMPLETED")
        self.assertEqual(ae_raw["execution_status"], "COMPLETED")
        self.assertEqual(ae_raw["schedule_status"], "EXTENDED")
        self.assertEqual(ae_raw["extension_days"], 6)
        self.assertEqual(ae_raw["actual_completion_date"], "2026-09-23")
        self.assertTrue(ae_raw["has_extension"])

        ae_form = next(d for d in deliverables if "ae formatted" == d["title"].lower())
        self.assertEqual(ae_form["status"], "COMPLETED")
        self.assertEqual(ae_form["execution_status"], "COMPLETED")
        self.assertEqual(ae_form["schedule_status"], "EXTENDED")
        self.assertEqual(ae_form["extension_days"], 14)
        self.assertEqual(ae_form["actual_completion_date"], "2026-10-05")
        self.assertTrue(ae_form["has_extension"])

        bronze = next(d for d in deliverables if "bronze" == d["title"].lower())
        self.assertEqual(bronze["status"], "COMPLETED")
        self.assertEqual(bronze["execution_status"], "COMPLETED")
        self.assertEqual(bronze["schedule_status"], "EXTENDED")
        self.assertEqual(bronze["extension_days"], 8)
        self.assertEqual(bronze["actual_completion_date"], "2026-10-05")
        self.assertTrue(bronze["has_extension"])

        silver = next(d for d in deliverables if "silver" == d["title"].lower())
        self.assertEqual(silver["status"], "IN_PROGRESS")
        self.assertEqual(silver["execution_status"], "IN_PROGRESS")
        self.assertEqual(silver["schedule_status"], "EXTENDED")
        self.assertEqual(silver["extension_days"], 2)
        self.assertIsNone(silver.get("actual_completion_date"))
        self.assertTrue(silver["has_extension"])

        prod_match = next(d for d in deliverables if "prod -> dev" in d["title"].lower())
        self.assertEqual(prod_match["status"], "COMPLETED")
        self.assertEqual(prod_match["schedule_status"], "ON_TIME")
        self.assertFalse(prod_match["has_extension"])

        gold = next(d for d in deliverables if "gold" == d["title"].lower())
        self.assertEqual(gold["status"], "PLANNED")
        self.assertEqual(gold["schedule_status"], "PLANNED")

        # 3. Project intelligence synthesis test
        p_act, _ = Project.objects.get_or_create(key="ACT_TEST", defaults={"name": "ACT Test Project", "created_by": self.user})
        p_act.docs.all().delete()
        doc = ProjectDoc.objects.create(
            project=p_act,
            title="Nexus_Project_Timeline_1",
            file_type="XLSX",
            template_type=ProjectDoc.TemplateType.TIMELINE,
            created_by=self.user,
        )
        with open(timeline_path, "rb") as f:
            doc.file.save("Nexus_Project_Timeline_1.xlsx", f)

        intel = generate_project_intelligence(p_act, force_refresh=True)
        self.assertEqual(intel["completion_percent"], 50)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_total"], 10)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_done"], 5)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_in_progress"], 2)
        self.assertEqual(intel["progress_metrics"]["plan_tasks_todo"], 3)





