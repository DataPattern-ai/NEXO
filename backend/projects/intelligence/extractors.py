import datetime
import re
from typing import Any, Dict, List, Optional
from .parsers import ParsedDocument, DocumentSection


def parse_date_str(text: str) -> Optional[datetime.date]:
    """Tries to extract standard ISO or common date formats."""
    # 2026-10-24 or 2026/10/24
    iso_match = re.search(r"\b(202\d)[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b", text)
    if iso_match:
        try:
            return datetime.date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
        except ValueError:
            pass

    # Oct 24, 2026 or 24 Oct 2026
    month_match = re.search(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(202\d)\b",
        text,
        re.IGNORECASE,
    )
    if month_match:
        m_str, d_str, y_str = month_match.groups()
        month_map = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
        }
        m_num = month_map.get(m_str[:3].lower(), 1)
        try:
            return datetime.date(int(y_str), m_num, int(d_str))
        except ValueError:
            pass
    return None


def clean_bullet_text(line: str) -> str:
    """Strips bullet markers (- *, •, 1.) and markdown bolding."""
    cleaned = re.sub(r"^[\s*•\-#\d\.)]+", "", line).strip()
    return cleaned


def extract_row_and_text(line: str, base_location: str):
    """Extracts row number tags if present, e.g. [Row 3] Line text -> (Line text, base_location, Row 3)."""
    m = re.match(r"^\[Row\s*(\d+)\]\s*(.*)$", line)
    if m:
        row_num = m.group(1)
        text = m.group(2)
        loc = f"{base_location}, Row {row_num}"
        return text, loc
    return line, base_location


def is_header_row(text: str) -> bool:
    """Detects whether a table or spreadsheet line is merely column headers."""
    t_lower = text.lower()
    headers = [
        "milestone name", "target date", "completion date", "risk description",
        "severity |", "category |", "owner |", "status |", "workstream |",
        "phase |", "action item |", "mitigation |", "impact |"
    ]
    matches = sum(1 for h in headers if h in t_lower)
    return matches >= 2 or any(h in t_lower for h in ["milestone name", "risk description", "action item |"])


def split_tabular_title_desc(text: str):
    """Splits tabular delimited rows into a concise title and detailed description."""
    if "|" in text:
        parts = [p.strip() for p in text.split("|") if p.strip()]
        if parts:
            title = parts[0]
            desc = " | ".join(parts[1:]) if len(parts) > 1 else text
            return title, desc
    return text, text


def extract_signals_from_parsed_doc(
    parsed: ParsedDocument, doc_type: str, doc_title: str
) -> List[Dict[str, Any]]:
    """
    Context-aware signal extraction:
    Extracts structured project signals (Phase, Milestone, Risk, Blocker, Challenge,
    Dependency, Update, Decision, Resource Note) based on the classified document type.
    """
    signals = []

    # Helper to push a signal with defaults
    def add_signal(category, title, desc="", severity="MEDIUM", status="ACTIVE", location="", date_val=None, target_date=None, conf=0.85):
        if not title or len(title.strip()) < 4:
            return
        effective_date = target_date or date_val
        signals.append({
            "category": category,
            "title": title.strip()[:290],
            "description": (desc or "").strip(),
            "severity": severity,
            "status": status,
            "source_location": location or doc_title,
            "target_date": effective_date,
            "confidence": conf,
        })


    # If rich structured excel metadata is present, extract directly with maximum fidelity
    s_excel = parsed.metadata.get("structured_excel")
    if s_excel:
        _extract_from_structured_excel(s_excel, doc_title, add_signal)
    elif doc_type == "STATUS":
        _extract_status_report(parsed, doc_title, add_signal)
    elif doc_type == "TIMELINE":
        _extract_timeline_plan(parsed, doc_title, add_signal)
    elif doc_type == "RESOURCE":
        _extract_resource_doc(parsed, doc_title, add_signal)
    elif doc_type == "ARCHITECTURE":
        _extract_architecture_doc(parsed, doc_title, add_signal)
    elif doc_type == "MEETING":
        _extract_meeting_notes(parsed, doc_title, add_signal)
    elif doc_type == "RETRO":
        _extract_retro_doc(parsed, doc_title, add_signal)
    elif doc_type == "PRD":
        _extract_prd_doc(parsed, doc_title, add_signal)
    else:
        # Custom or generic document: look for general headings
        _extract_generic_doc(parsed, doc_title, add_signal)

    # Intra-document deduplication: prevent duplicate signals within this document
    deduped_signals = []
    seen = set()
    for s in signals:
        key = (s["category"], " ".join(s["title"].split()).lower())
        if key not in seen:
            seen.add(key)
            deduped_signals.append(s)

    return deduped_signals


def _extract_from_structured_excel(s_excel: Dict[str, Any], doc_title: str, add_signal):
    """
    Extracts high-fidelity signals from structured Excel data:
    - Phases and progress
    - Milestones and target dates
    - Risks and Blockers with severity
    - Technical and schedule dependencies
    - Team resource allocations
    - Key status updates
    """
    # 1. Phases
    for p in s_excel.get("phases", []):
        p_name = p.get("name")
        if p_name and len(p_name) >= 3:
            add_signal(
                category="PHASE",
                title=p_name,
                desc=f"Progress: {p.get('percent', 0)}% ({p.get('done', 0)}/{p.get('total', 0)} tasks complete)",
                status=p.get("status", "ACTIVE"),
                location=f"{doc_title} (Phase)",
                conf=0.95,
            )

    # 2. Milestones
    for m in s_excel.get("milestones", []):
        m_title = m.get("title")
        if m_title and len(m_title) >= 3:
            w_stream = m.get("workstream", "General")
            owner = m.get("owner", "Unassigned")
            add_signal(
                category="MILESTONE",
                title=m_title,
                desc=f"Workstream: {w_stream} | Owner: {owner}",
                status=m.get("status", "ACTIVE"),
                target_date=m.get("target_date"),
                location=m.get("source_location", doc_title),
                conf=0.92,
            )

    # 3. Risks & Blockers
    for r in s_excel.get("risks", []):
        r_title = r.get("title")
        if r_title and len(r_title) >= 4:
            cat = r.get("type", "RISK")
            sev = r.get("severity", "MEDIUM")
            owner = r.get("owner", "")
            desc = r.get("description", "") or (f"Owner: {owner}" if owner else "")
            add_signal(
                category=cat,
                title=r_title,
                desc=desc,
                severity=sev,
                status=r.get("status", "ACTIVE"),
                location=r.get("source_location", doc_title),
                conf=0.92,
            )

    # 4. Dependencies
    for d in s_excel.get("dependencies", []):
        d_title = d.get("title")
        if d_title and len(d_title) >= 4:
            add_signal(
                category="DEPENDENCY",
                title=d_title,
                severity="HIGH",
                status="ACTIVE",
                location=d.get("source_location", doc_title),
                conf=0.90,
            )

    # 5. Team Allocations (top members)
    for tm in s_excel.get("team_members", [])[:8]:
        name = tm.get("name")
        if name and len(name) >= 2:
            tasks_sample = ", ".join(tm.get("tasks", [])[:4])
            add_signal(
                category="RESOURCE_NOTE",
                title=f"{name}: {tm.get('total', 0)} assigned task(s)",
                desc=f"Completed: {tm.get('done', 0)}, Tasks: {tasks_sample}",
                location=f"{doc_title} (Resource Allocation)",
                conf=0.88,
            )

    # 6. Completed / In Progress Updates (sample of delivered work items)
    tasks = s_excel.get("tasks", [])
    completed_tasks = [t for t in tasks if t.get("status") == "COMPLETED"][:6]
    for ct in completed_tasks:
        add_signal(
            category="UPDATE",
            title=f"Completed: {ct['title']}",
            desc=f"Phase: {ct.get('phase', 'General')} | Owner: {ct.get('assignee', 'Unassigned')}",
            status="COMPLETED",
            location=ct.get("source_location", doc_title),
            conf=0.85,
        )



def _extract_status_report(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        h_lower = sec.heading.lower()
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        # Identify category by section heading
        is_blocker = any(k in h_lower for k in ["blocker", "impediment", "obstacle", "critical issue"])
        is_risk = any(k in h_lower for k in ["risk", "concern", "potential issue"])
        is_challenge = any(k in h_lower for k in ["challenge", "problem", "delay"])
        is_completed = any(k in h_lower for k in ["accomplishment", "completed", "done", "achieved", "what we did"])
        is_current = any(k in h_lower for k in ["in progress", "current work", "active", "focus"])
        is_phase = any(k in h_lower for k in ["current phase", "phase", "stage"])

        for line in lines:
            line_text, loc = extract_row_and_text(line, sec.location)
            bullet = clean_bullet_text(line_text)
            if not bullet or len(bullet) < 5 or is_header_row(bullet):
                continue

            date_val = parse_date_str(bullet)
            title, desc = split_tabular_title_desc(bullet)

            if is_blocker:
                add_signal("BLOCKER", title, desc=desc, severity="CRITICAL", status="ACTIVE", location=loc, date_val=date_val, conf=0.92)
            elif is_risk:
                sev = "HIGH" if any(w in bullet.lower() for w in ["critical", "high", "severe", "major"]) else "MEDIUM"
                add_signal("RISK", title, desc=desc, severity=sev, status="ACTIVE", location=loc, date_val=date_val, conf=0.90)
            elif is_challenge:
                add_signal("CHALLENGE", title, desc=desc, severity="MEDIUM", status="ACTIVE", location=loc, date_val=date_val, conf=0.85)
            elif is_completed:
                add_signal("UPDATE", f"Completed: {title}", desc=desc, status="COMPLETED", location=loc, date_val=date_val, conf=0.88)
            elif is_current:
                add_signal("UPDATE", f"In Progress: {title}", desc=desc, status="IN_PROGRESS", location=loc, date_val=date_val, conf=0.88)
            elif is_phase:
                add_signal("PHASE", title, desc=desc or f"Active project phase noted in {doc_title}", status="ACTIVE", location=loc, conf=0.95)
            else:
                # Line-level keywords
                b_lower = bullet.lower()
                if "blocker" in b_lower:
                    add_signal("BLOCKER", title, desc=desc, severity="CRITICAL", location=loc, conf=0.85)
                elif "risk" in b_lower:
                    add_signal("RISK", title, desc=desc, severity="HIGH", location=loc, conf=0.85)
                elif "completed" in b_lower or "launched" in b_lower:
                    add_signal("UPDATE", title, desc=desc, status="COMPLETED", location=loc, conf=0.80)


def _extract_timeline_plan(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        for r_idx, line in enumerate(lines, start=1):
            line_text, loc = extract_row_and_text(line, sec.location)
            clean_line = clean_bullet_text(line_text)
            if not clean_line or len(clean_line) < 5 or is_header_row(clean_line):
                continue

            date_val = parse_date_str(clean_line)
            title, desc = split_tabular_title_desc(clean_line)
            l_lower = clean_line.lower()

            # Check if line denotes a Phase or a Milestone
            if "phase" in l_lower or "workstream" in l_lower or "stage" in l_lower:
                status = "COMPLETED" if "complete" in l_lower or "done" in l_lower else "ACTIVE"
                add_signal("PHASE", title, desc=desc, status=status, location=loc, date_val=date_val, conf=0.90)
            elif any(k in l_lower for k in ["milestone", "release", "go-live", "launch", "delivery", "sprint"]):
                status = "COMPLETED" if "complete" in l_lower or "done" in l_lower else "ACTIVE"
                sev = "HIGH" if "go-live" in l_lower or "release" in l_lower else "MEDIUM"
                add_signal("MILESTONE", title, desc=desc, severity=sev, status=status, location=loc, date_val=date_val, conf=0.92)
            elif date_val:
                # Lines with dates in a timeline document are usually milestones or deliverables
                add_signal("MILESTONE", title, desc=desc, status="ACTIVE", location=loc, date_val=date_val, conf=0.80)

            # Check for dependencies in timeline
            if any(k in l_lower for k in ["depends on", "dependency", "blocked by", "prerequisite"]):
                add_signal("DEPENDENCY", title, desc=desc, severity="HIGH", location=loc, conf=0.88)


def _extract_resource_doc(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]
        for line in lines:
            line_text, loc = extract_row_and_text(line, sec.location)
            clean_line = clean_bullet_text(line_text)
            if not clean_line or len(clean_line) < 5 or is_header_row(clean_line):
                continue
            title, desc = split_tabular_title_desc(clean_line)
            l_lower = clean_line.lower()
            if any(k in l_lower for k in ["allocation", "fte", "role", "lead", "engineer", "designer", "shared with", "capacity"]):
                add_signal("RESOURCE_NOTE", title, desc=desc, location=loc, conf=0.85)
            elif any(k in l_lower for k in ["bottleneck", "constraint", "shortage", "unavailable"]):
                add_signal("CHALLENGE", title, desc=desc, severity="HIGH", location=loc, conf=0.88)


def _extract_architecture_doc(parsed: ParsedDocument, doc_title: str, add_signal):
    """
    Architecture / System Design documents:
    Extracts decisions, technical dependencies, constraints, objectives, and technical roles.
    Does NOT treat system design as project status.
    """
    for sec in parsed.sections:
        h_lower = sec.heading.lower()
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        is_decision = any(k in h_lower for k in ["decision", "technology", "rationale", "chosen", "stack", "tech"])
        is_dep = any(k in h_lower for k in ["dependency", "integration", "third party", "external api", "services", "endpoint"])
        is_constraint = any(k in h_lower for k in ["constraint", "risk", "scalability", "limitation", "security"])
        is_obj = any(k in h_lower for k in ["objective", "goal", "scope", "hub", "deliverable"])
        is_contrib = any(k in h_lower for k in ["contributor", "lead", "role", "team", "author"])

        for line in lines:
            line_text, loc = extract_row_and_text(line, sec.location)
            clean_line = clean_bullet_text(line_text)
            if not clean_line or len(clean_line) < 6 or is_header_row(clean_line):
                continue
            title, desc = split_tabular_title_desc(clean_line)

            if is_decision or any(k in clean_line.lower() for k in ["tech stack", "database:", "framework:"]):
                add_signal("DECISION", title, desc=desc, location=loc, conf=0.88)
            elif is_dep or "api" in clean_line.lower() or "service" in clean_line.lower():
                add_signal("DEPENDENCY", title, desc=desc, severity="MEDIUM", location=loc, conf=0.90)
            elif is_constraint:
                add_signal("RISK", title, desc=desc, severity="HIGH", location=loc, conf=0.85)
            elif is_contrib or "lead:" in clean_line.lower():
                add_signal("RESOURCE_NOTE", title, desc=desc, location=loc, conf=0.88)
            elif is_obj:
                add_signal("UPDATE", f"Scope: {title}", desc=desc, status="ACTIVE", location=loc, conf=0.85)


def _extract_meeting_notes(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        h_lower = sec.heading.lower()
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        is_decision = any(k in h_lower for k in ["decision", "agreed", "resolution", "outcome"])
        is_action = any(k in h_lower for k in ["action item", "todo", "next steps", "follow up"])
        is_blocker = any(k in h_lower for k in ["blocker", "risk", "issue"])

        for line in lines:
            line_text, loc = extract_row_and_text(line, sec.location)
            clean_line = clean_bullet_text(line_text)
            if not clean_line or len(clean_line) < 5 or is_header_row(clean_line):
                continue
            date_val = parse_date_str(clean_line)
            title, desc = split_tabular_title_desc(clean_line)

            if is_decision:
                add_signal("DECISION", title, desc=desc, location=loc, conf=0.90)
            elif is_blocker:
                add_signal("BLOCKER", title, desc=desc, severity="CRITICAL", location=loc, conf=0.88)
            elif is_action:
                add_signal("UPDATE", f"Action: {title}", desc=desc, status="ACTIVE", location=loc, date_val=date_val, conf=0.82)


def _extract_retro_doc(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        h_lower = sec.heading.lower()
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        is_good = any(k in h_lower for k in ["what went well", "positives", "wins"])
        is_improve = any(k in h_lower for k in ["improved", "didn't go well", "issues", "pain points"])
        is_action = any(k in h_lower for k in ["action item", "next sprint commitments"])

        for line in lines:
            line_text, loc = extract_row_and_text(line, sec.location)
            clean_line = clean_bullet_text(line_text)
            if not clean_line or len(clean_line) < 5 or is_header_row(clean_line):
                continue
            title, desc = split_tabular_title_desc(clean_line)

            if is_good:
                add_signal("UPDATE", f"Team Win: {title}", desc=desc, status="COMPLETED", location=loc, conf=0.80)
            elif is_improve:
                add_signal("CHALLENGE", title, desc=desc, severity="MEDIUM", location=loc, conf=0.85)
            elif is_action:
                add_signal("UPDATE", f"Retro Action: {title}", desc=desc, status="ACTIVE", location=loc, conf=0.85)


def _extract_prd_doc(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        h_lower = sec.heading.lower()
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]

        is_req = any(k in h_lower for k in ["functional requirement", "scope", "feature", "user story"])
        is_kpi = any(k in h_lower for k in ["kpi", "performance", "metric", "success"])
        is_milestone = any(k in h_lower for k in ["milestone", "release", "timeline"])
        is_dep = any(k in h_lower for k in ["dependency", "external integration"])

        for line in lines:
            clean_line = clean_bullet_text(line)
            if not clean_line or len(clean_line) < 5:
                continue
            loc = sec.location
            date_val = parse_date_str(clean_line)

            if is_milestone:
                add_signal("MILESTONE", clean_line, location=loc, date_val=date_val, conf=0.88)
            elif is_req:
                add_signal("MILESTONE", f"Requirement: {clean_line}", desc=clean_line, location=loc, conf=0.85)
            elif is_kpi:
                add_signal("UPDATE", f"Target KPI: {clean_line}", desc=clean_line, location=loc, conf=0.85)
            elif is_dep:
                add_signal("DEPENDENCY", clean_line, severity="MEDIUM", location=loc, conf=0.85)


def _extract_generic_doc(parsed: ParsedDocument, doc_title: str, add_signal):
    for sec in parsed.sections:
        lines = [line.strip() for line in sec.content.splitlines() if line.strip()]
        for line in lines:
            clean_line = clean_bullet_text(line)
            l_lower = clean_line.lower()
            if "blocker" in l_lower:
                add_signal("BLOCKER", clean_line, severity="CRITICAL", location=sec.location)
            elif "risk" in l_lower:
                add_signal("RISK", clean_line, severity="HIGH", location=sec.location)
            elif "milestone" in l_lower:
                add_signal("MILESTONE", clean_line, location=sec.location)
