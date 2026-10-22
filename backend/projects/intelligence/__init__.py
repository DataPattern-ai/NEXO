import hashlib
from typing import Any, Dict
from django.db import transaction

from projects.models import Project, ProjectDoc, ProjectSignal
from .ai_provider import ai_classify_document
from .classifier import classify_document
from .extractors import extract_signals_from_parsed_doc
from .parsers import parse_uploaded_file
from .synthesizer import generate_project_intelligence


def calculate_file_hash(file_obj=None, content="") -> str:
    """Computes a canonical SHA-256 hash of file content or text for deduplication and versioning."""
    hasher = hashlib.sha256()
    if file_obj:
        if hasattr(file_obj, "chunks"):
            for chunk in file_obj.chunks():
                hasher.update(chunk)
            if hasattr(file_obj, "seek"):
                file_obj.seek(0)
        elif hasattr(file_obj, "read"):
            pos = file_obj.tell() if hasattr(file_obj, "tell") else 0
            while True:
                chunk = file_obj.read(8192)
                if not chunk:
                    break
                hasher.update(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8"))
            if hasattr(file_obj, "seek"):
                file_obj.seek(pos)
        elif isinstance(file_obj, bytes):
            hasher.update(file_obj)
    if content:
        hasher.update(content.encode("utf-8"))
    return hasher.hexdigest()


def process_and_extract_document(doc: ProjectDoc) -> Dict[str, Any]:
    """
    End-to-end document processing pipeline:
    1. Parse file or markdown text content
    2. Understand & classify document type if needed
    3. Extract context-aware project signals (Risks, Blockers, Milestones, Decisions, Updates)
    4. Save normalized ProjectSignal records with source traceability
    5. Update project intelligence summary
    """
    file_obj = doc.file if doc.file else doc.content
    filename = doc.file.name if doc.file else f"{doc.title}.md"

    # Step 1: Parse
    parsed = parse_uploaded_file(file_obj, filename=filename)

    # Step 2: AI Document Classification & Understanding
    user_specified_template = doc.template_type and doc.template_type != ProjectDoc.TemplateType.CUSTOM
    if user_specified_template:
        ai_classification = {
            "template_type": doc.template_type,
            "purpose": f"User-designated {doc.get_template_type_display()}",
            "reasoning": "Explicitly selected by project member during upload.",
            "confidence": 1.0,
            "ai_telemetry": {"status": "EXPLICIT_SELECTION", "latency_ms": 0, "error": None},
        }
    else:
        ai_classification = ai_classify_document(
            title=doc.title,
            text_sample=parsed.raw_text[:3000],
            file_type=parsed.file_type,
        )
        if ai_classification.get("confidence", 0) >= 0.8 and ai_classification.get("template_type") != "CUSTOM":
            doc.template_type = ai_classification["template_type"]

    # Attach AI understanding & audit manifest to parsed document metadata
    audit_manifest = parsed.metadata.get("audit_manifest") or {}
    audit_manifest["ai_understanding"] = {
        "purpose": ai_classification.get("purpose"),
        "reasoning": ai_classification.get("reasoning"),
        "confidence": ai_classification.get("confidence"),
        "telemetry": ai_classification.get("ai_telemetry"),
    }
    parsed.metadata["audit_manifest"] = audit_manifest

    # Compute hash if missing
    if not doc.file_hash:
        doc.file_hash = calculate_file_hash(file_obj=doc.file if doc.file else None, content=doc.content)

    # Update doc metadata
    doc.raw_text = parsed.raw_text[:50000]  # Store first 50k chars of parsed text
    doc.file_type = parsed.file_type
    if doc.file:
        try:
            doc.file_size = doc.file.size
        except Exception:
            pass
    doc.save(update_fields=["template_type", "raw_text", "file_type", "file_size", "file_hash"])


    # Step 3 & 4: Extract and Save Signals in transaction
    raw_signals = extract_signals_from_parsed_doc(
        parsed=parsed, doc_type=doc.template_type, doc_title=doc.title
    )

    with transaction.atomic():
        # Remove previously extracted signals from this document to avoid duplicates
        ProjectSignal.objects.filter(source_doc=doc).delete()

        created_signals = []
        for s in raw_signals:
            created_signals.append(
                ProjectSignal(
                    project=doc.project,
                    source_doc=doc,
                    category=s["category"],
                    title=s["title"],
                    description=s.get("description", ""),
                    status=s.get("status", "ACTIVE"),
                    severity=s.get("severity", "MEDIUM"),
                    target_date=s.get("target_date"),
                    source_location=s.get("source_location", doc.title),
                    confidence=s.get("confidence", 0.85),
                )
            )
        if created_signals:
            ProjectSignal.objects.bulk_create(created_signals)

    # Step 5: Update project intelligence summary with forced refresh,
    # passing in-memory parsed doc to avoid redundant re-parsing from disk
    intelligence_payload = generate_project_intelligence(
        doc.project,
        force_refresh=True,
        parsed_doc_override={doc.id: parsed},
    )
    return intelligence_payload
