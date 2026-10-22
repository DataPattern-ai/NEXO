from django.conf import settings
from django.db import models


class Project(models.Model):
    """
    A container for issues. Whoever creates the project becomes its
    Owner via the ProjectMembership below.
    """
    name = models.CharField(max_length=200)
    key = models.CharField(max_length=10, unique=True, help_text="Short prefix, e.g. 'WEB' for WEB-123")
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_projects"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.key} - {self.name}"


class ProjectMembership(models.Model):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Admin"
        MEMBER = "MEMBER", "Member"
        VIEWER = "VIEWER", "Viewer"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "user")

    def __str__(self):
        return f"{self.user} - {self.project} ({self.role})"


class ProjectDoc(models.Model):
    """
    Project documentation files (PRD, Architecture, Retrospectives, Meeting notes, Status reports, Timeline, etc.).
    Supports markdown content as well as uploaded files (PDF, DOCX, XLSX).
    """
    class TemplateType(models.TextChoices):
        STATUS = "STATUS", "Project Status / Weekly Report"
        TIMELINE = "TIMELINE", "Timeline & Project Plan"
        RESOURCE = "RESOURCE", "Resource / Team Document"
        PRD = "PRD", "Product Requirements (PRD)"
        ARCHITECTURE = "ARCHITECTURE", "Architecture & System Design"
        RETRO = "RETRO", "Sprint Retrospective"
        MEETING = "MEETING", "Meeting Notes & Decisions"
        CUSTOM = "CUSTOM", "Custom Document"

    class FileType(models.TextChoices):
        MARKDOWN = "MARKDOWN", "Markdown"
        PDF = "PDF", "PDF Document"
        DOCX = "DOCX", "Word Document"
        XLSX = "XLSX", "Excel Spreadsheet"
        OTHER = "OTHER", "Other File"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="docs")
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)
    template_type = models.CharField(max_length=20, choices=TemplateType.choices, default=TemplateType.CUSTOM)
    file = models.FileField(upload_to="project_docs/%Y%m%d/", null=True, blank=True)
    file_type = models.CharField(max_length=20, choices=FileType.choices, default=FileType.MARKDOWN)
    file_size = models.PositiveIntegerField(default=0, help_text="File size in bytes")
    file_hash = models.CharField(max_length=64, blank=True, db_index=True, help_text="SHA-256 hash for deduplication and versioning")
    version = models.PositiveIntegerField(default=1, help_text="Document revision number")
    raw_text = models.TextField(blank=True, help_text="Extracted plain text content from uploaded file")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_docs"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"[{self.project.key}] {self.title}"


class WorkflowState(models.Model):
    """
    A custom status column for a project's workflow.
    Category maps to the legacy TODO/IN_PROGRESS/DONE for board colouring.
    """
    class Category(models.TextChoices):
        TODO = "TODO", "To Do"
        IN_PROGRESS = "IN_PROGRESS", "In Progress"
        DONE = "DONE", "Done"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="workflow_states")
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=7, default="#42526E", help_text="Hex color for the column header")
    category = models.CharField(max_length=15, choices=Category.choices, default=Category.TODO)
    position = models.PositiveIntegerField(default=0, help_text="Left-to-right order on the board")
    is_default = models.BooleanField(default=False, help_text="Pre-selected status when creating a new issue")

    class Meta:
        ordering = ["position"]
        unique_together = ("project", "name")

    def __str__(self):
        return f"{self.project.key} — {self.name}"


class WorkflowTransition(models.Model):
    """
    Allowed status move: from_state → to_state within a project.
    If no transitions are defined for a state, all moves are permitted.
    """
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="workflow_transitions")
    from_state = models.ForeignKey(
        WorkflowState, on_delete=models.CASCADE, related_name="transitions_from"
    )
    to_state = models.ForeignKey(
        WorkflowState, on_delete=models.CASCADE, related_name="transitions_to"
    )

    class Meta:
        unique_together = ("project", "from_state", "to_state")

    def __str__(self):
        return f"{self.project.key}: {self.from_state.name} → {self.to_state.name}"


def create_default_workflow(project):
    """Creates the standard 3-column workflow for a newly created project."""
    defaults = [
        {"name": "To Do",       "color": "#42526E", "category": WorkflowState.Category.TODO,        "position": 0, "is_default": True},
        {"name": "In Progress", "color": "#0052CC", "category": WorkflowState.Category.IN_PROGRESS, "position": 1},
        {"name": "Done",        "color": "#00875A", "category": WorkflowState.Category.DONE,        "position": 2},
    ]
    states = []
    for d in defaults:
        s, _ = WorkflowState.objects.get_or_create(project=project, name=d["name"], defaults=d)
        states.append(s)
    # Allow all transitions between the 3 default states
    for frm in states:
        for to in states:
            if frm != to:
                WorkflowTransition.objects.get_or_create(project=project, from_state=frm, to_state=to)
    return states


class Sprint(models.Model):
    """
    A time-boxed iteration. Belongs to one Project.
    Status flow: PLANNED → ACTIVE → COMPLETED.
    Only one sprint per project can be ACTIVE at a time.
    """
    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        ACTIVE = "ACTIVE", "Active"
        COMPLETED = "COMPLETED", "Completed"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="sprints")
    name = models.CharField(max_length=200)
    goal = models.TextField(blank=True, help_text="Sprint goal / objective")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.project.key} — {self.name} [{self.status}]"


class AutomationRule(models.Model):
    """
    Automated workflow rules for projects.
    """
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="automation_rules")
    name = models.CharField(max_length=255)
    trigger = models.CharField(max_length=255)
    action = models.CharField(max_length=255)
    enabled = models.BooleanField(default=True)
    execution_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.name} ({'Enabled' if self.enabled else 'Disabled'})"


class SavedFilter(models.Model):
    """
    A named filter preset saved by a user, scoped to a project.
    Stores optional status / priority / assignee values.
    """
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_filters"
    )
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="saved_filters"
    )
    name = models.CharField(max_length=100)
    status = models.CharField(max_length=15, blank=True, null=True)
    priority = models.CharField(max_length=10, blank=True, null=True)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="saved_filter_assignees"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        unique_together = ("owner", "project", "name")

    def __str__(self):
        return f"{self.owner} — {self.name} [{self.project.key}]"


class CalendarEntry(models.Model):
    """
    Something put on a project's calendar by clicking a day: a reminder, task, event...
    Everyone involved (the creator, the people picked as assignees, and anyone @mentioned)
    is told when they are added, and again when the date (and optional time) arrives.
    """
    class Kind(models.TextChoices):
        REMINDER = "REMINDER", "Reminder"
        TASK = "TASK", "Task"
        EVENT = "EVENT", "Event"
        MEETING = "MEETING", "Meeting"
        OTHER = "OTHER", "Other"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="calendar_entries")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_calendar_entries"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.REMINDER)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    date = models.DateField()
    time = models.TimeField(null=True, blank=True, help_text="Optional. Without it the reminder goes out in the morning.")
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="calendar_entries")
    # Set (atomically) when the "it's today" notification has been sent, so it only ever goes out once.
    due_notified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "time", "id"]

    def __str__(self):
        return f"{self.project.key} {self.date} — {self.title}"


class ProjectSignal(models.Model):
    """
    Structured intermediate representation of signals extracted from project documents
    or derived from issues/sprints (phases, milestones, risks, blockers, dependencies, updates, decisions).
    Retains full source traceability (document name, page/section/row location, confidence).
    """
    class Category(models.TextChoices):
        PHASE = "PHASE", "Active Phase / Workstream"
        MILESTONE = "MILESTONE", "Milestone / Deliverable"
        RISK = "RISK", "Project Risk"
        BLOCKER = "BLOCKER", "Active Blocker"
        CHALLENGE = "CHALLENGE", "Project Challenge"
        DEPENDENCY = "DEPENDENCY", "Technical or External Dependency"
        UPDATE = "UPDATE", "Status Update"
        DECISION = "DECISION", "Key Decision"
        RESOURCE_NOTE = "RESOURCE_NOTE", "Resource / Team Allocation Note"

    class Severity(models.TextChoices):
        CRITICAL = "CRITICAL", "Critical"
        HIGH = "HIGH", "High"
        MEDIUM = "MEDIUM", "Medium"
        LOW = "LOW", "Low"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="signals")
    source_doc = models.ForeignKey(
        ProjectDoc, on_delete=models.SET_NULL, null=True, blank=True, related_name="signals"
    )
    category = models.CharField(max_length=25, choices=Category.choices, default=Category.UPDATE)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=50, default="ACTIVE", help_text="e.g. ACTIVE, RESOLVED, DELAYED, COMPLETED")
    severity = models.CharField(max_length=15, choices=Severity.choices, default=Severity.MEDIUM)
    target_date = models.DateField(null=True, blank=True, help_text="Target milestone or resolution date")
    source_location = models.CharField(
        max_length=255, blank=True, help_text="Page, section heading, or sheet cell reference"
    )
    confidence = models.FloatField(default=1.0, help_text="Confidence score from 0.0 to 1.0")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.project.key}] {self.category}: {self.title}"


class ProjectIntelligenceSummary(models.Model):
    """
    Cached, executive-level project intelligence summary synthesizing
    structured project metrics, active workstreams, and document-derived signals.
    """
    class HealthStatus(models.TextChoices):
        ON_TRACK = "ON_TRACK", "On Track"
        AT_RISK = "AT_RISK", "At Risk"
        OFF_TRACK = "OFF_TRACK", "Off Track"

    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="intelligence_summary")
    health_status = models.CharField(max_length=20, choices=HealthStatus.choices, default=HealthStatus.ON_TRACK)
    health_rationale = models.TextField(blank=True, help_text="Deterministic justification for health state")
    current_phase = models.CharField(max_length=200, blank=True, help_text="Active phase / workstream")
    executive_summary = models.TextField(blank=True, help_text="Concise 4-5 bullet executive briefing")
    signals_count = models.PositiveIntegerField(default=0)
    normalized_state = models.JSONField(default=dict, blank=True, help_text="Structured normalized project state")
    last_synced_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"[{self.project.key}] Health: {self.health_status} ({self.current_phase})"

