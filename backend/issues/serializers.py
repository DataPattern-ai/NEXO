from django.contrib.auth import get_user_model
from rest_framework import serializers

from users.serializers import UserSerializer

from .models import ActivityLog, Comment, Issue, IssueAttachment, Label


class LabelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Label
        fields = ["id", "name", "color"]


class CommentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "issue", "author", "body", "created_at", "updated_at"]
        read_only_fields = ["author"]


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = UserSerializer(read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = IssueAttachment
        fields = ["id", "issue", "uploaded_by", "file", "filename", "file_size", "content_type", "uploaded_at", "url"]
        read_only_fields = ["uploaded_by", "filename", "file_size", "content_type", "uploaded_at"]

    def get_url(self, obj):
        request = self.context.get("request")
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None

    def create(self, validated_data):
        file = validated_data["file"]
        validated_data["filename"] = file.name
        validated_data["file_size"] = file.size
        validated_data["content_type"] = getattr(file, "content_type", "application/octet-stream")
        return super().create(validated_data)


class ActivityLogSerializer(serializers.ModelSerializer):
    actor = UserSerializer(read_only=True)

    class Meta:
        model = ActivityLog
        fields = ["id", "actor", "field_changed", "old_value", "new_value", "created_at"]


class IssueSerializer(serializers.ModelSerializer):
    reporter = UserSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    assignee_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    # Optional on create: who reported it (defaults to the person creating the issue).
    reporter_id = serializers.PrimaryKeyRelatedField(
        source="reporter", queryset=get_user_model().objects.all(), write_only=True, required=False, allow_null=True
    )
    sprint_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    sprint_name = serializers.ReadOnlyField(source="sprint.name")
    labels = LabelSerializer(many=True, read_only=True)
    label_ids = serializers.PrimaryKeyRelatedField(
        source="labels", queryset=Label.objects.all(), many=True, write_only=True, required=False
    )
    comments = CommentSerializer(many=True, read_only=True)
    activity_log = ActivityLogSerializer(many=True, read_only=True)
    parent_title = serializers.ReadOnlyField(source="parent.title")
    subtasks = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Issue
        fields = [
            "id", "project", "parent", "parent_title", "title", "description", "issue_type",
            "status", "priority", "workstream", "reporter", "reporter_id", "assignee", "assignee_id",
            "labels", "label_ids", "comments", "activity_log", "resolution", "subtasks",
            "figma_url", "github_pr", "due_date", "attachments",
            "sprint_id", "sprint_name",
            "created_at", "updated_at",
        ]
        read_only_fields = ["reporter"]

    def get_subtasks(self, obj):
        return IssueListSerializer(obj.subtasks.all(), many=True).data


class IssueListSerializer(serializers.ModelSerializer):
    """Serializer for board/list views with reporter, parent, resolution."""
    reporter = UserSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    labels = LabelSerializer(many=True, read_only=True)
    parent_title = serializers.ReadOnlyField(source="parent.title")
    project_key = serializers.ReadOnlyField(source="project.key")
    project_name = serializers.ReadOnlyField(source="project.name")
    subtasks_count = serializers.SerializerMethodField()
    sprint_name = serializers.ReadOnlyField(source="sprint.name")

    class Meta:
        model = Issue
        fields = [
            "id", "project", "project_key", "project_name", "parent", "parent_title", "title", "description",
            "issue_type", "status", "priority", "workstream", "reporter", "assignee", "labels",
            "resolution", "subtasks_count", "figma_url", "github_pr", "due_date",
            "sprint_id", "sprint_name",
            "created_at", "updated_at"
        ]

    def get_subtasks_count(self, obj):
        return obj.subtasks.count()
