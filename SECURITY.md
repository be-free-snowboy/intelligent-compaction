# Security Policy

## Reporting a Vulnerability

Please report security issues privately through the GitHub Security Advisory
feature for this repository. Do not open a public issue for an undisclosed
vulnerability.

Include:

- affected package and version
- reproduction steps
- impact assessment
- any suggested remediation

## Scope

The repository contains a host-agnostic core library and host-adapter packages.
Published package configuration is validated in CI with `publint`, `attw`, and a
packed-consumer contract test. Production dependency audits run with:

```bash
pnpm audit --prod --audit-level=high
```
