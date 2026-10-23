import datetime
import json
import logging
import re
import zoneinfo
from typing import Any, Dict, List, Optional, Tuple

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone

from issues.models import ActivityLog, Issue
from projects.intelligence.ai_provider import execute_llm_call
from projects.models import Project, ProjectIntelligenceSummary, ProjectMembership, ProjectSignal

logger = logging.getLogger(__name__)
User = get_user_model()


# ---------------------------------------------------------------------------
# Date & Time Parsing Helpers
# ---------------------------------------------------------------------------

MONTH_MAP = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12,
}


def get_default_ref_date() -> datetime.date:
    """Returns today's date in the configured timezone (Asia/Kolkata)."""
    try:
        tz_name = getattr(settings, 'REMINDER_TIME_ZONE', 'Asia/Kolkata')
        tz = zoneinfo.ZoneInfo(tz_name)
        return timezone.now().astimezone(tz).date()
    except Exception:
        return timezone.now().date()


def parse_date_str(text: Optional[str], ref_date: Optional[datetime.date] = None) -> Optional[str]:
    """
    Parses a wide variety of date formats into standard ISO 'YYYY-MM-DD'.
    Handles:
    - Explicit textual dates: '25 October 2026', 'October 25, 2026', '25th Oct 2026', 'Oct 25 2026'
    - Explicit numeric dates: '2026-10-25', '2026/10/25', '25/10/2026', '25-10-2026', '[22/10/2026]'
    - Relative dates: 'today', 'tomorrow', 'day after tomorrow', 'in 3 days', 'in 2 weeks',
      'next Monday', 'this Friday', 'by Friday', 'end of week'
    All relative dates are resolved against the configured timezone (Asia/Kolkata).
    """
    if not text:
        return None
    ref = ref_date or get_default_ref_date()
    clean = str(text).strip()

    # Strip conversational/prepositional prefixes like 'deadline of', 'due on', 'by', 'at'
    clean = re.sub(
        r'^(?:(?:and\s+)?(?:make\s+|set\s+)?(?:the\s+)?(?:deadline|due\s*date)(?:\s+of|\s+is|\s+to|\s+as)?|due(?:\s+date)?(?:\s+on|\s+by|\s+at|\s+is|\s+as|\s+to|\s+for)?|by|on|at|for|until|the)\s+',
        '',
        clean,
        flags=re.I
    ).strip()

    # 1. Textual month format: '25 October 2026' or '25th Oct 2026' or '25-Oct-2026'
    m_textual_1 = re.search(
        r'\b(\d{1,2})(?:st|nd|rd|th)?[\s\-_]+([a-zA-Z]{3,9})(?:[\s\-_,]+(\d{2,4}))?\b',
        clean,
        flags=re.I
    )
    if m_textual_1:
        d_val = int(m_textual_1.group(1))
        m_name = m_textual_1.group(2).lower()
        if m_name in MONTH_MAP:
            m_val = MONTH_MAP[m_name]
            y_raw = m_textual_1.group(3)
            if y_raw:
                y_val = int(y_raw)
                if y_val < 100:
                    y_val += 2000
            else:
                y_val = ref.year
            try:
                return datetime.date(y_val, m_val, d_val).isoformat()
            except ValueError:
                pass

    # 2. Textual month format: 'October 25, 2026' or 'Oct 25 2026' or 'Oct 25th, 2026'
    m_textual_2 = re.search(
        r'\b([a-zA-Z]{3,9})[\s\-_]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s\-_,]+(\d{2,4}))?\b',
        clean,
        flags=re.I
    )
    if m_textual_2:
        m_name = m_textual_2.group(1).lower()
        if m_name in MONTH_MAP:
            m_val = MONTH_MAP[m_name]
            d_val = int(m_textual_2.group(2))
            y_raw = m_textual_2.group(3)
            if y_raw:
                y_val = int(y_raw)
                if y_val < 100:
                    y_val += 2000
            else:
                y_val = ref.year
            try:
                return datetime.date(y_val, m_val, d_val).isoformat()
            except ValueError:
                pass

    # 3. ISO format: YYYY-MM-DD or YYYY/MM/DD
    m_iso = re.search(r'\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b', clean)
    if m_iso:
        try:
            return datetime.date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))).isoformat()
        except ValueError:
            pass

    # 4. Bracketed or explicit dates: [22/10/2026] or 22/10/2026 or 22-10-2026 (DD/MM/YYYY)
    m_dmy = re.search(r'\[?(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\]?', clean)
    if m_dmy:
        p1, p2, y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        if y < 100:
            y += 2000
        # Standard DMY (day <= 31, month <= 12)
        if p2 <= 12 and p1 <= 31:
            try:
                return datetime.date(y, p2, p1).isoformat()
            except ValueError:
                pass
        # Fallback MDY (month <= 12, day <= 31)
        if p1 <= 12 and p2 <= 31:
            try:
                return datetime.date(y, p1, p2).isoformat()
            except ValueError:
                pass

    # 5. Relative terms
    lower = clean.lower()
    if 'day after tomorrow' in lower:
        return (ref + datetime.timedelta(days=2)).isoformat()
    if 'tomorrow' in lower:
        return (ref + datetime.timedelta(days=1)).isoformat()
    if 'today' in lower:
        return ref.isoformat()
    if 'yesterday' in lower:
        return (ref - datetime.timedelta(days=1)).isoformat()

    # in X days / weeks
    m_in_days = re.search(r'\bin\s+(\d+)\s+days?\b', lower)
    if m_in_days:
        return (ref + datetime.timedelta(days=int(m_in_days.group(1)))).isoformat()

    m_in_weeks = re.search(r'\bin\s+(\d+)\s+weeks?\b', lower)
    if m_in_weeks:
        return (ref + datetime.timedelta(days=int(m_in_weeks.group(1)) * 7)).isoformat()

    if 'next week' in lower:
        return (ref + datetime.timedelta(days=7)).isoformat()

    if 'end of week' in lower or 'end of this week' in lower:
        diff = (4 - ref.weekday()) % 7  # Friday
        if diff == 0:
            diff = 7
        return (ref + datetime.timedelta(days=diff)).isoformat()

    if 'end of next week' in lower:
        diff = (4 - ref.weekday()) % 7
        if diff == 0:
            diff = 7
        return (ref + datetime.timedelta(days=diff + 7)).isoformat()

    days_of_week = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    for idx, day_name in enumerate(days_of_week):
        if day_name in lower:
            current_day = ref.weekday()
            diff = (idx - current_day) % 7
            if diff == 0:
                diff = 7 if 'next' in lower else 0
            return (ref + datetime.timedelta(days=diff)).isoformat()

    return None


# ---------------------------------------------------------------------------
# User & Assignee Resolution
# ---------------------------------------------------------------------------

def resolve_assignee(
    project: Project,
    name_query: Optional[str],
    current_user: Optional[Any] = None
) -> Tuple[Optional[Any], bool, List[str]]:
    """
    Resolves a person's name, username, or alias against registered NEXO users.
    Returns: (user_or_none, is_ambiguous, candidate_names)
    - If a unique user is matched: (user, False, [])
    - If multiple matches found: (None, True, [candidate_names])
    - If no matches found: (None, False, [])
    """
    if not name_query:
        return None, False, []

    clean = str(name_query).strip().strip('"\'').lstrip('@')
    if not clean:
        return None, False, []

    clean_lower = clean.lower()

    if clean_lower in ["me", "myself", "i", "self", "assigned to me"]:
        return (current_user, False, []) if current_user else (None, False, [])

    # 1. Exact matches across all registered system users
    all_users = list(User.objects.filter(is_active=True))
    exact_all = []
    for u in all_users:
        u_full = u.get_full_name().strip().lower()
        if (
            u.username.lower() == clean_lower
            or (u.email and u.email.lower() == clean_lower)
            or (u_full and u_full == clean_lower)
            or (u.first_name and u.first_name.lower() == clean_lower)
        ):
            exact_all.append(u)

    if len(exact_all) > 1:
        return None, True, [u.username for u in exact_all]
    elif len(exact_all) == 1:
        return exact_all[0], False, []

    member_user_ids = project.memberships.values_list('user_id', flat=True)
    project_users = list(User.objects.filter(id__in=member_user_ids))

    # 3. Word boundary / prefix match (require at least 3 characters)
    if len(clean) >= 3:
        prefix_proj = []
        for u in project_users:
            u_full = u.get_full_name().strip().lower()
            name_tokens = u_full.split() if u_full else []
            if (
                clean_lower in name_tokens
                or u.username.lower().startswith(clean_lower)
                or (u.first_name and u.first_name.lower().startswith(clean_lower))
                or (u.last_name and u.last_name.lower().startswith(clean_lower))
            ):
                prefix_proj.append(u)

        if len(prefix_proj) == 1:
            return prefix_proj[0], False, []
        elif len(prefix_proj) > 1:
            return None, True, [u.username for u in prefix_proj]

        prefix_all = []
        for u in all_users:
            u_full = u.get_full_name().strip().lower()
            name_tokens = u_full.split() if u_full else []
            if (
                clean_lower in name_tokens
                or u.username.lower().startswith(clean_lower)
                or (u.first_name and u.first_name.lower().startswith(clean_lower))
                or (u.last_name and u.last_name.lower().startswith(clean_lower))
            ):
                prefix_all.append(u)

        if len(prefix_all) == 1:
            return prefix_all[0], False, []
        elif len(prefix_all) > 1:
            return None, True, [u.username for u in prefix_all[:5]]

    return None, False, []


def resolve_user_by_name(project: Project, name_query: Optional[str]) -> Optional[Any]:
    """
    Resolves a person's name, username, or alias to an active User instance.
    Searches project members first, then the system user base.
    """
    user, _, _ = resolve_assignee(project, name_query)
    return user


# ---------------------------------------------------------------------------
# Natural Language Task Extraction
# ---------------------------------------------------------------------------

def extract_task_creation_parameters(user_message: str, project: Project, current_user: Any) -> Dict[str, Any]:
    """
    Intelligently extracts task attributes from natural language:
    - Pure task title/name (stripping conversational prefixes & residual phrases)
    - Explicit titles in quotes if provided
    - Assignee (resolved against registered NEXO users)
    - Deadline / Due date (resolved to YYYY-MM-DD via configured timezone)
    - Priority (LOW, MEDIUM, HIGH, CRITICAL)
    - Status (TODO, IN_PROGRESS, DONE)
    - Workstream / Module
    - Issue type (TASK, BUG, STORY, EPIC, SUBTASK)
    """
    working = user_message.strip()

    # 0. Check for explicit quoted title
    explicit_quoted_title = None
    # Look for quotes specifically after creation intent or named/titled
    m_quoted = re.search(
        r'(?:(?:task|issue|ticket|item|named|called|titled|title|summary)\s*[:\s]*|^\s*)["\']([^"\']{2,150})["\']',
        working,
        flags=re.I
    )
    if not m_quoted:
        # General quote check (not preceded by assign or deadline)
        m_any_quote = re.search(r'["\']([^"\']{2,150})["\']', working)
        if m_any_quote:
            prefix_before = working[:m_any_quote.start()].lower()
            if not re.search(r'\b(?:assign(?:\s+it)?\s+to|deadline|due(?:\s+date)?)\s*$', prefix_before):
                m_quoted = m_any_quote

    if m_quoted:
        candidate_title = m_quoted.group(1).strip()
        # Verify it is not just a date or priority
        if candidate_title.lower() not in ["low", "medium", "high", "critical", "todo", "done"] and not parse_date_str(candidate_title):
            explicit_quoted_title = candidate_title
            # Replace quoted part with token to preserve sentence structure while extracting other attributes
            working = working[:m_quoted.start()] + ' __QUOTED_TITLE__ ' + working[m_quoted.end():]

    # 1. Priority extraction
    priority = "MEDIUM"
    m_prio = re.search(
        r'\b(?:with\s+)?(?:priority\s+(?:is\s+|to\s+|as\s+)?(low|medium|high|critical)|(critical|urgent|high|low)\s+priority)\b',
        working,
        flags=re.I,
    )
    if m_prio:
        p_val = m_prio.group(0).lower()
        if 'crit' in p_val or 'urg' in p_val:
            priority = 'CRITICAL'
        elif 'high' in p_val:
            priority = 'HIGH'
        elif 'low' in p_val:
            priority = 'LOW'
        working = working[:m_prio.start()] + ' ' + working[m_prio.end():]
    elif re.search(r'\b(critical|urgent)\b', working, flags=re.I):
        priority = "CRITICAL"
        working = re.sub(r'\b(critical|urgent)\b', ' ', working, flags=re.I)

    # 2. Status extraction
    status_val = "TODO"
    m_stat_prog = re.search(r'\b(?:status\s+(?:is\s+|to\s+|as\s+)?(in\s+progress|active)|(?:in|mark as)\s+progress)\b', working, flags=re.I)
    if m_stat_prog:
        status_val = "IN_PROGRESS"
        working = working[:m_stat_prog.start()] + ' ' + working[m_stat_prog.end():]
    else:
        m_stat_done = re.search(r'\b(?:status\s+(?:is\s+|to\s+|as\s+)?(done|completed|closed)|(?:mark as\s+)?(?:done|completed))\b', working, flags=re.I)
        if m_stat_done:
            status_val = "DONE"
            working = working[:m_stat_done.start()] + ' ' + working[m_stat_done.end():]

    # 3. Issue type extraction
    issue_type = "TASK"
    if re.search(r'\b(bug|defect|incident)\b', working, flags=re.I):
        issue_type = "BUG"
    elif re.search(r'\b(story|user story|feature)\b', working, flags=re.I):
        issue_type = "STORY"
    elif re.search(r'\b(epic|initiative)\b', working, flags=re.I):
        issue_type = "EPIC"
    elif re.search(r'\b(subtask)\b', working, flags=re.I):
        issue_type = "SUBTASK"

    # 4. Workstream extraction
    workstream = ""
    m_ws = re.search(
        r'\b(?:in|for)\s+(?:workstream|module)\s+([a-zA-Z0-9_\-\s]+?)(?=\s+(?:and|with|assign|priority|status|deadline|due|by)|\s*$)',
        working,
        flags=re.I,
    )
    if m_ws:
        workstream = m_ws.group(1).strip()
        working = working[:m_ws.start()] + ' ' + working[m_ws.end():]
    else:
        existing_ws = (
            project.issues.exclude(workstream="")
            .values_list("workstream", flat=True)
            .distinct()
        )
        for ws in existing_ws:
            if ws and len(ws) >= 3 and ws.lower() in working.lower():
                workstream = ws
                break

    # 5. Deadline / Due Date extraction
    deadline_str = None
    m_date = re.search(
        r'\b(?:and\s+)?(?:with\s+)?(?:make\s+|set\s+)?(?:the\s+)?(?:deadline|due\s*date)(?:\s+(?:of|is|as|to))?\s+([^,\n]+?)(?=\s+(?:and|with|assign|priority|status|in\s+workstream)|\s*$)',
        working,
        flags=re.I,
    )
    if m_date:
        deadline_str = m_date.group(1).strip()
        working = working[:m_date.start()] + ' ' + working[m_date.end():]
    else:
        m_due = re.search(
            r'\b(?:and\s+)?(?:with\s+)?(?:is\s+)?due(?:\s+(?:on|by|at|as|for))?\s+([^,\n]+?)(?=\s+(?:and|with|assign|priority|status|in\s+workstream)|\s*$)',
            working,
            flags=re.I,
        )
        if m_due:
            deadline_str = m_due.group(1).strip()
            working = working[:m_due.start()] + ' ' + working[m_due.end():]
        else:
            m_by = re.search(
                r'\b(?:and\s+)?(?:with\s+)?by\s+(tomorrow|today|day\s+after\s+tomorrow|next\s+\w+|this\s+\w+|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[a-zA-Z]{3,9}(?:\s*,?\s*\d{2,4})?|[a-zA-Z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{2,4})?)\b',
                working,
                flags=re.I,
            )
            if m_by:
                deadline_str = m_by.group(1).strip()
                working = working[:m_by.start()] + ' ' + working[m_by.end():]

    due_date = parse_date_str(deadline_str) if deadline_str else None

    # Check for "for <name> to <action>" pattern AFTER deadline extraction
    for_to_assignee = None
    for_to_action = None
    m_for_to = re.search(
        r'\b(?:create|add|draft|make)\s+(?:a\s+)?(?:new\s+)?(?:task|issue|ticket|item)\s+for\s+([a-zA-Z0-9_.\s]+?)\s+to\s+([^,.\n]+)',
        working,
        flags=re.I
    )
    if m_for_to:
        for_to_assignee = m_for_to.group(1).strip()
        for_to_action = m_for_to.group(2).strip()
        working = working[:m_for_to.start()] + ' ' + working[m_for_to.end():]

    # 6. Assignee extraction
    assignee_user = None
    assignee_str = None
    is_ambiguous = False
    candidates = []

    m_ass = re.search(
        r'\b(?:and\s+)?assign(?:\s+it)?\s+to\s+([a-zA-Z0-9_.\s]+?)(?=\s+(?:and|with|deadline|due|by|status|priority|in\s+workstream)|\s*$)',
        working,
        flags=re.I,
    )
    if m_ass:
        assignee_str = m_ass.group(1).strip()
        working = working[:m_ass.start()] + ' ' + working[m_ass.end():]
    else:
        m_ass2 = re.search(
            r'\b(?:and\s+)?assigned\s+to\s+([a-zA-Z0-9_.\s]+?)(?=\s+(?:and|with|deadline|due|by|status|priority|in\s+workstream)|\s*$)',
            working,
            flags=re.I,
        )
        if m_ass2:
            assignee_str = m_ass2.group(1).strip()
            working = working[:m_ass2.start()] + ' ' + working[m_ass2.end():]
        elif for_to_assignee:
            assignee_str = for_to_assignee
        else:
            m_for = re.search(
                r'\bfor\s+([a-zA-Z0-9_]+)\b(?=\s+(?:and|with|deadline|due|by|status|priority)|\s*$)',
                working,
                flags=re.I,
            )
            if m_for:
                assignee_str = m_for.group(1).strip()
                working = working[:m_for.start()] + ' ' + working[m_for.end():]

    if assignee_str:
        assignee_user, is_ambiguous, candidates = resolve_assignee(project, assignee_str, current_user)

    # 7. Clean Title Determination
    if explicit_quoted_title:
        clean_title = explicit_quoted_title
    elif for_to_action:
        clean_title = for_to_action
        clean_title = re.sub(r'\b(?:with\s+)?(?:deadline|due\s*date|due\s+by|due\s+on|by)\s+.*$', '', clean_title, flags=re.I).strip()
        clean_title = re.sub(r'\b(?:with\s+)?(?:priority\s+.*|critical|urgent|high\s+priority|low\s+priority)\b', '', clean_title, flags=re.I).strip()
    else:
        clean_title = working
        m_named = re.search(
            r'\b(?:named|called|titled|title|summary)\s*[:\s]*["\']?([^"\',]+?)["\']?(?=\s+(?:and\s+assign|and\s+make|and\s+set|with|deadline|due|by|status|priority|in\s+workstream)|\s*$)',
            clean_title,
            flags=re.I,
        )
        if m_named:
            clean_title = m_named.group(1).strip()
        else:
            clean_title = re.sub(
                r'^(?:please\s+)?(?:can\s+(?:you|we)\s+)?(?:i\s+(?:want|need)\s+to\s+)?(?:create|add|make|draft|new)\s+(?:a\s+)?(?:new\s+)?(?:task|issue|ticket|item|work\s*item)\s*(?:named|called|title|titled|for)?\s*:?\s*',
                '',
                clean_title,
                flags=re.I,
            ).strip()

        clean_title = clean_title.replace('__QUOTED_TITLE__', '').strip()
        clean_title = re.sub(r'\b(?:with\s+)?(?:deadline|due\s*date|due\s+by|due\s+on|by)\s+.*$', '', clean_title, flags=re.I).strip()
        clean_title = re.sub(r'\b(?:with\s+)?(?:priority\s+.*|critical|urgent|high\s+priority|low\s+priority)\b', '', clean_title, flags=re.I).strip()
        clean_title = clean_title.strip('"\'')
        clean_title = re.sub(r'^(?:and|with|for|to|on)\s+', '', clean_title, flags=re.I).strip()
        clean_title = re.sub(r'\s+\b(?:and|with|in|for|as|to|on|by)\b\s*$', '', clean_title, flags=re.I).strip()
        clean_title = re.sub(r'\s{2,}', ' ', clean_title).strip()

    if not clean_title:
        clean_title = "New Project Task"

    # Ensure title starts with an uppercase letter
    clean_title = clean_title[:1].upper() + clean_title[1:]

    # Human-readable proposal summary
    desc_parts = [f"Create {issue_type.title()} '{clean_title}'"]
    if assignee_user:
        desc_parts.append(f"assigned to {assignee_user.username}")
    elif assignee_str and not is_ambiguous:
        desc_parts.append(f"(assignee '{assignee_str}' unassigned)")
    if due_date:
        desc_parts.append(f"due on {due_date}")
    if workstream:
        desc_parts.append(f"in '{workstream}'")
    desc_parts.append(f"[{priority} Priority]")

    return {
        "title": clean_title,
        "assignee_id": assignee_user.id if assignee_user else None,
        "assignee_name": assignee_user.username if assignee_user else None,
        "assignee_ambiguous": is_ambiguous,
        "assignee_candidates": candidates,
        "assignee_unknown": bool(assignee_str and not assignee_user and not is_ambiguous),
        "assignee_query": assignee_str,
        "due_date": due_date,
        "priority": priority,
        "status": status_val,
        "issue_type": issue_type,
        "workstream": workstream,
        "description": " ".join(desc_parts) + ".",
    }


# ---------------------------------------------------------------------------
# Project Q&A and Knowledge Retrieval Engine
# ---------------------------------------------------------------------------

def answer_project_or_tool_query(project: Project, user: Any, user_message: str) -> Dict[str, Any]:
    """
    Answers questions about:
    1. Project health, status, metrics, and progress.
    2. Specific users' workload (e.g. 'What is Adheeshwaran working on?').
    3. Overdue tasks, upcoming deadlines, and timelines.
    4. Risks, blockers, and project signals.
    5. Workstreams, modules, and deliverable reconciliation.
    6. Tool usage: How to export to Excel/CSV, how to import docs, how views work.
    """
    lower = user_message.lower().strip()
    issues_qs = project.issues.all().select_related("assignee", "reporter")
    total_issues = issues_qs.count()
    done_count = issues_qs.filter(status="DONE").count()
    in_prog_count = issues_qs.filter(status="IN_PROGRESS").count()
    todo_count = issues_qs.filter(status="TODO").count()
    critical_count = issues_qs.filter(priority="CRITICAL").count()
    high_count = issues_qs.filter(priority="HIGH").count()
    unassigned_count = issues_qs.filter(assignee__isnull=True).count()
    pct = round((done_count / total_issues * 100)) if total_issues else 0

    summary = getattr(project, "intelligence_summary", None)
    signals = list(project.signals.all().order_by("-confidence"))
    ranked_delivs = []
    if summary and summary.normalized_state:
        ranked_delivs = summary.normalized_state.get("ranked_deliverables", [])

    # -------------------------------------------------------------------------
    # 1. TOOL USAGE & PLATFORM CAPABILITIES
    # -------------------------------------------------------------------------
    if any(k in lower for k in ["how to export", "export to excel", "export csv", "download excel", "download csv"]):
        reply = (
            f"### How to Export Data in NEXO\n\n"
            f"You can export all project deliverables and tasks in **canonical PMO format**:\n\n"
            f"1. **Click the 'Export' button** in the top-right navigation bar of the project.\n"
            f"2. Choose between:\n"
            f"   - **Standard Excel (.xlsx)**: Generates a complete 5-sheet PMO workbook (`Project Overview`, `Tasks`, `Milestones`, `Risks & Issues`, `Lists & Definitions`).\n"
            f"   - **Standard CSV (.csv)**: Generates a clean comma-delimited export sanitized against formula injection (CWE-1236 defense).\n"
            f"3. **Filtering**: Any filters currently applied to your board or list (by status, priority, assignee, or workstream) are automatically respected during export."
        )
        return {"type": "ANSWER", "reply": reply, "citations": ["Export Engine"]}

    if any(k in lower for k in ["how to import", "import doc", "import deliverable", "reconciliation"]):
        reply = (
            f"### Document Intelligence & Import Reconciliation\n\n"
            f"NEXO allows you to bridge project documents into operational tasks seamlessly:\n\n"
            f"1. **Upload Documents**: Navigate to the **Docs** tab and upload Excel, Word, or PDF project files (e.g. status reports, timelines, WBS).\n"
            f"2. **Click 'Import Docs'**: Located in the top header. This opens the **Document Reconciliation Modal**.\n"
            f"3. **Review Extracted Items**: NEXO previews extracted deliverables, matches workstreams, auto-detects registered team members, and flags duplicate titles.\n"
            f"4. **Confirm & Sync**: Click **'Import All Deliverables to Tracker'** to turn document milestones into persistent tasks across List, Board, and Calendar views."
        )
        return {"type": "ANSWER", "reply": reply, "citations": ["Document Intelligence"]}

    if any(k in lower for k in ["views", "list view", "board view", "calendar view", "backlog view"]):
        reply = (
            f"### NEXO Project Views Guide\n\n"
            f"All views in NEXO operate on the **same synchronized database records**:\n\n"
            f"- **List View**: Tabular grid supporting inline editing, sorting by columns, quick filtering, and grouping by workstream or status.\n"
            f"- **Board View**: Kanban workflow columns (**To Do**, **In Progress**, **Done**) with drag-and-drop transitions.\n"
            f"- **Calendar View**: Month and week schedules plotting tasks by their start dates and deadlines.\n"
            f"- **Backlog View**: Agile sprint planning view allowing you to drag tasks between the project backlog and active sprint cycles.\n"
            f"- **Docs View**: Project document repository displaying extracted deliverables, classifications, and intelligence summaries."
        )
        return {"type": "ANSWER", "reply": reply, "citations": ["NEXO Views"]}

    if any(k in lower for k in ["roles", "permission", "admin vs member", "viewer"]):
        reply = (
            f"### NEXO User Roles & Permissions\n\n"
            f"- **Admin**: Full ownership of the project. Can modify settings, add/remove members, create and delete tasks, configure automations, and manage workflows.\n"
            f"- **Member**: Core team collaborator. Can create issues, update status on assigned tasks, add comments, and upload attachments.\n"
            f"- **Viewer**: Stakeholder role with read-only access to boards, lists, dashboards, and PMO exports."
        )
        return {"type": "ANSWER", "reply": reply, "citations": ["Security & RBAC"]}

    # -------------------------------------------------------------------------
    # 2. USER WORKLOAD & "WHAT IS [NAME] WORKING ON?"
    # -------------------------------------------------------------------------
    # Check if a user's name is in the query
    target_user = None
    if "my task" in lower or "assigned to me" in lower or "what am i working on" in lower:
        target_user = user
    else:
        # Check against project members
        for u in User.objects.all():
            if len(u.username) >= 3 and u.username.lower() in lower:
                target_user = u
                break
            if u.first_name and len(u.first_name) >= 3 and u.first_name.lower() in lower:
                target_user = u
                break

    if target_user:
        user_tasks = issues_qs.filter(assignee=target_user)
        u_count = user_tasks.count()
        u_done = user_tasks.filter(status="DONE").count()
        u_prog = user_tasks.filter(status="IN_PROGRESS").count()
        u_todo = user_tasks.filter(status="TODO").count()

        if u_count == 0:
            reply = (
                f"### Workload Briefing: {target_user.username}\n\n"
                f"**{target_user.username}** currently has **0 tasks assigned** in project **{project.name}**.\n\n"
                f"There are currently **{unassigned_count} unassigned tasks** in the tracker. "
                f"You can ask me: `Assign task [name or ID] to {target_user.username}` to assign work."
            )
        else:
            task_lines = []
            for t in user_tasks[:10]:
                deadline_str = f" | Due: {t.due_date}" if t.due_date else ""
                task_lines.append(f"- **[{project.key}-{t.id}] {t.title}** ({t.status} | {t.priority}{deadline_str})")

            reply = (
                f"### Workload Briefing: {target_user.username}\n\n"
                f"**{target_user.username}** has **{u_count} task(s)** assigned "
                f"({u_done} Done, {u_prog} In Progress, {u_todo} To Do):\n\n"
                + "\n".join(task_lines)
            )
            if u_count > 10:
                reply += f"\n\n*...and {u_count - 10} more tasks.*"
        return {"type": "ANSWER", "reply": reply, "citations": [f"User:{target_user.username}"]}

    # -------------------------------------------------------------------------
    # 3. DEADLINES & OVERDUE TASKS
    # -------------------------------------------------------------------------
    if any(k in lower for k in ["deadline", "due date", "due this week", "overdue", "upcoming"]):
        today = datetime.date.today()
        tasks_with_dates = issues_qs.filter(due_date__isnull=False).order_by("due_date")
        overdue_tasks = tasks_with_dates.filter(due_date__lt=today).exclude(status="DONE")
        upcoming_tasks = tasks_with_dates.filter(due_date__gte=today)[:10]

        reply = f"### Timeline & Deadlines for {project.name}\n\n"
        if overdue_tasks.exists():
            reply += f"**Overdue Tasks ({overdue_tasks.count()}):**\n"
            for t in overdue_tasks[:5]:
                reply += f"- **[{project.key}-{t.id}] {t.title}** -- Overdue since **{t.due_date}** (Assignee: {t.assignee.username if t.assignee else 'Unassigned'})\n"
            reply += "\n"
        else:
            reply += "No overdue tasks currently in the tracker.\n\n"

        if upcoming_tasks.exists():
            reply += f"**Upcoming Deadlines:**\n"
            for t in upcoming_tasks:
                reply += f"- **[{project.key}-{t.id}] {t.title}** -- Due: **{t.due_date}** (Status: {t.status})\n"
        else:
            reply += "No upcoming deadlines explicitly set on open tasks."

        return {"type": "ANSWER", "reply": reply, "citations": ["Deadlines"]}

    # -------------------------------------------------------------------------
    # 4. RISKS & BLOCKERS
    # -------------------------------------------------------------------------
    if any(k in lower for k in ["risk", "blocker", "critical", "impediment"]):
        blocker_signals = [s for s in signals if s.category == "BLOCKER"]
        risk_signals = [s for s in signals if s.category == "RISK"]
        crit_issues = issues_qs.filter(priority="CRITICAL").exclude(status="DONE")

        reply = f"### Risk & Blocker Assessment for {project.name}\n\n"
        if blocker_signals:
            reply += "**Active Blockers:**\n"
            for s in blocker_signals[:5]:
                reply += f"- [BLOCKER] **{s.title}** (Severity: {s.severity})\n"
            reply += "\n"

        if crit_issues.exists():
            reply += f"**Critical Priority Tasks ({crit_issues.count()}):**\n"
            for ci in crit_issues[:5]:
                reply += f"- [CRITICAL] **[{project.key}-{ci.id}] {ci.title}** (Status: {ci.status}, Assignee: {ci.assignee.username if ci.assignee else 'Unassigned'})\n"
            reply += "\n"

        if risk_signals:
            reply += "**Identified Project Risks:**\n"
            for s in risk_signals[:5]:
                reply += f"- [RISK] **{s.title}** (Status: {s.status})\n"

        if not blocker_signals and not crit_issues.exists() and not risk_signals:
            reply += "No active critical blockers or high-severity risks currently recorded."

        return {"type": "ANSWER", "reply": reply, "citations": ["Signals & Risks"]}

    # -------------------------------------------------------------------------
    # 5. WORKSTREAMS & MODULES
    # -------------------------------------------------------------------------
    if any(k in lower for k in ["workstream", "workstreams", "modules", "zoho", "database"]):
        ws_counts = (
            issues_qs.values("workstream")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        reply = f"### Workstreams in {project.name}\n\n"
        if ws_counts:
            for item in ws_counts:
                name = item["workstream"] or "General / Core"
                c = item["count"]
                ws_done = issues_qs.filter(workstream=item["workstream"], status="DONE").count()
                reply += f"- **{name}**: {c} tasks ({ws_done} completed)\n"
        else:
            reply += "No distinct workstreams recorded yet."
        return {"type": "ANSWER", "reply": reply, "citations": ["Workstreams"]}

    # -------------------------------------------------------------------------
    # 6. SPECIFIC TASK LOOKUP (e.g. ACT-23, Closure Document)
    # -------------------------------------------------------------------------
    m_key = re.search(rf'\b{project.key}-(\d+)\b', user_message, flags=re.I)
    if m_key:
        issue_id = int(m_key.group(1))
        match_issue = issues_qs.filter(id=issue_id).first()
        if match_issue:
            reply = (
                f"### Task Details: [{project.key}-{match_issue.id}] {match_issue.title}\n\n"
                f"- **Status**: `{match_issue.status}`\n"
                f"- **Priority**: `{match_issue.priority}`\n"
                f"- **Assignee**: {match_issue.assignee.username if match_issue.assignee else 'Unassigned'}\n"
                f"- **Reporter**: {match_issue.reporter.username if match_issue.reporter else 'System'}\n"
                f"- **Deadline**: {match_issue.due_date if match_issue.due_date else 'Not set'}\n"
                f"- **Workstream**: {match_issue.workstream if match_issue.workstream else 'General'}\n"
                f"- **Description**: {match_issue.description or 'No description provided.'}\n"
            )
            return {"type": "ANSWER", "reply": reply, "citations": [f"{project.key}-{match_issue.id}"]}

    # -------------------------------------------------------------------------
    # 7. DEFAULT: EXECUTIVE HEALTH BRIEFING & STATUS
    # -------------------------------------------------------------------------
    reply = (
        f"### {project.name} Executive Status Briefing\n\n"
        f"- **Project Key**: `{project.key}`\n"
        f"- **Health Status**: **{summary.health_status if summary else 'ON_TRACK'}**\n"
        f"- **Active Phase**: {summary.current_phase if summary else 'Active Execution'}\n"
        f"- **Completion Rate**: **{pct}%** ({done_count} of {total_issues} tasks done)\n"
        f"- **Active Development**: {in_prog_count} In Progress, {todo_count} To Do\n"
        f"- **Critical Issues**: {critical_count} Critical, {high_count} High\n"
        f"- **Unassigned Tasks**: {unassigned_count}\n"
    )

    if len(ranked_delivs) > 0 and total_issues == 0:
        reply += (
            f"\n> **Notice**: {len(ranked_delivs)} document deliverables are available to import. "
            f"Click **'Import Docs'** in the top bar to synchronize them."
        )

    reply += (
        f"\n\n**Things you can ask me:**\n"
        f"- `What is [User] working on?`\n"
        f"- `What are the active risks and blockers?`\n"
        f"- `What tasks are due this week?`\n"
        f"- `How do I export to Excel or CSV?`\n"
        f"- `Create task [Name] assigned to [User] due [Date]`\n"
        f"- `Mark [ACT-ID] as Done`"
    )

    return {"type": "ANSWER", "reply": reply, "citations": ["Project Status"]}


# ---------------------------------------------------------------------------
# Main Orchestrator: AI Assistant Query Dispatcher
# ---------------------------------------------------------------------------

def handle_assistant_query(project: Project, user: Any, user_message: str) -> Dict[str, Any]:
    """
    Main entry point for NEXO AI Assistant.
    Evaluates intent, attempts external LLM inference if credentials exist,
    and falls back seamlessly to deterministic AI extraction and knowledge retrieval.
    """
    msg = user_message.strip()
    if not msg:
        return {"error": "Message is required."}

    lower_msg = msg.lower()

    # Detect update or assignment intent on existing task
    is_status_update = any(w in lower_msg for w in ["mark", "move", "set", "change", "update", "transition", "close", "complete"]) and any(s in lower_msg for s in ["done", "completed", "in progress", "todo", "to do", "closed", "status"])
    is_assign_update = "assign" in lower_msg or "reassign" in lower_msg

    if is_status_update or is_assign_update:
        # Check for update proposal
        m_key = re.search(rf'\b{project.key}-(\d+)\b', msg, flags=re.I)
        target_issue = None
        if m_key:
            target_issue = project.issues.filter(id=int(m_key.group(1))).first()
        else:
            # Match by title substring
            for i in project.issues.all():
                if len(i.title) > 3 and i.title.lower() in lower_msg:
                    target_issue = i
                    break

        if target_issue:
            # Check what's being updated
            fields = {}
            desc_parts = []
            if any(d in lower_msg for d in ["done", "completed", "finish", "close"]):
                fields["status"] = "DONE"
                desc_parts.append(f"Change status to 'DONE'")
            elif any(p in lower_msg for p in ["in progress", "active", "start"]):
                fields["status"] = "IN_PROGRESS"
                desc_parts.append(f"Change status to 'IN_PROGRESS'")
            elif "todo" in lower_msg or "to do" in lower_msg:
                fields["status"] = "TODO"
                desc_parts.append(f"Change status to 'TODO'")

            # Check assignee update
            m_assign = re.search(r'\b(?:and\s+)?assign(?:\s+it)?\s+to\s+([a-zA-Z0-9_\s]+)', msg, flags=re.I)
            if m_assign:
                new_user = resolve_user_by_name(project, m_assign.group(1).strip())
                if new_user:
                    fields["assignee_id"] = new_user.id
                    fields["assignee_name"] = new_user.username
                    desc_parts.append(f"Assign to {new_user.username}")

            if fields:
                return {
                    "type": "PROPOSAL",
                    "reply": (
                        f"I've prepared a status update proposal for **[{project.key}-{target_issue.id}] {target_issue.title}**. "
                        f"Please review and confirm to apply the update:"
                    ),
                    "proposal": {
                        "action": "UPDATE_ISSUE",
                        "target_issue_id": target_issue.id,
                        "target_issue_key": f"{project.key}-{target_issue.id}",
                        "fields": fields,
                        "description": f"{', '.join(desc_parts)} for [{project.key}-{target_issue.id}].",
                    },
                    "citations": [f"{project.key}-{target_issue.id}"],
                }

    # 2. Check if user wants to create a new task
    is_create_task = any(k in lower_msg for k in [
        "create task", "add task", "new task", "create issue", "add issue",
        "make a task", "draft a task", "new ticket", "create ticket",
        "create a task", "add a task", "draft task"
    ]) or (any(w in lower_msg for w in ["create", "add", "draft", "make"]) and any(t in lower_msg for t in ["task", "issue", "ticket", "work item"]))

    if is_create_task:
        extracted = extract_task_creation_parameters(msg, project, user)
        clean_title = extracted["title"]

        # Ambiguous assignee check: prompt clarification
        if extracted.get("assignee_ambiguous"):
            candidates_str = ", ".join(f"**{c}**" for c in extracted["assignee_candidates"])
            return {
                "type": "ANSWER",
                "reply": (
                    f"I found multiple team members matching '**{extracted['assignee_query']}**': {candidates_str}.\n\n"
                    f"Which team member would you like to assign this task to?"
                ),
                "citations": [],
            }

        proposal_fields = {
            "title": clean_title,
            "status": extracted["status"],
            "priority": extracted["priority"],
            "issue_type": extracted["issue_type"],
            "workstream": extracted["workstream"],
            "assignee_id": extracted["assignee_id"],
            "assignee_name": extracted["assignee_name"],
            "due_date": extracted["due_date"],
        }

        assignee_display = f" assigned to **{extracted['assignee_name']}**" if extracted["assignee_name"] else ""
        date_display = f" with deadline **{extracted['due_date']}**" if extracted["due_date"] else ""
        priority_display = f" [{extracted['priority']} Priority]"
        workstream_display = f" in workstream **{extracted['workstream']}**" if extracted["workstream"] else ""

        unknown_note = (
            f"\n\n*(Note: User '**{extracted['assignee_query']}**' was not found in registered project members, so this task is currently unassigned.)*"
            if extracted.get("assignee_unknown")
            else ""
        )

        reply_text = (
            f"I have drafted a new task proposal: **{clean_title}**{assignee_display}{date_display}{workstream_display}{priority_display}.{unknown_note}\n\n"
            f"Please review the details below and click **'Approve & Execute'** to add it to your project tracker:"
        )

        return {
            "type": "PROPOSAL",
            "reply": reply_text,
            "proposal": {
                "action": "CREATE_ISSUE",
                "target_issue_id": None,
                "target_issue_key": None,
                "fields": proposal_fields,
                "description": extracted["description"],
            },
            "citations": [],
        }

    # 3. Informational queries about the project or tool
    return answer_project_or_tool_query(project, user, msg)
