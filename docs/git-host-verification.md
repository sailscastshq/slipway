# Git SSH trust

Repository deployment verifies the remote SSH host before authenticating or
fetching code. GitHub's published Ed25519 host key is bundled in
`config/git_known_hosts`. Unknown or changed keys fail the deployment.

For another Git host, mount an administrator-maintained known_hosts file and set
`SLIPWAY_GIT_KNOWN_HOSTS` to its absolute path. Include all trusted hosts in that
file, including GitHub if used. Verify each host key through an independent
trusted source before adding it. An unverified `ssh-keyscan` result is not a
trust decision.

When a host rotates its key, verify the announced replacement and update the
trusted file before retrying. Slipway does not automatically accept new keys.
The deployment SSH process ignores personal SSH configuration and agents, and
uses only its temporary deploy key.

Source: [GitHub's SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
