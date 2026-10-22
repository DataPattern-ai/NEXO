from django.conf import settings
from django.db import models

from projects.models import Project, Sprint


class Issue(models.Model):
    """
    The core work item — a "ticket". Belongs to exactly one Project.
    parent lets a subtask hang off a bigger issue/epic.
    """

    class IssueType(models.TextChoices):
        BUG = "BUG", "Bug"
        TASK = "TASK", "Task"
        STORY = "STORY", "Story"
        EPIC = "EPIC", "Epic"

    class Status(models.TextChoices):
        TODO = "TODO", "To Do"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        DONE = "DONE", "Done"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="issues")
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="subtasks"
    )

    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)

    issue_type = models.CharField(max_length=10, choices=IssueType.choices, default=IssueType.TASK)
    status = models.CharField(max_length=50, default="TODO")
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    workstream = models.CharField(max_length=150, blank=True, default="", help_text="Workstream or module name")

    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="reported_issues"
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_issues"
    )

    labels = models.ManyToManyField("Label", blank=True, related_name="issues")
    sprint = models.ForeignKey(
        Sprint, on_delete=models.SET_NULL, null=True, blank=True, related_name="issues"
    )
    figma_url = models.URLField(max_length=500, blank=True, null=True)
    github_pr = models.CharField(max_length=300, blank=True, null=True)
    due_date = models.DateField(null=True, blank=True)
    resolution = models.CharField(max_length=30, default="Unresolved", blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.project.key}-{self.pk}: {self.title}"


class Label(models.Model):
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=7, default="#999999", help_text="Hex color")

    def __str__(self):
        return self.name


class Comment(models.Model):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment by {self.author} on {self.issue}"


class IssueAttachment(models.Model):
    """
    File attached to an issue — images, PDFs, docs, etc.
    Files are stored under MEDIA_ROOT/attachments/issue_<id>/
    """
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="attachments")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="attachments"
    )
    file = models.FileField(upload_to="attachments/issue_%Y%m%d/")
    filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(default=0, help_text="Size in bytes")
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.filename} → {self.issue}"


class ActivityLog(models.Model):
    """
    Auto-generated history of changes on an issue — e.g. status change,
    assignee change. Written to by signal handlers / view logic, not
    directly by users.
    """
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="activity_log")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    field_changed = models.CharField(max_length=50)
    old_value = models.CharField(max_length=200, blank=True)
    new_value = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.issue} — {self.field_changed}: {self.old_value} → {self.new_value}"
