# Server security configuration

The server uses exact-origin checks for state-changing requests, a host allow-list, bounded JSON bodies, request IDs, and per-IP request limits.

Configure these deployment variables before starting the production server:

- `TRUSTED_HOSTS` — comma-separated host values accepted by the HTTP server, including a port only when that port is present in the incoming `Host` header. If a reverse proxy presents both an internal `Host` and public `X-Forwarded-Host`, include both values. Production startup fails closed when this value is empty.
- `TRUSTED_PROXY_HOPS` — number of trusted reverse-proxy hops. The default is one in production and zero elsewhere. Set this to match the actual ingress chain; do not trust headers from a longer chain than the deployment controls.
- `CORS_ALLOWED_ORIGINS` — optional comma-separated, exact HTTP(S) origins for cross-origin clients. Same-origin requests are checked against the incoming request origin; no wildcard origins are accepted.

The JSON request limit is 16 KiB. Chat submissions are limited to 30 per minute per client IP, and commands to 120 per minute per client IP. The current limiter is in-memory and applies per server process; deployments with multiple workers or replicas need a shared limiter before treating these values as a global abuse quota.

Request IDs are returned in `X-Request-Id` and included in server-side error logs. Unexpected engine and database errors are returned as generic internal errors; details stay in server logs. Typed game-rule failures retain safe player-facing messages.
