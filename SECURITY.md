# Security Policy

## Supported versions

Security fixes are released for the latest published version of the
extension. Older versions are not patched separately — please update to the
newest release.

## Reporting a vulnerability

Please use
[GitHub private vulnerability reporting](https://github.com/Beata-Humeniuk/jira-to-md/security/advisories/new)
so the issue is not public before a fix exists. If that is not possible,
open a regular issue **without** the sensitive details and ask for a private
channel.

## What not to post

Jira issues usually describe internal systems. In any report — public
or private:

- do **not** attach real issue content, internal URLs or hostnames, or
  anything under NDA;
- do **not** include Jira tokens, credentials, or personal data.

A minimal **synthetic** issue with made-up content that reproduces the problem
is all that is needed.

## Scope notes

The extension connects **only** to the Jira host taken from a link the
user pastes, sends no telemetry, and makes no other network requests. The
token is read from VS Code settings and sent only to that host as an
`Authorization` header. Anything
contradicting that — a request to another host, token data written anywhere
else — is a security bug; please report it.
