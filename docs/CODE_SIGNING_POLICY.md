# Code signing policy

## Current status

NEXUS has not been accepted by SignPath Foundation and has no SignPath signing subscription. No NEXUS release is currently represented as signed by SignPath. The repository is being prepared for a possible application to its free open-source code-signing program; acceptance is not guaranteed.

If accepted, the planned notice is: **Free code signing provided by SignPath.io, certificate by SignPath Foundation.** Until then, every release must be treated as unsigned and may be blocked by Windows Smart App Control.

## Scope and release controls

The proposed scope is limited to NEXUS binaries built by the public GitHub Actions workflow from a version tag in this repository. Local development builds, artifacts from other repositories, and third-party binaries are not authorized for signing. Each signing request will be reviewed and manually approved before release. Build scripts and workflow changes require review with the same care as application code.

## Project roles

- Authors and maintainers: `undarez`, repository owner.
- Reviewer: `undarez`, project maintainer; all changes from outside contributors require review before merge.
- Release approver: `undarez`, repository owner; each signing request must be manually approved by the owner.

These roles describe the proposed single-maintainer beta process and remain subject to SignPath approval and any requirements it sets.

## Privacy

See [NEXUS privacy policy](PRIVACY.md). NEXUS has no telemetry. Network calls to the selected AI provider and opened websites occur only when initiated by the user.

## Report a concern

Report suspected security issues privately to the repository owner through GitHub Security Advisories. Do not include API keys, credentials, or personal data in public issues.
