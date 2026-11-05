# Security model — Harness-native monitor

This revision deliberately replaces the legacy credential-handling runtime. Do not mix its new client with a legacy Host bundle.

## Trust boundaries

- All inbound HTTP endpoints are registered with `ctx.connection.fetch`, not raw `ctx.webServer` handlers. The Harness Connection authenticates the owner and applies Host/Origin fences before dispatch. There is no extra quota server, CORS wildcard, loopback exemption, or browser-supplied credential.
- The browser can read accounting or request a bounded refresh. It cannot configure a URL, proxy, credential value, arbitrary credential reference, filesystem path, or OAuth callback.
- Credentials remain in the Harness credential service. No local CLI databases/auth files are scanned; no Codex/Claude login is replaced or refresh token rotated by this monitor.
- Official credential destinations are compile-time HTTPS origin/path pairs. No redirects, destination/proxy override, or independent network dispatcher is permitted. Calls use the same Host fetch/global dispatcher installed by DSH (or an explicitly provided transport in isolated tests). Model inference is never performed by the monitor; it only observes native Harness usage.
- Signed-in DeepSeek account data uses the owning Harness account service, whose authentication remains private to it.
- Credentials and upstream response bodies never enter browser responses, tool output, usage storage, errors, or application logs. Missing credentials and unsupported quota APIs have explicit non-success states.
- The React Sidebar tab treats all dynamic values as text. It does not insert HTML, scrape another plugin's DOM, mount a second application, or load external scripts/assets.
- Auxiliary usage persistence contains only numeric usage, timestamps, session ids, provider/model ids and purpose. No prompts, tool arguments, model text, keys, emails or account tokens are needed for token accounting.

## Limitations

Owner access in DSH is full trusted-user access. Another malicious Host plugin can already execute in the Host process and is outside this plugin's isolation boundary. Browser cookies on a plain HTTP LAN server are not protected from an on-path attacker; use trusted networking or HTTPS. An official provider can decline or rate-limit a quota request; a positive remaining balance is not an execution guarantee. Provider usage reports can be missing; unknown is never silently replaced with zero usage or 100% available quota.

A quota read uses an OAuth **access token only** where the owning Harness stores one. This plugin has no independent refresh or login implementation. Sign in/renew the relevant account through Harness when needed.

## Tests

Run `npm test` for isolated fake-credential tests. No real API key or provider login is required. Integration verification must include unauthenticated/cross-origin route rejection on the actual Harness server. Do not run vulnerability probes against another person's Host or provider credentials.

## Reporting

Report vulnerabilities privately to the upstream repository maintainers using their available security contact/Private Vulnerability Reporting. Avoid publishing real credentials or a live user's account data in issues or test fixtures.
