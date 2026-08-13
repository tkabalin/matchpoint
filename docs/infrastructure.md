# MatchPoint Infrastructure

This document records the infrastructure decisions for the MatchPoint capstone project and the
rationale behind each choice.

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

**RackZAR** was chosen for its Cape Town data centre (low latency), reasonable pricing, and a 99.9%
uptime guarantee with backup power.

**Ubuntu 24 LTS** was chosen over 26 LTS on stability grounds: it has been around for longer and is
therefore less likely to run into issues than a newer release.

**Backup timing**: daily snapshot backups run at 02:00, outside peak traffic and development hours.

**Domain**: `thomaskabalin.com` is a personal domain, already owned. MatchPoint is on its
`matchpoint` subdomain.

## Access & Security

**Principle of least privilege** governs SSH access; access is limited to what's needed, nothing
more.

**Non-root operation**: a standard user account (`thomas`) is used for day-to-day access instead of
root, in order to:

- Reduce the blast radius of mistakes (accidental destructive commands are scoped to what that user
  can do)
- Increase auditability (actions are attributable to a named user rather than a shared root account)

### Hardening checklist

- Non-root user (`thomas`) with sudo privileges, key-only SSH authentication
- Root login disabled
- Password authentication disabled
- Unattended security upgrades enabled
- Fail2ban monitoring SSH
- UFW firewall: SSH open to any source; HTTP/HTTPS restricted to Cloudflare's published IP ranges
  only, not open to the internet
- 2GB swap configured

### Terminal access

**Terminus** is for urgent SSH from mobile when away from the development machine, so the server is
reachable outside working hours.

## CI/CD Runner

The GitLab self-hosted runner is **not** on the production VPS. It runs on **ThinkTank**, a homelab
machine that already runs Docker and other services. It's there instead of on the VPS because:

- Runner downtime is acceptable, as it only affects CI/CD pipeline execution, not the live
  application
- Keeping it off the VPS preserves the production server's limited resources for actually serving
  MatchPoint

It uses the **Docker executor**: every job runs in its own container, and the host's Docker socket
is mounted in so image builds go to the host daemon and reuse its layer cache between pipelines.

**How many jobs run at once is a runner-side setting**, configured on ThinkTank and not in this
repository. It is the ceiling on pipeline parallelism regardless of what the pipeline definition
allows — a job graph with no barriers in it still runs single-file if the runner will only take one
job at a time, and this is the first thing to check when pipeline wall-clock doesn't match the
graph. The value is sized against ThinkTank's core count and the other services competing for them,
so it is recorded with the runner's own documentation rather than duplicated here.

## DNS & CDN

**Cloudflare** handles DNS, chosen for:

- **Origin IP hiding**: with the proxy enabled, only Cloudflare's IPs are publicly visible, not the
  VPS's actual IP. This reduces exposure to opportunistic scanning and exploit bots probing the box
  directly, which is a genuine risk for cheap South African VPS IP ranges.
- **Basic DDoS absorption**: free and automatic, no configuration needed.

Origin IP hiding only holds if the origin actually refuses direct connections — otherwise anyone who
finds the real IP (DNS history, a scan of the hosting provider's ranges, a misconfigured record)
connects straight to the VPS and skips Cloudflare's protections entirely. UFW closes that gap:
inbound 80/443 is allowed only from Cloudflare's published IP ranges
(`https://www.cloudflare.com/ips-v4` and `/ips-v6`), not `Anywhere`, for both IPv4 and IPv6.

## Uptime monitoring

**Better Stack** checks `https://matchpoint.thomaskabalin.com/api/health` every 3 minutes (its
free-tier floor) and posts to the team Slack channel via Better Stack's Slack integration on both
failure and recovery. Locations are left at the default: at least four, with an incident raised only
once the check fails from three of them, so one prober's view of reachability can't declare an
outage. This complements the pipeline's post-deploy smoke check, which only proves production worked
at the moment of deploying.

**It matches the response body, not the status code** — the check passes only if the response
contains `"status":"ok"`. Caddy answers any unmatched path with the SPA shell, so a routing mistake
can serve `index.html` and a `200` to an API URL; requiring the payload means nothing but the API
container answering will pass.

Checks must target the public hostname, not the origin IP: UFW allows 80/443 only from Cloudflare's
ranges. So this watches the whole public path, Cloudflare included, and can't on its own tell a
proxy problem from an origin one.
