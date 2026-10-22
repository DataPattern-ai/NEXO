import json
from django.core.management.base import BaseCommand
from projects.intelligence.ai_provider import test_ai_connection, AIProviderConfig, mask_secret


class Command(BaseCommand):
    help = "Safe, non-destructive connection probe for configured AI provider (Databricks, Gemini, OpenAI, etc.)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            help="Output test result as JSON",
        )
        parser.add_argument(
            "--timeout",
            type=int,
            default=15,
            help="Probe timeout in seconds (default: 15)",
        )

    def handle(self, *args, **options):
        timeout = options.get("timeout", 15)
        as_json = options.get("json", False)

        result = test_ai_connection(timeout=timeout)

        if as_json:
            self.stdout.write(json.dumps(result, indent=2))
            return

        cfg = AIProviderConfig.get_config()
        self.stdout.write("=" * 65)
        self.stdout.write("  NEXO AI Intelligence Layer -- Connection Probe")
        self.stdout.write("=" * 65)
        self.stdout.write(f"Provider:            {result.get('provider')}")
        self.stdout.write(f"Serving Model/Route: {result.get('endpoint_name') or '<none>'}")
        self.stdout.write(f"Endpoint URL:        {result.get('endpoint_url') or '<none>'}")
        self.stdout.write(f"Credentials Present: {result.get('has_credentials')}")
        self.stdout.write(f"Masked Token:        {result.get('masked_token')}")
        self.stdout.write(f"Connection Status:   {result.get('status')}")
        self.stdout.write(f"HTTP Status:         {result.get('http_status') or '<n/a>'}")
        self.stdout.write(f"Latency:             {result.get('latency_ms')} ms")
        self.stdout.write("-" * 65)
        self.stdout.write(f"Message: {result.get('message')}")

        if result.get("probe_response"):
            self.stdout.write(f"Probe Response:      {result.get('probe_response')}")

        if result.get("error"):
            self.stdout.write(self.style.ERROR(f"Error (Sanitized):   {result.get('error')}"))
        elif result.get("status") == "CONNECTED":
            self.stdout.write(self.style.SUCCESS("[OK] Connection verified successfully."))
        elif result.get("status") == "FALLBACK_MODE":
            self.stdout.write(self.style.WARNING("[INFO] Running in deterministic offline fallback mode."))
        self.stdout.write("=" * 65)
