# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Report it privately through [GitHub's security advisories](https://github.com/SamSpiri/makeplane-cli/security/advisories/new). Include the affected version, reproduction steps, and impact when possible.

Do not include Plane API tokens or other secrets in reports. Revoke any token that was exposed and create a replacement.

## Scope

The CLI sends requests to the Plane URL and credentials you configure. It does not intentionally transmit credentials to project maintainers. Review commands before running destructive operations such as `delete`.
