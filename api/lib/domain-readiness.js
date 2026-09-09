// Saving a route does not prove public DNS propagation or certificate issuance.
module.exports = function domainReadiness({
  domain,
  serverIp,
  routeVerified = false
}) {
  return {
    domain: domain || null,
    dnsTarget: serverIp || null,
    dns: 'unverified',
    route: routeVerified ? 'verified' : 'unverified',
    tls: 'unverified',
    nextAction: domain
      ? 'Point DNS to this server and allow public ports 80 and 443. Open the HTTPS URL to verify certificate issuance.'
      : 'Use the generated hostname when configured, or check the app access link. HTTPS depends on the hostname and ingress configuration.'
  }
}
