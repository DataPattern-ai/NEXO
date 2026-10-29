from rest_framework.authentication import SessionAuthentication, TokenAuthentication


class TokenAuthFromHeaderOrQuery(TokenAuthentication):
    """
    Extends TokenAuthentication to allow authenticating via URL query parameter `?token=...`
    or `?auth_token=...` in addition to the standard `Authorization: Token <token>` header.
    This enables direct browser navigation and downloads for media/docs while keeping full
    authentication and permission enforcement intact.
    """

    def authenticate(self, request):
        auth = super().authenticate(request)
        if auth is not None:
            return auth

        token = request.query_params.get("token") or request.query_params.get("auth_token")
        if token:
            return self.authenticate_credentials(token.strip())

        return None
