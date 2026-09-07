# CLI credentials

On POSIX systems, Slipway stores credentials in a `0700` directory and a `0600`
file. Reading an older configuration repairs its permissions. Credential writes
use a private temporary file, flush it, then atomically replace `config.json`.
Symlinked credential directories and reads are rejected. Windows access remains
governed by the user's profile ACLs; POSIX mode bits do not configure Windows ACLs.

Normal API requests have a 30-second deadline; source uploads have a two-minute
deadline. A timeout does not prove the server cancelled a mutation. Check its
status before retrying. Interactive event streams retain their own lifecycle.
