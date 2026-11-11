# Ingress and firewall

Slipway has one default traffic path:

```text
Internet -> Caddy (80/443) -> Slipway dashboard or app container
```

On a fresh installation, only Caddy binds publicly. The dashboard binds to
`127.0.0.1:1337`, deployed apps bind to loopback ports in `1338-1500`, and
Caddy reaches every container over the private `slipway` Docker network. The
initial dashboard URL also passes through Caddy, so setup does not require a
temporary public dashboard port.

Deployments, rollbacks and update validation share the port allocator. It checks
app records, atomic reservations and the Docker host's published TCP ports before
probing a local socket. A free socket inside the dashboard container does not
prove the host port is free. Published numbers on any IPv4 or IPv6 interface are
excluded from Slipway's shared pool, including port ranges. Unpublished container
ports and UDP mappings do not consume that TCP pool.

If Docker binding discovery fails or returns an unreadable response, allocation
stops without changing reservations. Verify Docker daemon/socket access and retry.
An external process can still acquire a port between discovery and container
startup; Docker remains the final authority. This check covers Docker publications,
not arbitrary host listeners hidden from the dashboard's network namespace.

## Default public VPS mode

The normal installer uses this contract:

| Port        | Default binding      | Purpose                               |
| ----------- | -------------------- | ------------------------------------- |
| `22`        | Provider/host choice | SSH; Slipway does not change it       |
| `80`        | `0.0.0.0`            | Caddy HTTP and certificate challenges |
| `443`       | `0.0.0.0`            | Caddy HTTPS                           |
| `1337`      | `127.0.0.1`          | Slipway dashboard behind Caddy        |
| `1338-1500` | `127.0.0.1`          | App containers behind Caddy           |

The installer aligns active UFW or firewalld rules with these bindings. It does
not enable a firewall or edit SSH policy. Match the same contract in the VPS
provider firewall: allow inbound TCP `80` and `443`, retain your chosen SSH
rule, and deny the rest.

Check the effective Docker bindings after installation:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
sudo ss -lntp
```

`slipway-proxy` should show public `80` and `443`. `slipway` and deployed apps
should show `127.0.0.1` bindings.

## Explicit raw IP and port access

Direct `http://SERVER_IP:PORT` URLs are useful for diagnostics or deployments
without DNS, but they bypass Caddy TLS and increase the public attack surface.
For a **fresh installation only**, request them deliberately:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env SLIPWAY_APP_PORT_HOST=0.0.0.0 bash /tmp/install-slipway.sh
```

The value is persisted in `/etc/slipway/.env` and used for future app containers.
Only allow TCP `1338-1500` in the VPS provider firewall when that public access is
intended. Verify the effective Docker binding and test from another network:

```bash
curl -I --connect-timeout 5 http://SERVER_IP:ALLOCATED_PORT/health
```

For an already installed dashboard, use the constraints below. Rerunning the
installer is not a way to enable or disable raw-port access.

## Existing installations

The shared updater preserves the running container's environment and Docker
bindings, as well as the proxy and firewall. A version update does **not** harden
an old installation, change ingress mode, or apply changes from `/etc/slipway/.env`.
Existing app containers retain their own bindings until replaced.

When an existing dashboard container is detected, `install.sh` refuses explicitly
supplied URL, ingress, host/port, Docker network and firewall configuration
variables before starting an update. It prints the variable names, not their
values. Even supplying the same value is a reconfiguration request; omit those
variables for a version-only update. The installer does not compare them with
live settings or claim that your current exposure is safe.

There is currently no supported in-place ingress reconfiguration command. Do not
use older instructions that pass `SLIPWAY_DASHBOARD_HOST=127.0.0.1` and
`SLIPWAY_APP_PORT_HOST=127.0.0.1` to a normal update: those settings were previously
ignored on the shared-updater path. Editing the env file alone also does not
change a running Docker publication.

Before a separately reviewed host migration:

1. Record actual Docker publications, the working dashboard/app routes, host and
   provider firewall rules, and a tested SSH or other recovery path. Keep secret
   values out of support logs.
2. Plan the dashboard, proxy and future-app binding changes together, including
   how to recreate affected containers without losing their configuration,
   mounts, secrets or recovery access. Do not remove the running dashboard just
   to make the installer treat the host as fresh.
3. Verify dashboard login, CLI access, application domains, webhooks and streaming
   connections through the intended route. Verify both IPv4 and IPv6 exposure
   from another network; a localhost check cannot prove an internet port is shut.
4. Verify replaced app bindings, then close obsolete raw ports in the host and
   provider firewalls. Preserve the reviewed rollback and recovery path.

Loopback bindings prevent direct public access to those Docker ports. They do
not make the dashboard private when Caddy or a tunnel still routes its public
hostname. Access policy is a separate operator responsibility.

## Optional Cloudflare Tunnel mode

Cloudflare Tunnel is optional. It changes the traffic path to:

```text
Internet -> Cloudflare -> outbound cloudflared tunnel -> loopback Caddy -> container
```

For a **fresh installation**, use a real dashboard hostname and tunnel ingress.
Existing hosts require the separately reviewed migration described above:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env \
  SLIPWAY_INGRESS=cloudflare-tunnel \
  SLIPWAY_URL=https://slipway.example.com \
  bash /tmp/install-slipway.sh
```

On a fresh installation, this binds Caddy, the dashboard, and app ports to
`127.0.0.1`. Caddy serves
plain HTTP only on the private origin connection; Cloudflare owns browser TLS.
Point the tunnel at loopback Caddy and keep the original request hostname so
Caddy can select the correct Slipway route:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: slipway.example.com
    service: http://127.0.0.1:80
  - hostname: '*.apps.example.com'
    service: http://127.0.0.1:80
  - service: http_status:404
```

Validate and start the locally managed tunnel:

```bash
cloudflared tunnel ingress validate
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Do not set `httpHostHeader`; Slipway and Caddy use the incoming hostname for
routing. Add every custom app domain as a Cloudflare Tunnel public hostname (or
use a wildcard for the generated app domain). Webhooks, streaming telemetry,
SSE, and CLI requests use ordinary HTTP through the same route.

Cloudflare Tunnel uses outbound connections. The provider firewall can deny
all inbound Slipway ports and keep only the SSH access you choose. A restrictive
egress firewall must permit Cloudflare Tunnel on TCP/UDP `7844`. See
[Cloudflare's tunnel firewall guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)
and [ingress configuration reference](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/).

A tunnel alone does not make a public hostname private or configure Cloudflare
Access, WAF rules or bot protection. Verify any separately configured access
policy without breaking required CLI, webhook and streaming traffic.

Tradeoffs: Tunnel mode depends on Cloudflare for public availability and DNS,
and every custom hostname must be routed through that tunnel. The default public
mode has fewer moving parts and remains the recommended starting point.

For an existing Coolify installation, use the
[three-app migration runbook](coolify-migration.md) to connect this contract to
source/configuration inventory, disposable recovery checks, and cutover decisions.
