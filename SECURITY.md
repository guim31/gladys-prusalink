# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- the PrusaLink passwords (or API keys), in the Gladys configuration (`secret`
  fields, never sent back to the browser by Gladys) — never in `/data`, never
  in the logs. HTTP Digest authentication sends a hash of the password, not
  the password itself; the API key of an older firmware is sent as a header;
- `/data/prusalink-state.json`: what each configured printer has (name,
  filament type, camera), no secret;
- network: HTTP(S) requests to the printer addresses the administrator
  entered, on the local network. No other outbound connection, no cloud.
  Redirects are not followed, so a password is never sent to another address.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the printers and PrusaLink themselves (Prusa Research).
