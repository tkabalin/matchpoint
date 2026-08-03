# MatchPoint Infrastructure

This document records the infrastructure decisions for the MatchPoint capstone project and the rationale behind each choice.

## Server

| Decision | Choice                         |
| -------- | ------------------------------ |
| Host     | RackZAR (https://rackzar.com/) |
| VPS      | Linux VPS - KLX1               |
| Cost     | R99 per month                  |
| vCPU     | 1 Core                         |
| RAM      | 2 GB                           |
| Storage  | 25 GB NVME                     |
| OS       | Ubuntu 24 LTS                  |
| Domain   | `matchpoint.thomaskabalin.com` |
| Backups  | Daily snapshots at 02:00       |

**RackZAR** was chosen for low latency, offering a Cape Town–based data centre, alongside good pricing, sufficient specs for the project's needs, and a solid uptime track record with a 99.9% guarantee and backup power.

**Ubuntu 24 LTS** was chosen over 26 LTS on stability grounds: it has been around for longer and is therefore less likely to run into issues than a newer release.

**Backup timing**: daily snapshot backups are scheduled for 02:00, a period of low traffic and low development activity, to minimise any impact on performance or in-progress work.

**Domain**: `thomaskabalin.com` is a personal domain, already owned, requiring no additional registration. MatchPoint is hosted on the `matchpoint` subdomain of this domain, avoiding the need to register or manage a separate domain.

## Access & Security

**Principle of least privilege** governs SSH access; access is limited to what's needed, nothing more.

**Non-root operation**: a standard user account (`thomas`) is used for day-to-day access instead of root, in order to:

- Reduce the blast radius of mistakes (accidental destructive commands are scoped to what that user can do)
- Increase auditability (actions are attributable to a named user rather than a shared root account)

### Hardening checklist

- Non-root user (`thomas`) with sudo privileges, key-only SSH authentication
- Root login disabled
- Password authentication disabled
- Unattended security upgrades enabled
- Fail2ban monitoring SSH
- UFW firewall, allowing SSH, HTTP, and HTTPS only
- 2GB swap configured

### Terminal access

**Terminus** is used for urgent or emergency SSH access to the server (e.g. from mobile, when away from the primary development machine), ensuring the server can be reached and managed promptly if an issue arises outside of normal working hours.

## CI/CD Runner

The GitLab self-hosted runner is **not** hosted on the production VPS. It runs instead on **ThinkTank**, a homelab machine, which already runs Docker alongside a number of other self-hosted services. Running the runner there rather than on the VPS is on the basis that:

- Runner downtime is acceptable, as it only affects CI/CD pipeline execution, not the live application
- Keeping it off the VPS preserves the production server's limited resources for actually serving MatchPoint

## DNS & CDN

**Cloudflare** handles DNS, chosen for:

- **Origin IP hiding**: with the proxy enabled, only Cloudflare's IPs are publicly visible, not the VPS's actual IP. This reduces exposure to opportunistic scanning and exploit bots probing the box directly, which is a genuine risk for cheap South African VPS IP ranges.
- **Basic DDoS absorption**: provided free and automatically, with no additional configuration required.
