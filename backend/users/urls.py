from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AcceptInviteView,
    DashboardView,
    LoginView,
    MeView,
    NotificationViewSet,
    RegisterView,
    ResendInviteView,
    ResendCodeView,
    ResetPasswordView,
    UserListView,
    UserManageView,
    ValidateInviteView,
    VerifyCodeView,
    VerifyEmailView,
)

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("verify-code/", VerifyCodeView.as_view(), name="verify-code"),
    path("resend-code/", ResendCodeView.as_view(), name="resend-code"),
    path("login/", LoginView.as_view(), name="login"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("reset-password/", ResetPasswordView.as_view(), name="reset-password"),
    path("me/", MeView.as_view(), name="me"),
    path("users/", UserListView.as_view(), name="user-list"),
    path("users/<int:pk>/", UserManageView.as_view(), name="user-manage"),
    path("users/<int:pk>/resend-invite/", ResendInviteView.as_view(), name="user-resend-invite"),
    path("validate-invite/", ValidateInviteView.as_view(), name="validate-invite"),
    path("accept-invite/", AcceptInviteView.as_view(), name="accept-invite"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("", include(router.urls)),
]


