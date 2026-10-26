"""
Calendar notifications.

* notify_added()   — right away: "you were added to ..." (the day it's assigned / mentioned)
* process_due()    — on the day: "it's today" for the creator and everyone involved

process_due() is idempotent: each entry is "claimed" with an atomic UPDATE before anything is
sent, so it is safe to call from a background thread, a cron job or several servers at once.
"""
import re
from datetime import datetime, time as dt_time, timedelta
from html import escape
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from users.access import has_project_access
from users.models import Notification
from users.utils import get_default_from_email, get_frontend_url, send_mail_background

from .models import CalendarEntry

MENTION_RE = re.compile(r"@([\w]+)")
CATCH_UP_DAYS = 2  # if the server was down, still send entries that were due within the last couple of days


def reminder_tz():
    return ZoneInfo(settings.REMINDER_TIME_ZONE)


def local_today():
    return timezone.now().astimezone(reminder_tz()).date()


def due_at(entry):
    """The moment the entry's "today" notification should go out (default hour if no time was set)."""
    when = entry.time or dt_time(settings.REMINDER_DEFAULT_HOUR, 0)
    return datetime.combine(entry.date, when, tzinfo=reminder_tz())


def mentioned_users(text, project):
    """Active project members @mentioned in `text`."""
    User = get_user_model()
    found = []
    for name in sorted(set(MENTION_RE.findall(text or ""))):
        user = User.objects.filter(username__iexact=name, is_active=True).first()
        if user and has_project_access(user, project):
            found.append(user)
    return found


def _when_text(entry):
    day = entry.date.strftime("%A, %d %B %Y")
    return f"{day} at {entry.time.strftime('%H:%M')}" if entry.time else day


def _link(entry, user):
    """Project calendar for people who can open the project; otherwise their dashboard."""
    base = get_frontend_url()
    if has_project_access(user, entry.project):
        return f"{base}/projects/{entry.project_id}/board?tab=calendar"
    return f"{base}/dashboard"


def _send(user, entry, subject, headline, intro):
    """One styled email. Never raises — a mail problem must not break saving or the scheduler."""
    if not user.email:
        return False
    name = user.get_full_name() or user.username
    kind = entry.get_kind_display()
    notes = f"<p style='color:#42526E;font-size:14px;line-height:1.5'>{escape(entry.description)}</p>" if entry.description else ""
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; border: 1px solid #DFE1E6; border-radius: 10px; overflow: hidden;">
      <div style="background: linear-gradient(135deg,#0052CC,#6554C0); padding: 16px 24px; color:#fff; font-weight:800; letter-spacing:1px;">NEXO</div>
      <div style="padding: 24px;">
        <h3 style="color:#172B4D;margin:0 0 8px">{escape(headline)}</h3>
        <p style="color:#42526E;font-size:14px;line-height:1.5">Hello <strong>{escape(name)}</strong>, {escape(intro)}</p>
        <div style="background:#F4F5F7;border-left:4px solid #0052CC;border-radius:6px;padding:14px 16px;margin:16px 0">
          <div style="font-size:11px;color:#6B778C;font-weight:700;text-transform:uppercase">{escape(kind)} · {escape(entry.project.name)}</div>
          <div style="font-size:17px;font-weight:700;color:#172B4D;margin:4px 0">{escape(entry.title)}</div>
          <div style="font-size:13px;color:#42526E">{escape(_when_text(entry))}</div>
        </div>
        {notes}
        <a href="{_link(entry, user)}" style="display:inline-block;padding:10px 22px;background:#0052CC;color:#fff;font-weight:700;border-radius:7px;text-decoration:none">Open calendar &rarr;</a>
      </div>
    </div>"""
    text = f"Hello {name},\n\n{intro}\n\n{kind}: {entry.title}\nWhen: {_when_text(entry)}\n{entry.description}\n\nOpen: {_link(entry, user)}\n\nThe NEXO Team\n"
    try:
        send_mail_background(subject, text, get_default_from_email(), [user.email], html_message=html)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[Calendar email error]: {e}")
        return False


def notify_added(entry, actor, users):
    """Tell people they were added to / mentioned in a calendar entry (in-app + email)."""
    actor_name = (actor.get_full_name() or actor.username) if actor else "Someone"
    for user in users:
        if actor and user.pk == actor.pk:
            continue
        Notification.objects.create(
            recipient=user, actor=actor,
            action=f"added you to a {entry.get_kind_display().lower()} on {entry.date:%d %b}",
            target=entry.title,
        )
        _send(
            user, entry,
            subject=f"[NEXO] {actor_name} added you to: {entry.title}",
            headline=f"You were added to a {entry.get_kind_display().lower()}",
            intro=f"{actor_name} added you to this on the {entry.project.name} calendar.",
        )


def notify_due(entry):
    """It's the day: tell the creator and everyone involved."""
    recipients = {}
    if entry.created_by and entry.created_by.is_active:
        recipients[entry.created_by.pk] = entry.created_by
    for user in entry.participants.filter(is_active=True):
        recipients[user.pk] = user
    for user in recipients.values():
        Notification.objects.create(
            recipient=user, actor=entry.created_by,
            action=f"{entry.get_kind_display().lower()} today" + (f" at {entry.time:%H:%M}" if entry.time else ""),
            target=entry.title,
        )
        _send(
            user, entry,
            subject=f"[NEXO] {entry.get_kind_display()} today: {entry.title}",
            headline=f"{entry.get_kind_display()} today",
            intro=f"this is your {entry.get_kind_display().lower()} for today.",
        )
    return len(recipients)


def process_due(now=None):
    """Send the "it's today" notification for every entry whose time has come. Returns how many fired."""
    now = now or timezone.now()
    today = now.astimezone(reminder_tz()).date()
    candidates = CalendarEntry.objects.filter(
        due_notified_at__isnull=True,
        date__lte=today,
        date__gte=today - timedelta(days=CATCH_UP_DAYS),
    ).select_related("project", "created_by")
    fired = 0
    for entry in candidates:
        if due_at(entry) > now:
            continue
        # Claim it first: only one caller can flip NULL -> now, so nobody is ever mailed twice.
        if CalendarEntry.objects.filter(pk=entry.pk, due_notified_at__isnull=True).update(due_notified_at=now):
            notify_due(entry)
            fired += 1
    return fired
