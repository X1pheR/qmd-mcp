# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose indexed private content, authentication material or administrative access. Use GitHub private vulnerability reporting when available, or contact the repository owner through a private channel.

Do not include real private documents, credentials, tokens, index databases or model caches in a report.

## Deployment guidance

- Mount indexed source collections read-only unless a separate workflow explicitly requires writes.
- Keep index and model-cache state outside the source collection.
- Expose the MCP endpoint only on a trusted network boundary or behind an authenticated MCP gateway.
- Treat `start_update`, `start_embed` and reranked-query operations as resource-consuming administrative actions.
- Use immutable release image digests in production.
- Review upstream QMD changes before accepting dependency updates, especially changes to MCP transport, retrieval, embedding, native model runtimes or filesystem behavior.

The MCP protocol and this server do not provide an authentication boundary by themselves.
