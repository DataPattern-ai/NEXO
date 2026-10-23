import re

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EmailVerificationCode, Notification
from .access import (
    ADMIN,
    MANAGER,
    MEMBER,
    can_create_users,
    can_toggle_users,
    effective_project_role,
    is_org_admin,
    org_role,
    team_user_ids,
    visible_projects_q,
)
from .serializers import (
    NotificationSerializer,
    RegisterSerializer,
    SessionUserSerializer,
    UserSerializer,
    UserWithProjectsSerializer,
)
from .utils import (
    generate_otp_code,
    is_disposable_domain,
    read_invite_token,
    send_user_invitation_email,
    send_verification_email,
    validate_password_strength,
)

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    """POST username/email/password -> creates inactive user + dispatches 6-digit OTP email."""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        return Response(
            {
                "require_verification": True,
                "email": user.email,
                "detail": f"A 6-digit verification code has been sent to {user.email}.",
            },
            status=status.HTTP_201_CREATED,
        )



class VerifyCodeView(APIView):
    """
    POST email, code, purpose ('REGISTRATION' or 'PASSWORD_RESET')
    Validates 6-digit OTP code and activates user account if purpose is REGISTRATION.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        email = request.data.get("email", "").strip().lower()
        code = request.data.get("code", "").strip()
        purpose = request.data.get("purpose", "REGISTRATION").strip().upper()

        if not email or not code:
            return Response(
                {"detail": "Email address and 6-digit verification code are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Lookup matching verification code
        v_code = (
            EmailVerificationCode.objects.filter(
                email__iexact=email,
                code=code,
                purpose=purpose,
                is_used=False,
            )
            .order_by("-created_at")
            .first()
        )

        if not v_code or not v_code.is_valid(expiration_minutes=15):
            return Response(
                {"detail": "Invalid or expired verification code. Please check or request a new code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if purpose == "REGISTRATION":
            # Activate user account
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                return Response({"detail": "User account not found."}, status=status.HTTP_404_NOT_FOUND)
            if user.is_deactivated:
                return Response(
                    {"detail": "This account has been deactivated. Please contact an admin."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            user.is_active = True
            user.save()
            v_code.is_used = True
            v_code.save()

            token, _ = Token.objects.get_or_create(user=user)
            return Response(
                {
                    "verified": True,
                    "token": token.key,
                    "user": SessionUserSerializer(user).data,
                    "detail": "Email successfully verified! Welcome to NEXO.",
                },
                status=status.HTTP_200_OK,
            )

        elif purpose == "PASSWORD_RESET":
            return Response(
                {
                    "verified": True,
                    "detail": "Code verified. You may now enter your new password.",
                },
                status=status.HTTP_200_OK,
            )

        return Response({"detail": "Unsupported purpose."}, status=status.HTTP_400_BAD_REQUEST)


class ResendCodeView(APIView):
    """POST email, purpose -> generates fresh 6-digit OTP code and dispatches email."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        email = request.data.get("email", "").strip().lower()
        purpose = request.data.get("purpose", "REGISTRATION").strip().upper()

        if not email:
            return Response({"detail": "Email address is required."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        if not user and purpose == "REGISTRATION":
            return Response({"detail": "No registration found for this email."}, status=status.HTTP_404_NOT_FOUND)
        if not user and purpose == "PASSWORD_RESET":
            return Response({"detail": "No account found with this email."}, status=status.HTTP_404_NOT_FOUND)

        if user and user.is_deactivated:
            return Response(
                {"detail": "This account has been deactivated. Please contact an admin."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Invalidate old unused codes
        EmailVerificationCode.objects.filter(email__iexact=email, purpose=purpose, is_used=False).update(is_used=True)

        # Generate fresh code
        code = generate_otp_code(6)
        EmailVerificationCode.objects.create(
            email=email,
            user=user,
            code=code,
            purpose=purpose,
        )
        send_verification_email(
            email=email,
            code=code,
            purpose=purpose,
            username=user.username if user else "",
        )

        return Response(
            {
                "success": True,
                "detail": f"A new verification code has been dispatched to {email}.",
            },
            status=status.HTTP_200_OK,
        )


class LoginView(ObtainAuthToken):
    """POST email/password -> checks active status & returns auth token + basic user info."""
    def post(self, request, *args, **kwargs):
        email_input = request.data.get("username", "").strip().lower()  # field is named 'username' for DRF compat
        password = request.data.get("password", "").strip()

        if not email_input or not password:
            return Response(
                {"detail": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Look up user by email
        user = (
            User.objects.filter(email__iexact=email_input).first()
            or User.objects.filter(username__iexact=email_input).first()
        )

        if not user:
            return Response(
                {"detail": "No account found with this email. Please check your credentials."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify password
        if not user.check_password(password):
            return Response(
                {"detail": "Incorrect password. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.is_deactivated:
            return Response(
                {"detail": "Your account has been deactivated. Please contact an admin."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Unverified email: refuse to log in until the 6-digit code is entered.
        # Checked after the password so account state isn't revealed to guessers.
        if not user.is_active:
            EmailVerificationCode.objects.filter(
                email__iexact=user.email, purpose="REGISTRATION", is_used=False
            ).update(is_used=True)
            code = generate_otp_code(6)
            EmailVerificationCode.objects.create(
                email=user.email, user=user, code=code, purpose="REGISTRATION"
            )
            send_verification_email(
                email=user.email, code=code, purpose="REGISTRATION", username=user.username
            )
            return Response(
                {
                    "unverified": True,
                    "email": user.email,
                    "detail": "Please verify your email with the 6-digit code we just sent you.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": SessionUserSerializer(user).data})


class VerifyEmailView(APIView):
    """POST email -> verifies email exists in DB and dispatches a 6-digit password reset OTP."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        email_or_username = request.data.get("email", "").strip()
        if not email_or_username:
            return Response(
                {"detail": "Please enter your email or username."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = (
            User.objects.filter(email__iexact=email_or_username).first()
            or User.objects.filter(username__iexact=email_or_username).first()
        )

        if not user:
            return Response(
                {"detail": "No account found matching this email or username."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Invalidate old unused reset codes
        EmailVerificationCode.objects.filter(
            email__iexact=user.email,
            purpose="PASSWORD_RESET",
            is_used=False,
        ).update(is_used=True)

        # Generate fresh reset code
        code = generate_otp_code(6)
        EmailVerificationCode.objects.create(
            email=user.email,
            user=user,
            code=code,
            purpose="PASSWORD_RESET",
        )
        send_verification_email(
            email=user.email,
            code=code,
            purpose="PASSWORD_RESET",
            username=user.username,
        )

        return Response(
            {
                "exists": True,
                "username": user.username,
                "email": user.email,
                "detail": f"A 6-digit password reset code has been sent to {user.email}.",
            },
            status=status.HTTP_200_OK,
        )



class ResetPasswordView(APIView):
    """POST email, code, new_password -> verifies OTP code and updates user password."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        email_or_username = request.data.get("email", "").strip()
        code = request.data.get("code", "").strip()
        new_password = request.data.get("new_password", "").strip()

        if not email_or_username or not code or not new_password:
            return Response(
                {"detail": "Email, 6-digit verification code, and new password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_valid_pwd, pwd_err = validate_password_strength(new_password)
        if not is_valid_pwd:
            return Response(
                {"detail": pwd_err},
                status=status.HTTP_400_BAD_REQUEST,
            )


        user = (
            User.objects.filter(email__iexact=email_or_username).first()
            or User.objects.filter(username__iexact=email_or_username).first()
        )

        if not user:
            return Response(
                {"detail": "No account found with this email or username."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Validate 6-digit OTP code
        v_code = (
            EmailVerificationCode.objects.filter(
                email__iexact=user.email,
                code=code,
                purpose="PASSWORD_RESET",
                is_used=False,
            )
            .order_by("-created_at")
            .first()
        )

        if not v_code or not v_code.is_valid(expiration_minutes=15):
            return Response(
                {"detail": "Invalid or expired verification code. Please check your email or request a new code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save()

        # Invalidate code & old auth tokens
        v_code.is_used = True
        v_code.save()
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)

        return Response(
            {
                "success": True,
                "username": user.username,
                "token": token.key,
                "detail": "Password has been successfully updated. You may now log in.",
            },
            status=status.HTTP_200_OK,
        )


class MeView(generics.RetrieveUpdateAPIView):
    """GET / PATCH current logged-in user."""
    serializer_class = SessionUserSerializer

    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


def _slug_username(base: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9_]", "", base.replace(" ", "_").replace(".", "_"))[:20] or "user"
    if len(base) < 3:
        base = (base + "user")[:20]
    candidate, n = base, 1
    while User.objects.filter(username__iexact=candidate).exists():
        n += 1
        candidate = f"{base[:20 - len(str(n))]}{n}"
    return candidate


def _manager_error(user, manager):
    """Validates a reporting manager choice. `user` is None when creating a new user."""
    if manager is None:
        return None
    if not manager.is_active:
        return "The reporting manager must be an active user."
    if user is not None:
        node = manager
        while node is not None:  # walking up the chain must never reach `user`
            if node.pk == user.pk:
                return "A user cannot report to themselves or to someone in their own reporting line."
            node = node.reporting_manager
    return None


def _outside_team(requester, manager):
    """Managers may only place people under themselves or someone in their own team."""
    if org_role(requester) != MANAGER:
        return False
    allowed = {requester.pk} | team_user_ids(requester)
    return manager is None or manager.pk not in allowed


def _is_last_admin(user):
    """True when `user` is the only remaining active Admin (so they must not be demoted/deactivated)."""
    others = User.objects.filter(is_active=True).exclude(pk=user.pk)
    return not (others.filter(user_type=ADMIN).exists() or others.filter(is_superuser=True).exists())


class UserListView(generics.ListCreateAPIView):
    """
    GET  /api/auth/users/?search=  -> team directory (includes deactivated users so names stay visible).
    POST /api/auth/users/          -> admin adds a user and emails them an invitation link.
    """
    serializer_class = UserWithProjectsSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Hide self-registrations still waiting for their verification code.
        qs = (
            User.objects.exclude(is_active=False, is_deactivated=False)
            .select_related("reporting_manager")
            .order_by("username")
        )
        query = self.request.query_params.get("search", "").strip()
        if query:
            qs = qs.filter(username__icontains=query) | qs.filter(email__icontains=query)
        return qs

    def create(self, request, *args, **kwargs):
        if not can_create_users(request.user):
            return Response({"detail": "Only Admins and Managers can add users."}, status=status.HTTP_403_FORBIDDEN)
        requester_role = org_role(request.user)

        new_type = (request.data.get("user_type") or MEMBER).upper()
        if new_type not in (ADMIN, MANAGER, MEMBER):
            return Response({"user_type": ["Choose Admin, Manager or Member."]}, status=status.HTTP_400_BAD_REQUEST)
        if requester_role == MANAGER and new_type != MEMBER:
            return Response({"detail": "Managers can only add Members."}, status=status.HTTP_403_FORBIDDEN)

        email = (request.data.get("email") or "").strip().lower()
        full_name = (request.data.get("name") or "").strip()
        designation = (request.data.get("designation") or "").strip()[:100]
        manager_id = request.data.get("reporting_manager")

        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
            return Response({"email": ["Enter a valid email address."]}, status=status.HTTP_400_BAD_REQUEST)
        if is_disposable_domain(email):
            return Response({"email": ["Disposable email domains are not allowed."]}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({"email": ["A user with this email already exists."]}, status=status.HTTP_400_BAD_REQUEST)
        if not full_name:
            return Response({"name": ["Name is required."]}, status=status.HTTP_400_BAD_REQUEST)

        manager = None
        if manager_id in (None, "") and requester_role == MANAGER:
            manager = request.user  # a manager's new hire joins their own team
        elif manager_id not in (None, ""):
            manager = User.objects.filter(pk=manager_id).first()
            if manager is None:
                return Response({"reporting_manager": ["Reporting manager not found."]}, status=status.HTTP_400_BAD_REQUEST)
            err = _manager_error(None, manager)
            if err:
                return Response({"reporting_manager": [err]}, status=status.HTTP_400_BAD_REQUEST)
        if _outside_team(request.user, manager):
            return Response(
                {"reporting_manager": ["You can only add people to your own team."]},
                status=status.HTTP_403_FORBIDDEN,
            )

        first, _, last = full_name.partition(" ")
        user = User.objects.create_user(
            username=_slug_username(full_name or email.split("@")[0]),
            email=email,
            password=None,  # unusable until they set one via "Forgot password"
            first_name=first[:150],
            last_name=last.strip()[:150],
            designation=designation,
            reporting_manager=manager,
            user_type=new_type,
            is_active=True,  # the invitation link replaces email verification
        )
        sent = send_user_invitation_email(user, invited_by=request.user.get_full_name() or request.user.username)
        data = UserWithProjectsSerializer(user, context={"request": request}).data
        data["email_sent"] = sent
        return Response(data, status=status.HTTP_201_CREATED)


class UserManageView(APIView):
    """PATCH /api/auth/users/<id>/ -> admin edits name / designation / reporting manager / active state."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        if not can_create_users(request.user):
            return Response({"detail": "Only Admins and Managers can edit users."}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        is_admin = is_org_admin(request.user)
        if not is_admin and user.pk not in team_user_ids(request.user):
            return Response(
                {"detail": "You can only edit people in your own team."}, status=status.HTTP_403_FORBIDDEN
            )
        if "user_type" in request.data and not is_admin:
            return Response({"detail": "Only Admins can change a user type."}, status=status.HTTP_403_FORBIDDEN)
        if "is_deactivated" in request.data and not can_toggle_users(request.user):
            return Response({"detail": "Only Admins can activate or deactivate users."}, status=status.HTTP_403_FORBIDDEN)

        if "name" in request.data:
            full_name = (request.data.get("name") or "").strip()
            if not full_name:
                return Response({"name": ["Name cannot be empty."]}, status=status.HTTP_400_BAD_REQUEST)
            first, _, last = full_name.partition(" ")
            user.first_name = first[:150]
            user.last_name = last.strip()[:150]

        if "designation" in request.data:
            user.designation = (request.data.get("designation") or "").strip()[:100]

        if "reporting_manager" in request.data:
            manager_id = request.data.get("reporting_manager")
            manager = None
            if manager_id not in (None, ""):
                manager = User.objects.filter(pk=manager_id).first()
                if manager is None:
                    return Response({"reporting_manager": ["Reporting manager not found."]}, status=status.HTTP_400_BAD_REQUEST)
                err = _manager_error(user, manager)
                if err:
                    return Response({"reporting_manager": [err]}, status=status.HTTP_400_BAD_REQUEST)
            if _outside_team(request.user, manager):
                return Response(
                    {"reporting_manager": ["You can only place people under yourself or your own team."]},
                    status=status.HTTP_403_FORBIDDEN,
                )
            user.reporting_manager = manager

        if "user_type" in request.data:
            new_type = (request.data.get("user_type") or "").upper()
            if new_type not in (ADMIN, MANAGER, MEMBER):
                return Response({"user_type": ["Choose Admin, Manager or Member."]}, status=status.HTTP_400_BAD_REQUEST)
            if new_type != ADMIN and user.user_type == ADMIN and _is_last_admin(user):
                return Response(
                    {"detail": "NEXO needs at least one active Admin."}, status=status.HTTP_400_BAD_REQUEST
                )
            user.user_type = new_type

        if "is_deactivated" in request.data:
            deactivate = bool(request.data.get("is_deactivated"))
            if deactivate and user.pk == request.user.pk:
                return Response({"detail": "You cannot deactivate your own account."}, status=status.HTTP_400_BAD_REQUEST)
            if deactivate and user.user_type == ADMIN and _is_last_admin(user):
                return Response({"detail": "NEXO needs at least one active Admin."}, status=status.HTTP_400_BAD_REQUEST)
            user.is_deactivated = deactivate
            user.is_active = not deactivate
            if deactivate:
                Token.objects.filter(user=user).delete()  # end any live session immediately

        user.save()
        return Response(UserWithProjectsSerializer(user, context={"request": request}).data)


class ResendInviteView(APIView):
    """POST /api/auth/users/<id>/resend-invite/ -> emails a fresh invitation link."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        if not can_create_users(request.user):
            return Response({"detail": "Only Admins and Managers can invite users."}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)
        if not is_org_admin(request.user) and user.pk not in team_user_ids(request.user):
            return Response({"detail": "You can only invite people in your own team."}, status=status.HTTP_403_FORBIDDEN)
        if user.is_deactivated:
            return Response({"detail": "Reactivate this user before inviting them."}, status=status.HTTP_400_BAD_REQUEST)
        if user.last_login is not None or user.has_usable_password():
            return Response({"detail": "This user has already joined."}, status=status.HTTP_400_BAD_REQUEST)
        sent = send_user_invitation_email(user, invited_by=request.user.get_full_name() or request.user.username)
        return Response({"email_sent": sent})


class AcceptInviteView(APIView):
    """POST {token} -> signs the invited user straight in. No verification code."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request, *args, **kwargs):
        user = read_invite_token(request.data.get("token", ""))
        if not user:
            return Response(
                {"detail": "This invitation link is invalid, expired or has already been used. Ask an admin to resend it."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if user.is_deactivated:
            return Response({"detail": "This account has been deactivated."}, status=status.HTTP_403_FORBIDDEN)

        user.is_active = True
        user.last_login = timezone.now()  # also invalidates this (single-use) link
        user.save(update_fields=["is_active", "last_login"])
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": SessionUserSerializer(user).data})


class NotificationViewSet(viewsets.ModelViewSet):
    """CRUD API for user notifications."""
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    def perform_create(self, serializer):
        serializer.save(actor=self.request.user)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        Notification.objects.filter(recipient=request.user, read=False).update(read=True)
        return Response({"status": "all marked as read"})

    @action(detail=False, methods=["delete"])
    def clear_all(self, request):
        Notification.objects.filter(recipient=request.user).delete()
        return Response({"status": "cleared all"})


class DashboardView(APIView):
    """
    GET /api/auth/dashboard/
    Returns all dashboard data in one response:
    1. assigned_issues   — current user's issues grouped by status
    2. my_projects       — projects with open/done counts
    3. active_sprints    — active sprint progress per project
    4. issue_type_counts — counts by type for pie chart
    5. recent_activity   — last 20 activity log entries across all user's issues
    6. unread_notifications — unread notification count + latest 10
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from issues.models import Issue, ActivityLog
        from projects.models import Project, Sprint
        from .models import Notification
        from .serializers import NotificationSerializer

        user = request.user

        # ── 1. Assigned issues grouped by status ──
        assigned_issues = Issue.objects.filter(
            assignee=user
        ).select_related("project", "assignee", "reporter").order_by("-updated_at")[:50]

        def issue_brief(i):
            return {
                "id": i.id,
                "title": i.title,
                "project_key": i.project.key,
                "project_name": i.project.name,
                "project_id": i.project.id,
                "priority": i.priority,
                "issue_type": i.issue_type,
                "status": i.status,
                "due_date": str(i.due_date) if i.due_date else None,
                "updated_at": i.updated_at.isoformat(),
            }

        grouped_statuses = {"TODO": [], "IN_PROGRESS": [], "DONE": []}
        for issue in assigned_issues:
            key = issue.status if issue.status in grouped_statuses else "TODO"
            grouped_statuses[key].append(issue_brief(issue))

        # ── 2. Leadership Portfolio & Projects Summary ──
        projects = Project.objects.filter(
            visible_projects_q(user)
        ).distinct().prefetch_related("issues").select_related("intelligence_summary")

        my_projects = []
        cross_project_progress = []
        projects_requiring_attention = []
        all_portfolio_milestones = []
        all_portfolio_risks = []

        total_projects_count = projects.count()
        health_counts = {"ON_TRACK": 0, "AT_RISK": 0, "CRITICAL": 0}
        total_completion_sum = 0
        total_docs_count = 0

        for p in projects:
            all_issues = p.issues.all()
            intel_sum = getattr(p, "intelligence_summary", None)

            if not intel_sum or not intel_sum.normalized_state:
                try:
                    from projects.intelligence.synthesizer import generate_project_intelligence
                    intel_data = generate_project_intelligence(p)
                    intel_sum = getattr(p, "intelligence_summary", None)
                    norm_state = intel_data.get("normalized_state", {})
                except Exception:
                    norm_state = {}
            else:
                norm_state = intel_sum.normalized_state or {}

            health_stat = norm_state.get("health", {}).get("status") or (intel_sum.health_status if intel_sum else "ON_TRACK")
            health_label = norm_state.get("health", {}).get("label") or health_stat.replace("_", " ").title()
            health_rationale = norm_state.get("health", {}).get("rationale") or (intel_sum.health_rationale if intel_sum else "")
            curr_phase = norm_state.get("current_phase") or (intel_sum.current_phase if intel_sum else "")

            prog = norm_state.get("progress", {})
            completion_pct = prog.get("percent")
            if completion_pct is None:
                t_count = all_issues.count()
                d_count = all_issues.filter(status="DONE").count()
                completion_pct = round((d_count / t_count) * 100) if t_count else 0
                prog_source = "Issues"
                total_items = t_count
                done_items = d_count
            else:
                prog_source = prog.get("source", "Project Deliverables")
                total_items = prog.get("total_items", all_issues.count())
                done_items = prog.get("done_items", all_issues.filter(status="DONE").count())

            doc_count = p.docs.count()
            total_docs_count += doc_count
            total_completion_sum += completion_pct

            if health_stat in health_counts:
                health_counts[health_stat] += 1
            else:
                health_counts["ON_TRACK"] += 1

            project_item = {
                "id": p.id,
                "name": p.name,
                "key": p.key,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "created_by": p.created_by.username if p.created_by else "Admin",
                "total": all_issues.count(),
                "open": all_issues.filter(status__in=["TODO", "IN_PROGRESS"]).count(),
                "done": all_issues.filter(status="DONE").count(),
                "my_role": effective_project_role(user, p),
                "health_status": health_stat,
                "health_label": health_label,
                "health_rationale": health_rationale,
                "current_phase": curr_phase,
                "completion_percent": completion_pct,
                "progress_source": prog_source,
                "total_items": total_items,
                "done_items": done_items,
                "documents_count": doc_count,
            }
            my_projects.append(project_item)
            cross_project_progress.append(project_item)

            proj_milestones = norm_state.get("milestones", [])
            for m in proj_milestones:
                all_portfolio_milestones.append({
                    "project_id": p.id,
                    "project_name": p.name,
                    "project_key": p.key,
                    "title": m.get("title"),
                    "target_date": m.get("target_date"),
                    "status": m.get("status"),
                    "days_away": m.get("days_away"),
                    "extension_days": m.get("extension_days", 0),
                    "source": m.get("source"),
                    "source_location": m.get("source_location"),
                })

            proj_risks = norm_state.get("risks_and_blockers", [])
            active_risks_for_p = [r for r in proj_risks if r.get("status", "ACTIVE") == "ACTIVE"]
            for r in active_risks_for_p:
                all_portfolio_risks.append({
                    "project_id": p.id,
                    "project_name": p.name,
                    "project_key": p.key,
                    "title": r.get("title"),
                    "type": r.get("type", "RISK"),
                    "severity": r.get("severity", "MEDIUM"),
                    "source_type": r.get("source_type"),
                    "source_title": r.get("source_title"),
                })

            has_high_risk = any(r.get("severity") in ["HIGH", "CRITICAL"] for r in active_risks_for_p)
            has_delays = any(m.get("status") == "DELAYED" or (m.get("extension_days") or 0) > 0 for m in proj_milestones)
            if health_stat in ["AT_RISK", "CRITICAL"] or has_high_risk or has_delays:
                projects_requiring_attention.append({
                    "id": p.id,
                    "name": p.name,
                    "key": p.key,
                    "health_status": health_stat,
                    "health_label": health_label,
                    "health_rationale": health_rationale,
                    "completion_percent": completion_pct,
                    "progress_source": prog_source,
                    "active_risks_count": len(active_risks_for_p),
                    "high_risks_count": len([r for r in active_risks_for_p if r.get("severity") in ["HIGH", "CRITICAL"]]),
                    "delayed_milestones_count": len([m for m in proj_milestones if m.get("status") == "DELAYED" or (m.get("extension_days") or 0) > 0]),
                })

        avg_completion = round(total_completion_sum / total_projects_count) if total_projects_count else 0

        portfolio_health_summary = {
            "total_projects": total_projects_count,
            "on_track_count": health_counts["ON_TRACK"],
            "at_risk_count": health_counts["AT_RISK"],
            "critical_count": health_counts["CRITICAL"],
            "average_completion_pct": avg_completion,
            "total_documents": total_docs_count,
            "total_active_risks": len(all_portfolio_risks),
        }

        all_portfolio_milestones.sort(
            key=lambda x: (x.get("days_away") is None, x.get("days_away") if x.get("days_away") is not None else 9999)
        )
        severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        all_portfolio_risks.sort(key=lambda x: severity_order.get(x.get("severity", "MEDIUM"), 2))

        # ── 3. Active sprint progress ──
        active_sprints = Sprint.objects.filter(
            visible_projects_q(user, "project__"),
            status="ACTIVE"
        ).distinct().select_related("project")

        sprint_data = []
        for s in active_sprints:
            sprint_issues = s.issues.all()
            total = sprint_issues.count()
            done = sprint_issues.filter(status="DONE").count()
            sprint_data.append({
                "id": s.id,
                "name": s.name,
                "project_name": s.project.name,
                "project_id": s.project.id,
                "goal": s.goal,
                "start_date": str(s.start_date) if s.start_date else None,
                "end_date": str(s.end_date) if s.end_date else None,
                "total": total,
                "done": done,
                "in_progress": sprint_issues.filter(status="IN_PROGRESS").count(),
                "todo": sprint_issues.filter(status="TODO").count(),
                "percent": round((done / total) * 100) if total else 0,
            })

        # ── 4. Issue type counts (for pie chart) ──
        all_user_issues = Issue.objects.filter(
            visible_projects_q(user, "project__")
        ).distinct()

        type_counts = {}
        for t in ["TASK", "BUG", "STORY", "EPIC"]:
            type_counts[t] = all_user_issues.filter(issue_type=t).count()

        # ── 5. Recent activity log (last 20 entries across user's projects) ──
        activity = ActivityLog.objects.filter(
            visible_projects_q(user, "issue__project__")
        ).distinct().select_related("actor", "issue", "issue__project").order_by("-created_at")[:20]

        activity_data = []
        for a in activity:
            activity_data.append({
                "id": a.id,
                "actor": a.actor.username if a.actor else "System",
                "field_changed": a.field_changed,
                "old_value": a.old_value,
                "new_value": a.new_value,
                "issue_id": a.issue.id,
                "issue_title": a.issue.title,
                "project_key": a.issue.project.key,
                "project_id": a.issue.project.id,
                "created_at": a.created_at.isoformat(),
            })

        # ── 6. Recent portfolio updates (cross-project delivered work, decisions, asset uploads, & activity) ──
        recent_portfolio_updates = []

        for p in projects:
            intel_sum = getattr(p, "intelligence_summary", None)
            norm_state = intel_sum.normalized_state if intel_sum and intel_sum.normalized_state else {}
            recent_ups = norm_state.get("recent_updates", {})
            for cw in recent_ups.get("completed_work", []):
                recent_portfolio_updates.append({
                    "id": f"cw-{p.key}-{cw.get('id')}",
                    "type": "DELIVERABLE",
                    "project_id": p.id,
                    "project_name": p.name,
                    "project_key": p.key,
                    "title": cw.get("title"),
                    "owner": cw.get("owner"),
                    "source": cw.get("source", "Deliverable"),
                    "timestamp": cw.get("updated_at"),
                    "badge": "Delivered",
                    "badge_color": "#00875A",
                })
            if not recent_ups.get("completed_work"):
                for d in norm_state.get("deliverables", []):
                    if d.get("status") == "COMPLETED":
                        recent_portfolio_updates.append({
                            "id": f"deliv-{p.key}-{d.get('row', 0)}",
                            "type": "DELIVERABLE",
                            "project_id": p.id,
                            "project_name": p.name,
                            "project_key": p.key,
                            "title": f"Milestone deliverable delivered: '{d.get('title')}'",
                            "owner": d.get("owner"),
                            "source": "Timeline Plan",
                            "timestamp": d.get("end_date"),
                            "badge": "Delivered",
                            "badge_color": "#00875A",
                        })
            for dec in recent_ups.get("decisions", []):
                recent_portfolio_updates.append({
                    "id": f"dec-{p.key}-{dec.get('title')}",
                    "type": "DECISION",
                    "project_id": p.id,
                    "project_name": p.name,
                    "project_key": p.key,
                    "title": dec.get("title"),
                    "source": dec.get("source", "Governance"),
                    "timestamp": None,
                    "badge": "Decision",
                    "badge_color": "#403294",
                })
            for d in p.docs.all()[:3]:
                recent_portfolio_updates.append({
                    "id": f"doc-{p.key}-{d.id}",
                    "type": "DOCUMENT",
                    "project_id": p.id,
                    "project_name": p.name,
                    "project_key": p.key,
                    "title": f"Project asset uploaded: '{d.title}' ({d.file_type or 'DOC'})",
                    "source": d.template_type or "Documentation",
                    "timestamp": d.created_at.isoformat() if d.created_at else None,
                    "badge": "Asset Ingested",
                    "badge_color": "#0747A6",
                })

        for a in activity[:8]:
            recent_portfolio_updates.append({
                "id": f"act-{a.id}",
                "type": "ACTIVITY",
                "project_id": a.issue.project.id,
                "project_name": a.issue.project.name,
                "project_key": a.issue.project.key,
                "title": f"{a.actor.username if a.actor else 'Member'} updated {a.issue.project.key}-{a.issue.id} ({a.issue.title}): {a.field_changed} → {a.new_value}",
                "source": "Task Event",
                "timestamp": a.created_at.isoformat(),
                "badge": "Activity",
                "badge_color": "#0052CC",
            })

        recent_portfolio_updates.sort(
            key=lambda x: (x.get("timestamp") is not None, x.get("timestamp") or ""),
            reverse=True
        )

        # ── 7. Unread notifications ──
        unread_qs = Notification.objects.filter(
            recipient=user, read=False
        ).select_related("actor").order_by("-created_at")

        unread_count = unread_qs.count()
        recent_notifs = []
        for n in unread_qs[:10]:
            recent_notifs.append({
                "id": n.id,
                "actor": n.actor.username if n.actor else "System",
                "action": n.action,
                "target": n.target,
                "created_at": n.created_at.isoformat(),
            })

        return Response({
            "assigned_by_status": grouped_statuses,
            "my_projects": my_projects,
            "portfolio_health_summary": portfolio_health_summary,
            "cross_project_progress": cross_project_progress,
            "projects_requiring_attention": projects_requiring_attention,
            "upcoming_overdue_milestones": all_portfolio_milestones[:10],
            "aggregate_risks_blockers": all_portfolio_risks[:10],
            "recent_portfolio_updates": recent_portfolio_updates[:12],
            "active_sprints": sprint_data,
            "issue_type_counts": type_counts,
            "recent_activity": activity_data,
            "unread_notifications": {
                "count": unread_count,
                "items": recent_notifs,
            },
        })
