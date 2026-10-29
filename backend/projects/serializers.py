from rest_framework import serializers

from users.serializers import UserSerializer

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
)


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = ProjectMembership
        fields = ["id", "user", "user_id", "role", "joined_at"]


class ProjectDocSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    signals_count = serializers.SerializerMethodField()
    audit_manifest = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDoc
        fields = [
            "id", "project", "title", "content", "template_type",
            "file", "file_type", "file_size", "file_hash", "version", "file_url", "signals_count",
            "audit_manifest", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["created_by", "file_size", "file_type", "file_hash", "version"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not obj.file:
            return None

        try:
            if hasattr(obj.file, "url") and (obj.file.url.startswith("http://") or obj.file.url.startswith("https://")):
                return obj.file.url
        except Exception:
            pass

        from django.urls import reverse
        try:
            download_path = reverse("doc-download", kwargs={"pk": obj.pk})
            if request:
                return request.build_absolute_uri(download_path)
            return download_path
        except Exception:
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url

    def get_signals_count(self, obj):
        return obj.signals.count()

    def get_audit_manifest(self, obj):
        file_obj = obj.file if obj.file else obj.content
        filename = obj.file.name if obj.file else f"{obj.title}.md"
        if file_obj:
            try:
                from .intelligence.parsers import parse_uploaded_file
                from .intelligence.ai_provider import ai_classify_document
                parsed = parse_uploaded_file(file_obj, filename)
                manifest = parsed.metadata.get("audit_manifest") or {}
                if "ai_understanding" not in manifest:
                    ai_c = ai_classify_document(obj.title, parsed.raw_text[:2500], parsed.file_type)
                    manifest["ai_understanding"] = {
                        "purpose": ai_c.get("purpose"),
                        "reasoning": ai_c.get("reasoning"),
                        "confidence": ai_c.get("confidence"),
                        "telemetry": ai_c.get("ai_telemetry"),
                    }
                return manifest
            except Exception:
                pass
        return None


class AutomationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = [
            "id", "project", "name", "trigger", "action",
            "enabled", "execution_count", "created_at"
        ]


class WorkflowStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowState
        fields = ["id", "project", "name", "color", "category", "position", "is_default"]


class WorkflowTransitionSerializer(serializers.ModelSerializer):
    from_state_name = serializers.ReadOnlyField(source="from_state.name")
    to_state_name = serializers.ReadOnlyField(source="to_state.name")

    class Meta:
        model = WorkflowTransition
        fields = ["id", "project", "from_state", "from_state_name", "to_state", "to_state_name"]


class SprintSerializer(serializers.ModelSerializer):
    issues_count = serializers.SerializerMethodField()
    completed_count = serializers.SerializerMethodField()

    class Meta:
        model = Sprint
        fields = [
            "id", "project", "name", "goal", "status",
            "start_date", "end_date", "created_at", "completed_at",
            "issues_count", "completed_count",
        ]
        read_only_fields = ["status", "created_at", "completed_at"]

    def get_issues_count(self, obj):
        return obj.issues.count()

    def get_completed_count(self, obj):
        return obj.issues.filter(status="DONE").count()


class ProjectSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    members = ProjectMembershipSerializer(source="memberships", many=True, read_only=True)
    docs_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    workflow_states = WorkflowStateSerializer(many=True, read_only=True)
    intelligence = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "name", "key", "description", "created_by", "created_at",
            "members", "docs_count", "my_role", "workflow_states", "intelligence",
        ]

    def get_docs_count(self, obj):
        return obj.docs.count()

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        from users.access import effective_project_role
        return effective_project_role(request.user, obj)

    def get_intelligence(self, obj):
        summary = getattr(obj, "intelligence_summary", None)
        if summary:
            return {
                "health_status": summary.health_status,
                "current_phase": summary.current_phase,
                "health_rationale": summary.health_rationale,
                "signals_count": summary.signals_count,
            }
        return None


class ProjectSignalSerializer(serializers.ModelSerializer):
    source_doc_title = serializers.ReadOnlyField(source="source_doc.title")

    class Meta:
        model = ProjectSignal
        fields = [
            "id", "project", "source_doc", "source_doc_title", "category",
            "title", "description", "status", "severity", "target_date",
            "source_location", "confidence", "created_at", "updated_at",
        ]


class ProjectIntelligenceSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectIntelligenceSummary
        fields = [
            "id", "project", "health_status", "health_rationale",
            "current_phase", "executive_summary", "signals_count", "normalized_state", "last_synced_at",
        ]


class SavedFilterSerializer(serializers.ModelSerializer):
    assignee_username = serializers.ReadOnlyField(source="assignee.username")

    class Meta:
        model = SavedFilter
        fields = [
            "id", "project", "name",
            "status", "priority",
            "assignee", "assignee_username",
            "created_at",
        ]
        read_only_fields = ["created_at"]


class CalendarEntrySerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    participants = UserSerializer(many=True, read_only=True)
    # People picked as assignees. Anyone @mentioned in the title/notes is added automatically.
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = CalendarEntry
        fields = [
            "id", "project", "kind", "kind_label", "title", "description", "date", "time",
            "created_by", "participants", "participant_ids", "created_at", "updated_at",
        ]
        read_only_fields = ["created_by"]
