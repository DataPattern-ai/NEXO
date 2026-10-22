import re

from django.db.models import Q
from rest_framework import permissions, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser

from projects.permissions import IsProjectMemberOrAbove
from users.access import (
    MEMBER_EDITABLE_ISSUE_FIELDS,
    LimitedMemberReadOnly,
    has_project_access,
    is_org_admin,
    is_project_admin,
    org_role,
    visible_projects_q,
)
from users.models import Notification
from users.utils import send_assignment_email, send_notification_email

from .models import ActivityLog, Comment, Issue, IssueAttachment, Label
from .serializers import (
    ActivityLogSerializer,
    AttachmentSerializer,
    CommentSerializer,
    IssueListSerializer,
    IssueSerializer,
    LabelSerializer,
)

TRACKED_FIELDS = ["status", "priority", "assignee_id"]


def _notify_assignee(issue, assigned_by_user):
    """
    Notifies the assignee when an issue is assigned to them.
    Rules:
    - Never notify if the assignee is the same person doing the assigning (self-assign)
    - Sends one email with full issue card + why-footer (assignee reason)
    """
    assignee = issue.assignee
    if not assignee:
        return
    # Rule 1: Never notify about your own action
    if assignee == assigned_by_user:
        return

    issue_key = f"{issue.project.key}-{issue.pk}"

    # In-app notification
    Notification.objects.create(
        recipient=assignee,
        actor=assigned_by_user,
        action=f"assigned you to issue {issue_key}",
        target=issue.title,
    )

    # Email — uses shared template with full issue card
    if assignee.email:
        send_notification_email(
            recipient_email=assignee.email,
            recipient_username=assignee.username,
            actor=assigned_by_user.username,
            action="assigned you to",
            issue_key=issue_key,
            issue_title=issue.title,
            project_name=issue.project.name,
            project_id=issue.project.id,
            issue_id=issue.pk,
            why_reason="assignee",
            issue_type=issue.issue_type,
            issue_priority=issue.priority,
            issue_status=issue.status,
            issue_reporter=issue.reporter.username if issue.reporter else None,
            issue_assignee=assignee.username,
        )


MENTION_RE = re.compile(r"@([\w]+)")


def _mentioned_users(text, project, actor, exclude_names=()):
    """Active project members @mentioned in `text` (never the actor, never someone already mentioned before)."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    found = []
    for name in sorted(set(MENTION_RE.findall(text or ""))):
        if name.lower() in exclude_names:
            continue
        user = User.objects.filter(username__iexact=name, is_active=True).first()
        if user and user != actor and has_project_access(user, project):
            found.append(user)
    return found


def _notify_issue_mentions(issue, actor, texts, exclude_names=(), skip_users=()):
    """
    @mentions in an issue's summary/description -> in-app notification + email for each mentioned person.
    `skip_users` are people already told about this issue another way (e.g. just assigned) so nobody is mailed twice.
    """
    issue_key = f"{issue.project.key}-{issue.pk}"
    notified = set(skip_users)
    for text in texts:
        for user in _mentioned_users(text, issue.project, actor, exclude_names):
            if user in notified:
                continue
            notified.add(user)
            Notification.objects.create(
                recipient=user,
                actor=actor,
                action=f"mentioned you in {issue_key}",
                target=issue.title,
            )
            if user.email:
                send_notification_email(
                    recipient_email=user.email,
                    recipient_username=user.username,
                    actor=actor.username,
                    action="mentioned you in",
                    issue_key=issue_key,
                    issue_title=issue.title,
                    project_name=issue.project.name,
                    project_id=issue.project.id,
                    issue_id=issue.pk,
                    why_reason="mention",
                    comment_body=text,
                    body_label=f"Mentioned by {actor.username}",
                    issue_type=issue.issue_type,
                    issue_priority=issue.priority,
                    issue_status=issue.status,
                    issue_reporter=issue.reporter.username if issue.reporter else None,
                    issue_assignee=issue.assignee.username if issue.assignee else None,
                )


class IssueViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly, IsProjectMemberOrAbove]
    # Members may PATCH an issue, but only its status / resolution (see perform_update).
    limited_member_write = True

    def perform_destroy(self, instance):
        """Only org Admins delete tasks. Managers create and edit; Members change status/resolution only."""
        if not is_org_admin(self.request.user):
            raise PermissionDenied("Only Admins can delete tasks.")
        instance.delete()

    def get_queryset(self):
        # Visibility: only issues in projects the user can see (admins: all of them).
        # Optional filters, combinable. Most take a comma-separated list (?status=TODO,IN_PROGRESS):
        #   status, priority, project, assignee (ids, or "none" for unassigned), reporter (ids),
        #   q (text in the title), label
        qs = (
            Issue.objects.filter(visible_projects_q(self.request.user, "project__"))
            .select_related("project", "reporter", "assignee")
            .distinct()
        )
        params = self.request.query_params

        def values(name):
            return [v.strip() for v in params.get(name, "").split(",") if v.strip()]

        def ids(name):
            return [v for v in values(name) if v.isdigit()]

        if values("project"):
            qs = qs.filter(project_id__in=ids("project"))
        if values("status"):
            qs = qs.filter(status__in=values("status"))
        if values("priority"):
            qs = qs.filter(priority__in=values("priority"))
        if values("assignee"):
            cond = Q(assignee_id__in=ids("assignee"))
            if "none" in values("assignee"):
                cond |= Q(assignee__isnull=True)
            qs = qs.filter(cond)
        if values("reporter"):
            qs = qs.filter(reporter_id__in=ids("reporter"))
        if params.get("q", "").strip():
            qs = qs.filter(title__icontains=params["q"].strip())
        if params.get("label"):
            qs = qs.filter(labels__id=params["label"])
        if values("workstream"):
            qs = qs.filter(workstream__in=values("workstream"))
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return IssueListSerializer
        return IssueSerializer

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not has_project_access(self.request.user, project):
            raise PermissionDenied("You are not a member of this project.")
        if org_role(self.request.user) == "MEMBER":
            raise PermissionDenied("Members cannot create issues.")

        # Only admins/managers can assign to others when creating — others can self-assign
        if "assignee_id" in self.request.data and self.request.data["assignee_id"]:
            is_admin = is_project_admin(self.request.user, project)
            is_self = str(self.request.data["assignee_id"]) == str(self.request.user.id)
            if not is_admin and not is_self:
                raise PermissionDenied("Members can only assign issues to themselves.")

        # Reporter defaults to whoever is creating the issue; a different one must belong to the project.
        reporter = serializer.validated_data.pop("reporter", None) or self.request.user
        if not has_project_access(reporter, project) or not reporter.is_active:
            raise ValidationError({"reporter_id": ["The reporter must be an active member of this project."]})

        instance = serializer.save(reporter=reporter)
        try:
            if instance.assignee:
                _notify_assignee(instance, self.request.user)
        except Exception as e:
            print(f"[Assignment notification error]: {e}")
        try:
            _notify_issue_mentions(
                instance, self.request.user, [instance.title, instance.description],
                skip_users={instance.assignee} if instance.assignee else (),
            )
        except Exception as e:
            print(f"[Mention notification error]: {e}")

    def perform_update(self, serializer):
        if org_role(self.request.user) == "MEMBER":
            blocked = set(self.request.data.keys()) - MEMBER_EDITABLE_ISSUE_FIELDS
            if blocked:
                raise PermissionDenied(
                    "Members can only change an issue's status and resolution."
                )
        old_instance = self.get_object()
        serializer.validated_data.pop("reporter", None)  # reporter is only chosen when the issue is created
        old_status = old_instance.status
        old_title, old_description = old_instance.title, old_instance.description
        old_priority = old_instance.priority
        old_assignee_id = old_instance.assignee_id

        # Block non-admins from changing assignee — but allow Members to self-assign
        if "assignee_id" in self.request.data:
            new_assignee_id = serializer.validated_data.get("assignee_id")
            if new_assignee_id != old_assignee_id:
                project = old_instance.project
                is_admin = is_project_admin(self.request.user, project)
                is_self_assign = (new_assignee_id == self.request.user.id) or (new_assignee_id is None and old_assignee_id == self.request.user.id)
                if not is_admin and not is_self_assign:
                    raise PermissionDenied("Members can only assign issues to themselves. Only Admins can assign to others.")

        instance = serializer.save()

        # @mentions that are new in the summary / description
        try:
            already = {n.lower() for n in MENTION_RE.findall(f"{old_title}\n{old_description}")}
            changed = [x for x, old in ((instance.title, old_title), (instance.description, old_description)) if x != old]
            _notify_issue_mentions(
                instance, self.request.user, changed, exclude_names=already,
                skip_users={instance.assignee} if instance.assignee and old_assignee_id != instance.assignee_id else (),
            )
        except Exception as e:
            print(f"[Mention notification error]: {e}")

        # Write activity log entries for fields that actually changed
        if old_status != instance.status:
            ActivityLog.objects.create(
                issue=instance, actor=self.request.user, field_changed="status",
                old_value=old_status, new_value=instance.status,
            )
        if old_priority != instance.priority:
            ActivityLog.objects.create(
                issue=instance, actor=self.request.user, field_changed="priority",
                old_value=old_priority, new_value=instance.priority,
            )
        if old_assignee_id != instance.assignee_id:
            ActivityLog.objects.create(
                issue=instance, actor=self.request.user, field_changed="assignee",
                old_value=str(old_assignee_id or ""),
                new_value=str(instance.assignee_id or ""),
            )
            # Notify the new assignee (in-app + email)
            try:
                if instance.assignee:
                    _notify_assignee(instance, self.request.user)
            except Exception as e:
                print(f"[Assignment notification error]: {e}")


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly, IsProjectMemberOrAbove]

    def get_queryset(self):
        return Comment.objects.filter(visible_projects_q(self.request.user, "issue__project__")).distinct()

    def perform_create(self, serializer):
        issue = serializer.validated_data["issue"]
        if not has_project_access(self.request.user, issue.project):
            raise PermissionDenied("You are not a member of this project.")
        comment = serializer.save(author=self.request.user)
        try:
            _notify_on_comment(comment, self.request.user)
        except Exception as e:
            print(f"[Comment notification error]: {e}")

    def perform_update(self, serializer):
        """Only the comment author can edit their own comment."""
        instance = self.get_object()
        if instance.author != self.request.user:
            raise PermissionDenied("You can only edit your own comments.")
        serializer.save()

    def perform_destroy(self, instance):
        """Only the comment author or a project Admin can delete a comment."""
        user = self.request.user
        is_author = instance.author == user
        is_admin = is_project_admin(user, instance.issue.project)
        if not is_author and not is_admin:
            raise PermissionDenied("You can only delete your own comments.")
        instance.delete()


def _notify_on_comment(comment, commenter):
    """
    Dual notification on every new comment — matching real Jira's behaviour.

    Rules:
    1. Never notify the commenter about their own comment
    2. Assignee + reporter are default recipients on every comment
    3. @mentions add extra recipients from project members
    4. DEDUP — if someone qualifies under multiple reasons, send ONE email
       with the most relevant reason (mention > assignee > reporter)
    5. Shared send_notification_email() template with comment block + why-footer
    """
    import re as _re
    from django.contrib.auth import get_user_model
    from users.models import Notification
    from users.utils import send_notification_email

    User = get_user_model()
    issue = comment.issue
    issue_key = f"{issue.project.key}-{issue.pk}"

    # Common issue card data passed to every email
    issue_card = dict(
        issue_key=issue_key,
        issue_title=issue.title,
        project_name=issue.project.name,
        project_id=issue.project.id,
        issue_id=issue.pk,
        comment_body=comment.body,
        issue_type=issue.issue_type,
        issue_priority=issue.priority,
        issue_status=issue.status,
        issue_reporter=issue.reporter.username if issue.reporter else None,
        issue_assignee=issue.assignee.username if issue.assignee else None,
    )

    # ── Step 1: Parse @mentions ──
    mentioned_usernames = set(_re.findall(r"@([\w]+)", comment.body))
    mention_set = set()
    for username in mentioned_usernames:
        user = User.objects.filter(username__iexact=username).first()
        if not user or user == commenter:
            continue
        if not has_project_access(user, issue.project):
            continue
        mention_set.add(user)

    # ── Step 2: Build recipient map {user → highest_reason} ──
    # Priority order: mention > assignee > reporter
    recipient_reasons = {}

    # Reporter (lowest priority)
    if issue.reporter and issue.reporter != commenter:
        recipient_reasons[issue.reporter] = "reporter"

    # Assignee (overrides reporter)
    if issue.assignee and issue.assignee != commenter:
        recipient_reasons[issue.assignee] = "assignee"

    # Mention (highest priority — overrides both)
    for user in mention_set:
        recipient_reasons[user] = "mention"

    # ── Step 3: Send one notification per recipient (deduplicated) ──
    for recipient, reason in recipient_reasons.items():

        # In-app notification
        action_text = {
            "assignee": f"commented on issue {issue_key}",
            "reporter":  f"commented on issue {issue_key}",
            "mention":   f"mentioned you in a comment on {issue_key}",
        }[reason]

        Notification.objects.create(
            recipient=recipient,
            actor=commenter,
            action=action_text,
            target=issue.title,
        )

        # Email — one email per recipient, correct why-footer
        if recipient.email:
            action_label = {
                "assignee": "commented on",
                "reporter":  "commented on",
                "mention":   "mentioned you in a comment on",
            }[reason]

            send_notification_email(
                recipient_email=recipient.email,
                recipient_username=recipient.username,
                actor=commenter.username,
                action=action_label,
                why_reason=reason,
                **issue_card,
            )



class LabelViewSet(viewsets.ModelViewSet):
    queryset = Label.objects.all()
    serializer_class = LabelSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]


class AttachmentViewSet(viewsets.ModelViewSet):
    serializer_class = AttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = IssueAttachment.objects.filter(
            visible_projects_q(self.request.user, "issue__project__")
        ).distinct()
        issue_id = self.request.query_params.get("issue")
        if issue_id:
            qs = qs.filter(issue_id=issue_id)
        return qs

    def perform_create(self, serializer):
        issue = serializer.validated_data["issue"]
        if not has_project_access(self.request.user, issue.project):
            raise PermissionDenied("You are not a member of this project.")
        serializer.save(uploaded_by=self.request.user)

    def perform_destroy(self, instance):
        # Only uploader or reporter can delete
        if instance.uploaded_by != self.request.user and instance.issue.reporter != self.request.user:
            raise PermissionDenied("You can only delete your own attachments.")
        instance.file.delete(save=False)  # remove file from disk
        instance.delete()
