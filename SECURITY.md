# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in cache-mesh, please report it
**privately** through
[GitHub Security Advisories](https://github.com/ridakaddir/cache-mesh/security/advisories/new).

Do **not** open a public issue for security bugs.

## Scope

The following areas are in scope:

- HMAC authentication bypass or signature forgery
- Denial of service via the sync HTTP server (unbounded allocation,
  resource exhaustion)
- Cache poisoning (accepting ops that should be rejected by LWW)
- Information disclosure through the snapshot or health endpoints

## Response

- We aim to acknowledge reports within 48 hours.
- Fixes will be released as patch versions with a security advisory.
- Credit will be given unless you prefer to remain anonymous.

## Supported versions

Only the latest minor release receives security patches.
