import io
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from issues.models import Issue, IssueAttachment
from projects.models import Project, ProjectDoc, ProjectMembership

User = get_user_model()


class ProductionReliabilityPhase1Tests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(
            username="owner_user",
            email="owner@nexo.test",
            password="StrongPassword123!",
            is_active=True,
            user_type="ADMIN",
        )
        self.member = User.objects.create_user(
            username="member_user",
            email="member@nexo.test",
            password="StrongPassword123!",
            is_active=True,
        )
        self.outsider = User.objects.create_user(
            username="outsider_user",
            email="outsider@nexo.test",
            password="StrongPassword123!",
            is_active=True,
        )

        self.owner_token = Token.objects.create(user=self.owner)
        self.member_token = Token.objects.create(user=self.member)
        self.outsider_token = Token.objects.create(user=self.outsider)

        self.project = Project.objects.create(
            name="Alpha Project",
            key="ALPHA",
            description="Alpha project for testing",
        )
        ProjectMembership.objects.create(project=self.project, user=self.owner, role="ADMIN")
        ProjectMembership.objects.create(project=self.project, user=self.member, role="MEMBER")

        # Project document with a file
        uploaded_doc_file = SimpleUploadedFile(
            "sample_specs.pdf",
            b"%PDF-1.4 sample pdf content for testing delivery",
            content_type="application/pdf",
        )
        self.doc = ProjectDoc.objects.create(
            project=self.project,
            title="Sample Specs",
            content="Sample specifications document",
            file=uploaded_doc_file,
            created_by=self.owner,
        )

        # Issue and attachment
        self.issue = Issue.objects.create(
            project=self.project,
            title="Test Issue with Attachment",
            reporter=self.owner,
        )
        uploaded_att_file = SimpleUploadedFile(
            "screenshot.png",
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR sample png bytes",
            content_type="image/png",
        )
        self.attachment = IssueAttachment.objects.create(
            issue=self.issue,
            uploaded_by=self.owner,
            file=uploaded_att_file,
            filename="screenshot.png",
            file_size=32,
            content_type="image/png",
        )

    def test_django_check_no_warnings(self):
        """Verify that DEFAULT_AUTO_FIELD and AppConfig eliminate all models.W042 warnings."""
        out = io.StringIO()
        call_command("check", "--fail-level", "WARNING", stdout=out)
        self.assertIn("System check identified no issues", out.getvalue())

    def test_project_doc_download_by_authorized_member_header(self):
        """Authorized member can download project doc via standard Token header."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.member_token.key}")
        response = self.client.get(f"/api/docs/{self.doc.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("pdf", response.headers.get("Content-Type", "").lower())
        self.assertIn("attachment", response.headers.get("Content-Disposition", ""))

    def test_project_doc_download_via_token_query_param(self):
        """Direct browser navigation with ?token=<key> query parameter succeeds."""
        # Client has no credentials header
        self.client.credentials()
        response = self.client.get(f"/api/docs/{self.doc.id}/download/?token={self.member_token.key}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", response.headers.get("Content-Disposition", ""))

    def test_project_doc_download_unauthorized_user_forbidden(self):
        """User who is not a member of the project receives HTTP 403 Forbidden."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.outsider_token.key}")
        response = self.client.get(f"/api/docs/{self.doc.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_project_doc_download_anonymous_rejected(self):
        """Anonymous request without token receives HTTP 401 Unauthorized."""
        self.client.credentials()
        response = self.client.get(f"/api/docs/{self.doc.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_issue_attachment_download_by_authorized_member(self):
        """Authorized project member can download issue attachment."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.member_token.key}")
        response = self.client.get(f"/api/attachments/{self.attachment.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("png", response.headers.get("Content-Type", "").lower())

    def test_issue_attachment_download_via_token_query_param(self):
        """Direct browser navigation with ?token=<key> works for issue attachments."""
        self.client.credentials()
        response = self.client.get(f"/api/attachments/{self.attachment.id}/download/?token={self.member_token.key}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_issue_attachment_download_outsider_forbidden(self):
        """User who is not a project member receives HTTP 403 when attempting to download attachment."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.outsider_token.key}")
        response = self.client.get(f"/api/attachments/{self.attachment.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_serializers_generate_clean_download_urls_without_token_leakage(self):
        """Serializers must generate clean API download URLs without leaking tokens in query parameters."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.member_token.key}")

        # Check doc serializer
        doc_resp = self.client.get(f"/api/docs/{self.doc.id}/")
        self.assertEqual(doc_resp.status_code, status.HTTP_200_OK)
        file_url = doc_resp.data.get("file_url")
        self.assertIsNotNone(file_url)
        self.assertIn(f"/api/docs/{self.doc.id}/download/", file_url)
        self.assertNotIn("token=", file_url)

        # Check attachment serializer
        att_resp = self.client.get(f"/api/attachments/{self.attachment.id}/")
        self.assertEqual(att_resp.status_code, status.HTTP_200_OK)
        att_url = att_resp.data.get("url")
        self.assertIsNotNone(att_url)
        self.assertIn(f"/api/attachments/{self.attachment.id}/download/", att_url)
        self.assertNotIn("token=", att_url)

    def test_project_upload_doc_success(self):
        """Project admin can upload a document file to the project without NameError or 500 error."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.owner_token.key}")
        sample_file = SimpleUploadedFile(
            "roadmap.txt",
            b"Q1 Roadmap: 1. Launch Alpha feature. 2. Verify Vercel storage.",
            content_type="text/plain",
        )
        response = self.client.post(
            f"/api/projects/{self.project.id}/upload_doc/",
            {"file": sample_file, "title": "Roadmap Q1", "template_type": "STATUS"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("doc", response.data)
        self.assertEqual(response.data["doc"]["title"], "Roadmap Q1")
        self.assertIn("intelligence", response.data)

    def test_issue_attachment_upload_success(self):
        """Admin or manager can upload an attachment to an issue without NameError or 500 error."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.owner_token.key}")
        sample_file = SimpleUploadedFile(
            "screenshot.png",
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
            content_type="image/png",
        )
        response = self.client.post(
            "/api/attachments/",
            {"file": sample_file, "issue": self.issue.id},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["filename"], "screenshot.png")
