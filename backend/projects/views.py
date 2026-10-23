import datetime
import hmac
import io
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from issues.models import ActivityLog, Issue
from users.access import (
    LimitedMemberReadOnly,
    can_create_project,
    can_delete_project,
    effective_project_role,
    has_project_access,
    is_project_admin,
    visible_projects_q,
)
from users.models import Notification
from users.utils import send_project_invite_email

from .exports import generate_canonical_project_csv, generate_canonical_project_workbook
from .intelligence import calculate_file_hash, generate_project_intelligence, process_and_extract_document

from .models import (
    AutomationRule,
    CalendarEntry,
    Project,
    ProjectDoc,
    ProjectIntelligenceSummary,
    ProjectMembership,
    ProjectSignal,
    SavedFilter,
    Sprint,
    WorkflowState,
    WorkflowTransition,
    create_default_workflow,
)
from .permissions import IsProjectMember, IsProjectMemberOrAbove
from .reminders import local_today, mentioned_users, notify_added, process_due
from .serializers import (
    AutomationRuleSerializer,
    CalendarEntrySerializer,
    ProjectDocSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    ProjectSignalSerializer,
    SavedFilterSerializer,
    SprintSerializer,
    WorkflowStateSerializer,
    WorkflowTransitionSerializer,
)

User = get_user_model()


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly, IsProjectMemberOrAbove]

    def get_queryset(self):
        # Admins see every project; everyone else only the projects they're assigned to.
        return Project.objects.filter(visible_projects_q(self.request.user)).distinct()

    def perform_create(self, serializer):
        if not can_create_project(self.request.user):
            raise PermissionDenied("Only Admins and Managers can create projects.")
        project = serializer.save(created_by=self.request.user)
        ProjectMembership.objects.create(
            project=project, user=self.request.user, role=ProjectMembership.Role.ADMIN
        )
        # Seed the default 3-column workflow for this project
        create_default_workflow(project)

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance):
            raise PermissionDenied("Only project admins can change project settings.")
        serializer.save()

    def perform_destroy(self, instance):
        if not can_delete_project(self.request.user):
            raise PermissionDenied("Only Admins can delete projects.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        """POST {user_id or username/email, role} -> adds or updates user role in this project."""
        project = self.get_object()
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can add members.")
        user_id = request.data.get("user_id")
        username = request.data.get("username")
        email = request.data.get("email")
        role = request.data.get("role", ProjectMembership.Role.MEMBER)

        target_user = None
        if user_id:
            target_user = User.objects.filter(id=user_id).first()
        elif username:
            target_user = User.objects.filter(username__iexact=username.strip()).first()
        elif email:
            target_user = User.objects.filter(email__iexact=email.strip()).first()

        if not target_user:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        if target_user.is_deactivated:
            return Response({"error": "This user is inactive and cannot be added to a project."}, status=status.HTTP_400_BAD_REQUEST)

        if role not in [ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER]:
            role = ProjectMembership.Role.MEMBER

        membership, _ = ProjectMembership.objects.update_or_create(
            project=project,
            user=target_user,
            defaults={"role": role},
        )

        Notification.objects.create(
            recipient=target_user,
            actor=request.user,
            action=f"added you to project {project.name}",
            target=project.name,
        )

        if target_user.email:
            send_project_invite_email(
                project_name=project.name,
                invited_email=target_user.email,
                invited_user=target_user.username,
                invited_by=request.user.get_full_name() or request.user.username,
            )

        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        """POST {user_id} -> removes user from this project."""
        project = self.get_object()
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can remove members.")
        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        ProjectMembership.objects.filter(project=project, user_id=user_id).delete()
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def ai_status(self, request):
        """
        GET /api/projects/ai_status/
        Safe connection and status probe for configured AI provider (Databricks, Gemini, OpenAI, etc.).
        Reports provider, model/endpoint, connection status, HTTP status, and latency. Never exposes secrets.
        """
        from .intelligence.ai_provider import test_ai_connection
        res = test_ai_connection()
        return Response(res)

    @action(detail=True, methods=["get"])
    def intelligence(self, request, pk=None):
        """
        GET /api/projects/<id>/intelligence/
        Returns comprehensive PMO project overview combining structured data and document signals.
        Supports fast sub-50ms persistent caching and explicit ?refresh=true cache invalidation.
        """
        project = self.get_object()
        force_refresh = request.query_params.get("refresh", "").lower() in ["true", "1"]
        data = generate_project_intelligence(project, force_refresh=force_refresh)
        return Response(data)

    @action(detail=True, methods=["post"])
    def refresh_intelligence(self, request, pk=None):
        """
        POST /api/projects/<id>/refresh_intelligence/
        Re-scans all project documents, extracts signals, and updates executive intelligence cache.
        """
        project = self.get_object()
        for doc in project.docs.all():
            try:
                process_and_extract_document(doc)
            except Exception as e:
                print(f"[Error processing doc {doc.id}]: {e}")
        data = generate_project_intelligence(project, force_refresh=True)
        return Response(data)

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload_doc(self, request, pk=None):
        """
        POST /api/projects/<id>/upload_doc/
        Upload an Excel (XLSX), Word (DOCX), PDF, or Markdown file to the project.
        Parses text, classifies document context, extracts signals, and updates intelligence.
        Supports automatic deduplication (same file re-uploaded) and revision updates.
        """
        project = self.get_object()
        file_obj = request.FILES.get("file")
        title = request.data.get("title")
        content = request.data.get("content", "")
        template_type = request.data.get("template_type", ProjectDoc.TemplateType.CUSTOM)

        if not file_obj and not content:
            return Response({"error": "Either file or content is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not title:
            if file_obj:
                title = file_obj.name.rsplit(".", 1)[0].replace("_", " ").title()
            else:
                title = "Uploaded Project Document"

        # Step 1: Compute content hash
        doc_hash = calculate_file_hash(file_obj=file_obj, content=content)

        # Step 2: Check for exact duplicate upload in this project
        identical_doc = ProjectDoc.objects.filter(project=project, file_hash=doc_hash).first()
        if identical_doc:
            doc_data = ProjectDocSerializer(identical_doc, context={"request": request}).data
            intel = generate_project_intelligence(project)
            return Response({
                "doc": doc_data,
                "intelligence": intel,
                "is_duplicate": True,
                "message": f"Document '{identical_doc.title}' has already been uploaded and analyzed. Signals are preserved without duplication.",
            }, status=status.HTTP_200_OK)

        # Step 3: Check for revision update (same title or filename, but different content/hash)
        existing_doc = None
        if title:
            existing_doc = ProjectDoc.objects.filter(project=project, title__iexact=title.strip()).first()
        if not existing_doc and file_obj:
            existing_doc = ProjectDoc.objects.filter(project=project, file__endswith=file_obj.name).first()

        if existing_doc:
            # Document revision: update existing record, purge old signals atomically, and re-extract
            existing_doc.version += 1
            existing_doc.file_hash = doc_hash
            if file_obj:
                existing_doc.file = file_obj
            if content:
                existing_doc.content = content
            if template_type:
                existing_doc.template_type = template_type
            existing_doc.save()

            try:
                intel = process_and_extract_document(existing_doc)
            except Exception as e:
                print(f"[Extraction error on revision update]: {e}")
                intel = generate_project_intelligence(project)

            doc_data = ProjectDocSerializer(existing_doc, context={"request": request}).data
            return Response({
                "doc": doc_data,
                "intelligence": intel,
                "is_updated": True,
                "version": existing_doc.version,
                "message": f"Document '{existing_doc.title}' successfully updated to version {existing_doc.version}. Signals refreshed cleanly.",
            }, status=status.HTTP_200_OK)

        # Step 4: Brand new document
        doc = ProjectDoc.objects.create(
            project=project,
            title=title,
            content=content,
            file=file_obj,
            template_type=template_type,
            file_hash=doc_hash,
            version=1,
            created_by=request.user,
        )

        try:
            intel = process_and_extract_document(doc)
        except Exception as e:
            print(f"[Extraction error on upload]: {e}")
            intel = generate_project_intelligence(project)

        doc_data = ProjectDocSerializer(doc, context={"request": request}).data
        return Response({"doc": doc_data, "intelligence": intel}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def import_preview(self, request, pk=None):
        """
        GET /api/projects/<id>/import_preview/
        Generates reconciliation diff between document-extracted deliverables and tracker issues.
        Fuzzy-matches deliverable owners to registered project users and identifies new/updated/conflicting items.
        """
        project = self.get_object()
        summary = getattr(project, "intelligence_summary", None)
        ranked = []
        if summary and summary.normalized_state:
            ranked = summary.normalized_state.get("ranked_deliverables", [])

        if not ranked:
            signals = project.signals.filter(category="MILESTONE")
            for sig in signals:
                ranked.append({
                    "title": sig.title,
                    "status": sig.status,
                    "target_date": sig.target_date.strftime("%Y-%m-%d") if sig.target_date else None,
                    "workstream": sig.description or "General",
                    "owner": "",
                    "source_location": sig.source_location,
                })

        existing_issues = {
            i.title.strip().lower(): i for i in project.issues.all()
        }

        memberships = project.memberships.select_related("user").all()
        active_users = [m.user for m in memberships if not m.user.is_deactivated]
        all_active_users = list(User.objects.filter(is_active=True))

        available_members = [
            {"id": u.id, "username": u.username, "full_name": u.get_full_name() or u.username, "email": u.email}
            for u in active_users
        ]
        user_id_set = {m["id"] for m in available_members}
        for u in all_active_users:
            if u.id not in user_id_set:
                available_members.append({
                    "id": u.id, "username": u.username, "full_name": u.get_full_name() or u.username, "email": u.email
                })

        items = []
        new_count = 0
        updated_count = 0
        unchanged_count = 0
        conflict_count = 0

        for idx, deliv in enumerate(ranked):
            raw_title = deliv.get("title") or deliv.get("name") or f"Deliverable {idx+1}"
            title = str(raw_title).strip()
            norm_key = title.lower()

            raw_status = (deliv.get("execution_status") or deliv.get("status") or "TODO").upper()
            if raw_status in ["COMPLETED", "DONE", "RESOLVED"]:
                suggested_status = "DONE"
            elif raw_status in ["IN_PROGRESS", "ACTIVE", "WIP", "EXTENDED", "DELAYED"]:
                suggested_status = "IN_PROGRESS"
            else:
                suggested_status = "TODO"

            has_ext = deliv.get("has_extension", False)
            ext_days = deliv.get("extension_days", 0)
            if has_ext or ext_days > 0 or deliv.get("severity") == "CRITICAL":
                suggested_priority = "HIGH"
            else:
                suggested_priority = "MEDIUM"

            workstream = deliv.get("workstream") or deliv.get("phase") or ""

            due_date = deliv.get("actual_completion_date") or deliv.get("end_date") or deliv.get("baseline_end_date") or deliv.get("target_date")
            if due_date and isinstance(due_date, str) and len(due_date) > 10:
                due_date = due_date[:10]

            raw_owner = deliv.get("owner") or deliv.get("assignee") or ""
            matched_user = None
            if raw_owner:
                owner_clean = str(raw_owner).strip()
                for u in all_active_users:
                    if u.username.lower() == owner_clean.lower() or u.get_full_name().lower() == owner_clean.lower():
                        matched_user = u
                        break
                if not matched_user:
                    tokens = [t.strip().lower() for t in re.split(r"[,&/ ]+", owner_clean) if len(t.strip()) > 2]
                    for token in tokens:
                        for u in all_active_users:
                            if (token in u.username.lower() or 
                                (u.first_name and token in u.first_name.lower()) or 
                                (u.last_name and token in u.last_name.lower()) or
                                (u.email and token in u.email.lower())):
                                matched_user = u
                                break
                        if matched_user:
                            break

            existing_issue = existing_issues.get(norm_key)
            if not existing_issue:
                state = "NEW"
                new_count += 1
            else:
                status_diff = (existing_issue.status != suggested_status)
                due_diff = (existing_issue.due_date and str(existing_issue.due_date) != str(due_date)) if due_date else False
                if status_diff or due_diff:
                    state = "UPDATED"
                    updated_count += 1
                else:
                    state = "UNCHANGED"
                    unchanged_count += 1

            items.append({
                "temp_id": f"deliv-{idx+1}",
                "title": title,
                "workstream": workstream,
                "status": suggested_status,
                "priority": suggested_priority,
                "issue_type": "TASK",
                "due_date": due_date,
                "source_owner": raw_owner,
                "matched_user_id": matched_user.id if matched_user else None,
                "matched_username": matched_user.username if matched_user else None,
                "matched_name": matched_user.get_full_name() or matched_user.username if matched_user else None,
                "reconciliation_state": state,
                "existing_issue_id": existing_issue.id if existing_issue else None,
                "existing_status": existing_issue.status if existing_issue else None,
            })

        return Response({
            "project_id": project.id,
            "project_name": project.name,
            "total_deliverables": len(items),
            "new_count": new_count,
            "updated_count": updated_count,
            "unchanged_count": unchanged_count,
            "conflict_count": conflict_count,
            "items": items,
            "available_members": available_members,
        })

    @action(detail=True, methods=["post"])
    def confirm_import(self, request, pk=None):
        """
        POST /api/projects/<id>/confirm_import/
        Commits selected document deliverables into persistent Issue records in an atomic transaction.
        """
        project = self.get_object()
        role = effective_project_role(request.user, project)
        if role not in ["ADMIN", "MANAGER"] and not is_project_admin(request.user, project):
            raise PermissionDenied("Only project Admins and Managers can import deliverables into the tracker.")

        selected_items = request.data.get("selected_items", [])
        if not selected_items:
            return Response({"error": "No items selected for import."}, status=status.HTTP_400_BAD_REQUEST)

        created_count = 0
        updated_count = 0

        with transaction.atomic():
            for item in selected_items:
                title = item.get("title", "").strip()
                if not title:
                    continue
                workstream = item.get("workstream", "")
                status_val = item.get("status", "TODO")
                priority = item.get("priority", "MEDIUM")
                issue_type = item.get("issue_type", "TASK")
                assignee_id = item.get("assignee_id") or item.get("matched_user_id")
                due_date = item.get("due_date") or None
                existing_issue_id = item.get("existing_issue_id")

                assignee = None
                if assignee_id:
                    assignee = User.objects.filter(id=assignee_id, is_active=True).first()

                existing = None
                if existing_issue_id:
                    existing = Issue.objects.filter(id=existing_issue_id, project=project).first()
                if not existing:
                    existing = Issue.objects.filter(project=project, title__iexact=title).first()

                if existing:
                    old_status = existing.status
                    existing.workstream = workstream or existing.workstream
                    existing.status = status_val
                    existing.priority = priority
                    if due_date:
                        existing.due_date = due_date
                    if assignee:
                        existing.assignee = assignee
                    if status_val == "DONE":
                        existing.resolution = "Resolved"
                    existing.save()

                    if old_status != status_val:
                        ActivityLog.objects.create(
                            issue=existing,
                            actor=request.user,
                            field_changed="status",
                            old_value=old_status,
                            new_value=status_val,
                        )
                    updated_count += 1
                else:
                    resolution = "Resolved" if status_val == "DONE" else "Unresolved"
                    new_issue = Issue.objects.create(
                        project=project,
                        title=title,
                        workstream=workstream,
                        status=status_val,
                        priority=priority,
                        issue_type=issue_type,
                        assignee=assignee,
                        reporter=request.user,
                        due_date=due_date,
                        resolution=resolution,
                    )
                    ActivityLog.objects.create(
                        issue=new_issue,
                        actor=request.user,
                        field_changed="created",
                        old_value="",
                        new_value=f"Imported from project document by {request.user.username}",
                    )
                    created_count += 1

        try:
            summary = getattr(project, "intelligence_summary", None)
            cached_ranked = []
            if summary and summary.normalized_state:
                cached_ranked = summary.normalized_state.get("ranked_deliverables", [])

            if project.docs.exists():
                generate_project_intelligence(project, force_refresh=True)
            elif summary and cached_ranked:
                summary.normalized_state["ranked_deliverables"] = cached_ranked
                summary.save(update_fields=["normalized_state"])
        except Exception as e:
            print(f"[Intelligence re-sync error after import]: {e}")

        return Response({
            "success": True,
            "created": created_count,
            "updated": updated_count,
            "total_processed": created_count + updated_count,
            "message": f"Successfully synchronized {created_count + updated_count} items ({created_count} created, {updated_count} updated) into project tracker.",
        })

    @action(detail=True, methods=["get"])
    def export_xlsx(self, request, pk=None):
        """
        GET /api/projects/<id>/export_xlsx/
        Downloads canonical 5-sheet NEXO PMO Excel Workbook with formula injection protection.
        """
        project = self.get_object()
        issues_qs = project.issues.all().select_related("assignee", "reporter", "sprint")

        status_filter = request.query_params.get("status")
        priority_filter = request.query_params.get("priority")
        assignee_filter = request.query_params.get("assignee")
        workstream_filter = request.query_params.get("workstream")
        q_filter = request.query_params.get("q")

        if status_filter:
            issues_qs = issues_qs.filter(status__in=[s.strip() for s in status_filter.split(",") if s.strip()])
        if priority_filter:
            issues_qs = issues_qs.filter(priority__in=[p.strip() for p in priority_filter.split(",") if p.strip()])
        if assignee_filter:
            assignee_ids = [a.strip() for a in assignee_filter.split(",") if a.strip().isdigit()]
            cond = Q(assignee_id__in=assignee_ids)
            if "none" in assignee_filter:
                cond |= Q(assignee__isnull=True)
            issues_qs = issues_qs.filter(cond)
        if workstream_filter:
            issues_qs = issues_qs.filter(workstream__in=[w.strip() for w in workstream_filter.split(",") if w.strip()])
        if q_filter:
            issues_qs = issues_qs.filter(title__icontains=q_filter.strip())

        wb_buffer = generate_canonical_project_workbook(project, issues_qs=issues_qs, user=request.user)
        filename = f"{project.key}_Project_Tracker_{timezone.now().strftime('%Y%m%d')}.xlsx"

        response = HttpResponse(
            wb_buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["get"])
    def export_csv(self, request, pk=None):
        """
        GET /api/projects/<id>/export_csv/
        Downloads sanitized CSV of project issues with formula injection protection.
        """
        project = self.get_object()
        issues_qs = project.issues.all().select_related("assignee", "reporter", "sprint")

        status_filter = request.query_params.get("status")
        priority_filter = request.query_params.get("priority")
        assignee_filter = request.query_params.get("assignee")
        workstream_filter = request.query_params.get("workstream")
        q_filter = request.query_params.get("q")

        if status_filter:
            issues_qs = issues_qs.filter(status__in=[s.strip() for s in status_filter.split(",") if s.strip()])
        if priority_filter:
            issues_qs = issues_qs.filter(priority__in=[p.strip() for p in priority_filter.split(",") if p.strip()])
        if assignee_filter:
            assignee_ids = [a.strip() for a in assignee_filter.split(",") if a.strip().isdigit()]
            cond = Q(assignee_id__in=assignee_ids)
            if "none" in assignee_filter:
                cond |= Q(assignee__isnull=True)
            issues_qs = issues_qs.filter(cond)
        if workstream_filter:
            issues_qs = issues_qs.filter(workstream__in=[w.strip() for w in workstream_filter.split(",") if w.strip()])
        if q_filter:
            issues_qs = issues_qs.filter(title__icontains=q_filter.strip())

        csv_content = generate_canonical_project_csv(project, issues_qs=issues_qs)
        filename = f"{project.key}_work_items_{timezone.now().strftime('%Y%m%d')}.csv"

        response = HttpResponse(csv_content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"])
    def ai_assistant(self, request, pk=None):
        """
        POST /api/projects/<id>/ai_assistant/
        Project-aware AI assistant endpoint.
        Handles natural language queries about project health, issues, and risks.
        Detects write actions (create task, change status, assign) and returns structured proposals
        for explicit two-step user confirmation.
        """
        project = self.get_object()
        user_message = request.data.get("message", "").strip()
        if not user_message:
            return Response({"error": "Message is required."}, status=status.HTTP_400_BAD_REQUEST)

        from .assistant import handle_assistant_query
        result = handle_assistant_query(project, request.user, user_message)
        return Response(result)

    @action(detail=True, methods=["post"])
    def ai_execute(self, request, pk=None):
        """
        POST /api/projects/<id>/ai_execute/
        Applies a confirmed AI action proposal with strict RBAC validation.
        """
        project = self.get_object()
        proposal = request.data.get("proposal", {})
        action_type = proposal.get("action")
        fields = proposal.get("fields", {})

        role = effective_project_role(request.user, project)
        if role == "VIEWER":
            raise PermissionDenied("Viewers cannot execute project modifications.")

        from .assistant import parse_date_str, resolve_user_by_name

        if action_type == "CREATE_ISSUE":
            if role == "MEMBER":
                raise PermissionDenied("Members cannot create new issues. Only Admins and Managers can.")
            title = fields.get("title", "").strip()
            if not title:
                return Response({"error": "Task title is required."}, status=status.HTTP_400_BAD_REQUEST)

            # Idempotency / Duplicate creation check (within 60s)
            cutoff_time = timezone.now() - datetime.timedelta(seconds=60)
            existing_issue = Issue.objects.filter(
                project=project,
                title__iexact=title,
                reporter=request.user,
                created_at__gte=cutoff_time,
            ).first()

            if existing_issue:
                assignee_name = existing_issue.assignee.username if existing_issue.assignee else "Unassigned"
                due_date_str = str(existing_issue.due_date) if existing_issue.due_date else "None"
                return Response({
                    "success": True,
                    "message": f"Task [{project.key}-{existing_issue.id}] '{existing_issue.title}' was already created recently. (Assignee: {assignee_name}, Due: {due_date_str}, Priority: {existing_issue.priority})",
                    "issue_id": existing_issue.id,
                    "issue_key": f"{project.key}-{existing_issue.id}",
                    "duplicate_prevented": True,
                    "fields": {
                        "title": existing_issue.title,
                        "assignee": assignee_name,
                        "due_date": due_date_str,
                        "priority": existing_issue.priority,
                        "status": existing_issue.status,
                        "workstream": existing_issue.workstream,
                    },
                })

            assignee = None
            if fields.get("assignee_id"):
                assignee = User.objects.filter(id=fields.get("assignee_id")).first()
            elif fields.get("assignee"):
                assignee = resolve_user_by_name(project, fields.get("assignee"))

            due_date = parse_date_str(fields.get("due_date")) if fields.get("due_date") else None

            issue = Issue.objects.create(
                project=project,
                title=title,
                description=fields.get("description", ""),
                status=fields.get("status", "TODO"),
                priority=fields.get("priority", "MEDIUM"),
                issue_type=fields.get("issue_type", "TASK"),
                workstream=fields.get("workstream", ""),
                assignee=assignee,
                due_date=due_date,
                reporter=request.user,
                resolution="Resolved" if fields.get("status") == "DONE" else "Unresolved",
            )
            ActivityLog.objects.create(
                issue=issue,
                actor=request.user,
                field_changed="created",
                old_value="",
                new_value=f"Created via NEXO AI Assistant by {request.user.username}",
            )
            assignee_name = issue.assignee.username if issue.assignee else "Unassigned"
            due_date_str = str(issue.due_date) if issue.due_date else "None"
            return Response({
                "success": True,
                "message": f"Successfully created task [{project.key}-{issue.id}] '{issue.title}' (Assignee: {assignee_name}, Due: {due_date_str}, Priority: {issue.priority})",
                "issue_id": issue.id,
                "issue_key": f"{project.key}-{issue.id}",
                "fields": {
                    "title": issue.title,
                    "assignee": assignee_name,
                    "due_date": due_date_str,
                    "priority": issue.priority,
                    "status": issue.status,
                    "workstream": issue.workstream,
                },
            })

        elif action_type == "UPDATE_ISSUE":
            target_id = proposal.get("target_issue_id")
            issue = Issue.objects.filter(id=target_id, project=project).first()
            if not issue:
                return Response({"error": "Target issue not found."}, status=status.HTTP_404_NOT_FOUND)

            if role == "MEMBER" and any(k not in ["status", "resolution"] for k in fields.keys()):
                raise PermissionDenied("Members can only change issue status and resolution.")

            for k, v in fields.items():
                if k in ["id", "project", "created_at"]:
                    continue
                if k == "assignee_id":
                    new_u = User.objects.filter(id=v).first()
                    old_name = issue.assignee.username if issue.assignee else "Unassigned"
                    issue.assignee = new_u
                    new_name = new_u.username if new_u else "Unassigned"
                    ActivityLog.objects.create(
                        issue=issue, actor=request.user, field_changed="assignee", old_value=old_name, new_value=new_name
                    )
                elif k == "due_date":
                    issue.due_date = parse_date_str(v) if v else None
                    ActivityLog.objects.create(
                        issue=issue, actor=request.user, field_changed="due_date", old_value="", new_value=str(issue.due_date)
                    )
                elif hasattr(issue, k):
                    old_v = getattr(issue, k)
                    setattr(issue, k, v)
                    if k == "status":
                        issue.resolution = "Resolved" if v == "DONE" else "Unresolved"
                    ActivityLog.objects.create(
                        issue=issue,
                        actor=request.user,
                        field_changed=k,
                        old_value=str(old_v or ""),
                        new_value=str(v or ""),
                    )
            issue.save()
            return Response({
                "success": True,
                "message": f"Successfully updated task [{project.key}-{issue.id}]",
                "issue_id": issue.id,
                "issue_key": f"{project.key}-{issue.id}",
            })

        return Response({"error": f"Unknown action type '{action_type}'"}, status=status.HTTP_400_BAD_REQUEST)


class ProjectDocViewSet(viewsets.ModelViewSet):
    """CRUD API for project documentation pages with auto-extraction."""
    serializer_class = ProjectDocSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        project_id = self.request.query_params.get("project")
        qs = ProjectDoc.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        if not is_project_admin(self.request.user, serializer.validated_data["project"]):
            raise PermissionDenied("You cannot create documents in this project.")
        file_obj = self.request.FILES.get("file")
        content = serializer.validated_data.get("content", "")
        doc_hash = calculate_file_hash(file_obj=file_obj, content=content)
        doc = serializer.save(created_by=self.request.user, file_hash=doc_hash, version=1)
        try:
            process_and_extract_document(doc)
        except Exception as e:
            print(f"[Doc extraction error on create]: {e}")

    def perform_update(self, serializer):
        file_obj = self.request.FILES.get("file")
        content = serializer.validated_data.get("content", serializer.instance.content)
        doc_hash = calculate_file_hash(file_obj=file_obj, content=content)
        doc = serializer.save(file_hash=doc_hash, version=serializer.instance.version + 1)
        try:
            process_and_extract_document(doc)
        except Exception as e:
            print(f"[Doc extraction error on update]: {e}")

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("You cannot delete documents in this project.")
        project = instance.project
        # Atomically clean up all signals extracted from this document
        instance.signals.all().delete()
        if instance.file:
            try:
                instance.file.delete(save=False)
            except Exception:
                pass
        instance.delete()
        try:
            generate_project_intelligence(project)
        except Exception as e:
            print(f"[Intelligence refresh after doc deletion error]: {e}")


    @action(detail=True, methods=["get"])
    def signals(self, request, pk=None):
        """Returns all structured signals extracted from this specific document."""
        doc = self.get_object()
        signals = doc.signals.all().order_by("-confidence", "-id")
        return Response(ProjectSignalSerializer(signals, many=True).data)

    @action(detail=True, methods=["post"])
    def reextract(self, request, pk=None):
        """Forces re-parsing and signal extraction on this document."""
        doc = self.get_object()
        try:
            intel = process_and_extract_document(doc)
            return Response({
                "message": "Signals extracted successfully",
                "doc": ProjectDocSerializer(doc, context={"request": request}).data,
                "intelligence": intel,
            })
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def manifest(self, request, pk=None):
        """Returns the parsed audit manifest for this specific document."""
        doc = self.get_object()
        manifest_data = None
        if doc.file:
            try:
                from .intelligence.parsers import parse_uploaded_file
                parsed = parse_uploaded_file(doc.file, doc.file.name)
                manifest_data = parsed.metadata.get("audit_manifest")
            except Exception as e:
                manifest_data = {"error": str(e)}
        if not manifest_data:
            manifest_data = {
                "document_type": doc.template_type or "DOCUMENT",
                "filename": doc.file.name if doc.file else doc.title,
                "title": doc.title,
                "signals_count": doc.signals.count(),
                "status": "PROCESSED",
            }
        manifest_data["doc_id"] = doc.id
        manifest_data["doc_title"] = doc.title
        return Response(manifest_data)


class ProjectSignalViewSet(viewsets.ModelViewSet):
    """
    CRUD for extracted project signals (risks, blockers, decisions, milestones, updates).
    """
    serializer_class = ProjectSignalSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = ProjectSignal.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        project_id = self.request.query_params.get("project")
        doc_id = self.request.query_params.get("source_doc") or self.request.query_params.get("doc")
        category = self.request.query_params.get("category")
        status_val = self.request.query_params.get("status")
        if project_id:
            qs = qs.filter(project_id=project_id)
        if doc_id:
            qs = qs.filter(source_doc_id=doc_id)
        if category:
            qs = qs.filter(category=category)
        if status_val:
            qs = qs.filter(status=status_val)
        return qs



class AutomationRuleViewSet(viewsets.ModelViewSet):
    """CRUD API for project automation rules."""
    serializer_class = AutomationRuleSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        project_id = self.request.query_params.get("project")
        qs = AutomationRule.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        if not is_project_admin(self.request.user, serializer.validated_data["project"]):
            raise PermissionDenied("Only project admins can create automation rules.")
        serializer.save()


class SprintViewSet(viewsets.ModelViewSet):
    """
    CRUD + start/complete actions for sprints.
    GET    /api/sprints/?project=<id>  — list sprints for a project
    POST   /api/sprints/               — create a planned sprint
    PATCH  /api/sprints/<id>/          — edit name/goal/dates
    POST   /api/sprints/<id>/start/    — activate sprint (only one active per project)
    POST   /api/sprints/<id>/complete/ — complete sprint, optionally move unfinished issues to backlog
    DELETE /api/sprints/<id>/          — delete a PLANNED sprint
    """
    serializer_class = SprintSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        qs = Sprint.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can create sprints.")
        serializer.save()

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance.project):
            raise PermissionDenied("Only project admins can edit sprints.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can delete sprints.")
        if instance.status != Sprint.Status.PLANNED:
            raise ValidationError("Only planned sprints can be deleted.")
        # Move issues back to backlog
        instance.issues.all().update(sprint=None)
        instance.delete()

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """Activate this sprint. Fails if another sprint is already active in the project."""
        sprint = self.get_object()
        if not is_project_admin(request.user, sprint.project):
            raise PermissionDenied("Only project admins can start sprints.")
        if sprint.status != Sprint.Status.PLANNED:
            return Response(
                {"detail": f"Only PLANNED sprints can be started. This sprint is {sprint.status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        already_active = Sprint.objects.filter(
            project=sprint.project, status=Sprint.Status.ACTIVE
        ).exclude(pk=sprint.pk).exists()
        if already_active:
            return Response(
                {"detail": "Another sprint is already active in this project. Complete it before starting a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sprint.status = Sprint.Status.ACTIVE
        if not sprint.start_date:
            sprint.start_date = timezone.now().date()
        sprint.save()
        return Response(SprintSerializer(sprint).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """
        Complete this sprint.
        Unfinished issues (not DONE) are moved back to backlog (sprint=None)
        unless move_to_sprint_id is provided to re-assign them to another sprint.
        """
        sprint = self.get_object()
        if not is_project_admin(request.user, sprint.project):
            raise PermissionDenied("Only project admins can complete sprints.")
        if sprint.status != Sprint.Status.ACTIVE:
            return Response(
                {"detail": "Only ACTIVE sprints can be completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        move_to_sprint_id = request.data.get("move_to_sprint_id")
        unfinished = sprint.issues.exclude(status="DONE")

        if move_to_sprint_id:
            target = Sprint.objects.filter(
                pk=move_to_sprint_id, project=sprint.project
            ).first()
            if not target:
                return Response(
                    {"detail": "Target sprint not found in this project."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            unfinished.update(sprint=target)
        else:
            unfinished.update(sprint=None)

        sprint.status = Sprint.Status.COMPLETED
        sprint.completed_at = timezone.now()
        if not sprint.end_date:
            sprint.end_date = timezone.now().date()
        sprint.save()

        return Response({
            **SprintSerializer(sprint).data,
            "moved_to_backlog": unfinished.count() if not move_to_sprint_id else 0,
        })


class WorkflowStateViewSet(viewsets.ModelViewSet):
    """
    CRUD for per-project workflow states (custom Kanban columns).
    GET  /api/workflow-states/?project=<id>  — list states for a project
    POST /api/workflow-states/               — create a new state
    PATCH/PUT /api/workflow-states/<id>/     — rename, recolor, reorder
    DELETE /api/workflow-states/<id>/        — delete (blocked if issues use it)
    POST /api/workflow-states/seed/?project=<id> — reset to default 3-column workflow
    """
    serializer_class = WorkflowStateSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        qs = WorkflowState.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        # Auto-assign next position
        max_pos = WorkflowState.objects.filter(project=project).count()
        serializer.save(position=max_pos)

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        # Block deletion if any issues still reference this status name
        from issues.models import Issue
        count = Issue.objects.filter(project=instance.project, status=instance.name).count()
        if count > 0:
            raise ValidationError(
                f"Cannot delete '{instance.name}' — {count} issue(s) are currently in this status. "
                "Move them to another status first."
            )
        instance.delete()

    @action(detail=False, methods=["post"])
    def seed(self, request):
        """Reset a project's workflow to the default 3-column layout."""
        project_id = request.query_params.get("project") or request.data.get("project")
        if not project_id:
            return Response({"detail": "project is required."}, status=status.HTTP_400_BAD_REQUEST)
        project = Project.objects.filter(
            visible_projects_q(request.user), id=project_id
        ).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can reset the workflow.")
        states = create_default_workflow(project)
        return Response(WorkflowStateSerializer(states, many=True).data)


class WorkflowTransitionViewSet(viewsets.ModelViewSet):
    """
    Allowed moves between workflow states for a project.
    GET  /api/workflow-transitions/?project=<id>
    POST /api/workflow-transitions/  {project, from_state, to_state}
    DELETE /api/workflow-transitions/<id>/
    """
    serializer_class = WorkflowTransitionSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = WorkflowTransition.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        instance.delete()


class SavedFilterViewSet(viewsets.ModelViewSet):
    """
    GET    /api/saved-filters/?project=<id>  — list saved filters for a project (owner only)
    POST   /api/saved-filters/               — create a saved filter
    DELETE /api/saved-filters/<id>/          — delete a saved filter
    """
    serializer_class = SavedFilterSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = SavedFilter.objects.filter(owner=self.request.user)
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not has_project_access(self.request.user, project):
            raise PermissionDenied("You are not a member of this project.")
        serializer.save(owner=self.request.user)


class CalendarEntryViewSet(viewsets.ModelViewSet):
    """
    Things added to a project's calendar by clicking a day (reminder / task / event / meeting).
    GET  /api/calendar-entries/?project=<id>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
    POST /api/calendar-entries/  {project, kind, title, description, date, time?, participant_ids?}

    Open to every account type that can see the project, except read-only Viewers.
    Creating or editing tells the people involved right away; the date arriving tells everyone again
    (see projects/reminders.py).
    """
    serializer_class = CalendarEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            CalendarEntry.objects.filter(visible_projects_q(self.request.user, "project__"))
            .distinct()
            .select_related("project", "created_by")
            .prefetch_related("participants")
        )
        params = self.request.query_params
        if params.get("project"):
            qs = qs.filter(project_id=params["project"])
        if params.get("from"):
            qs = qs.filter(date__gte=params["from"])
        if params.get("to"):
            qs = qs.filter(date__lte=params["to"])
        return qs

    # -- helpers ---------------------------------------------------------
    def _require_writer(self, project):
        if effective_project_role(self.request.user, project) in (None, "VIEWER"):
            raise PermissionDenied("You can view this calendar but not add to it.")

    def _require_owner_or_admin(self, entry):
        if entry.created_by_id != self.request.user.id and not is_project_admin(self.request.user, entry.project):
            raise PermissionDenied("Only the person who added this (or a project admin) can change it.")

    @staticmethod
    def _check_date(value):
        if value < local_today():
            raise ValidationError({"date": ["Pick today or a future date."]})

    def _people(self, entry, explicit_ids):
        """Assignees picked in the form + anyone @mentioned in the title / notes (never the creator)."""
        User = get_user_model()
        people = {}
        for user in User.objects.filter(pk__in=explicit_ids, is_active=True):
            if not has_project_access(user, entry.project):
                raise ValidationError({"participant_ids": [f"{user.username} is not a member of this project."]})
            people[user.pk] = user
        for user in mentioned_users(f"{entry.title}\n{entry.description}", entry.project):
            people[user.pk] = user
        people.pop(entry.created_by_id, None)
        return list(people.values())

    # -- writes ----------------------------------------------------------
    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        self._require_writer(project)
        self._check_date(serializer.validated_data["date"])
        ids = serializer.validated_data.pop("participant_ids", [])
        entry = serializer.save(created_by=self.request.user)
        people = self._people(entry, ids)
        entry.participants.set(people)
        notify_added(entry, self.request.user, people)  # "the day of assigned"

    def perform_update(self, serializer):
        entry = serializer.instance
        self._require_owner_or_admin(entry)
        data = serializer.validated_data
        if "date" in data and data["date"] != entry.date:
            self._check_date(data["date"])
        before = set(entry.participants.values_list("pk", flat=True))
        ids = data.pop("participant_ids", None)
        explicit = list(before) if ids is None else ids
        rescheduled = ("date" in data and data["date"] != entry.date) or ("time" in data and data["time"] != entry.time)
        entry = serializer.save(**({"due_notified_at": None} if rescheduled else {}))
        people = self._people(entry, explicit)
        entry.participants.set(people)
        notify_added(entry, self.request.user, [u for u in people if u.pk not in before])

    def perform_destroy(self, instance):
        self._require_owner_or_admin(instance)
        instance.delete()


@api_view(["GET", "POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def cron_reminders(request):
    """
    Hit this on a schedule (every minute or so) where there is no long-running server, e.g. Vercel Cron.
    Send the secret as `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
    """
    secret = getattr(settings, "CRON_SECRET", "")
    supplied = request.query_params.get("secret") or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not secret or not hmac.compare_digest(supplied.encode(), secret.encode()):
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    return Response({"sent": process_due()})
