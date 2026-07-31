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
Enable them deliberately by running the installer with:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env SLIPWAY_APP_PORT_HOST=0.0.0.0 bash /tmp/install-slipway.sh
```

The value is persisted in `/etc/slipway/.env`. Redeploy an app before testing
its direct URL so Docker recreates that app with the new binding, then allow
TCP `1338-1500` in the VPS provider firewall. Verify from another network:

```bash
curl -I --connect-timeout 5 http://SERVER_IP:ALLOCATED_PORT/health
```

Set `SLIPWAY_APP_PORT_HOST=127.0.0.1` and rerun the installer to return to
Caddy-only ingress. Redeploy existing apps and remove the range from the VPS
provider firewall; existing containers retain their old Docker bindings until
they are replaced.

Older Slipway installations keep their existing public dashboard and app bind
defaults the first time the new installer migrates them. This avoids silently
breaking working raw URLs. Set both of these values to loopback when you are
ready to harden an existing host:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env \
  SLIPWAY_DASHBOARD_HOST=127.0.0.1 \
  SLIPWAY_APP_PORT_HOST=127.0.0.1 \
  bash /tmp/install-slipway.sh
```

Then redeploy the apps and close `1337` and `1338-1500` in the provider
firewall.

## Optional Cloudflare Tunnel mode

Cloudflare Tunnel is optional. It changes the traffic path to:

```text
Internet -> Cloudflare -> outbound cloudflared tunnel -> loopback Caddy -> container
```

Install Slipway with a real dashboard hostname and tunnel ingress:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env \
  SLIPWAY_INGRESS=cloudflare-tunnel \
  SLIPWAY_URL=https://slipway.example.com \
  bash /tmp/install-slipway.sh
```

This binds Caddy, the dashboard, and app ports to `127.0.0.1`. Caddy serves
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

Tradeoffs: Tunnel mode depends on Cloudflare for public availability and DNS,
and every custom hostname must be routed through that tunnel. The default public
mode has fewer moving parts and remains the recommended starting point.
