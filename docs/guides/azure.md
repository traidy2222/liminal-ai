# Azure integration

Liminal connects to Azure in two layers:

1. **REST tools** (`azure_check_auth`, `azure_list_subscriptions`, `azure_get_subscription`, `azure_list_locations`, `azure_list_resource_groups`, `azure_create_resource_group`, `azure_delete_resource_group`, `azure_list_resources`, `azure_list_resource_providers`, `azure_get_provider_api_versions`, `azure_get_resource`, `azure_rest_call`) — direct Azure Resource Manager calls using OAuth or `az login`. Paths are normalized (leading `/` added) and `api-version` is inferred per [Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/resources/) when omitted.
2. **MCP sidecar** (`mcp_azure_*`) — official [`@azure/mcp`](https://www.npmjs.com/package/@azure/mcp) server with tools for compute, storage, Key Vault, App Service, Cosmos DB, Monitor, and more.

## Quick start

```text
connect_provider({ provider: "azure", start_oauth: true })
connect_provider({ provider: "azure" })
```

Or from the shell:

```bash
liminal connect azure
```

Activate the family when lazy loading is on:

```text
activate_tool_family({ family: "azure" })
```

## OAuth (recommended for REST)

Uses the **same Entra app** as Microsoft 365 (`MICROSOFT_OAUTH_CLIENT_ID` in `.env`).

1. Azure Portal → App registrations → your app → **API permissions** → Add **Azure Service Management** → delegated **user_impersonation**.
2. Add redirect URI: `http://localhost:38477/oauth/azure/callback` (or your `AZURE_OAUTH_LOOPBACK_PORT`).
3. Hosted connect: `https://vireondynamics.com/connect/azure` (when available).

Tokens are stored under `~/.liminal/oauth/azure/`.

## MCP sidecar credentials

The `@azure/mcp` process uses **DefaultAzureCredential**:

- `az login` (easiest for local dev), or
- `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` in `.env`, or
- managed identity in Azure-hosted environments.

REST tools can use OAuth tokens without `az login`. The sidecar may still need `az login` for full MCP coverage unless a service principal is configured.

## Environment

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_AZURE_REST` | `1` | ARM REST tools |
| `AGENT_AZURE_SIDECAR_ENABLE` | `1` | `@azure/mcp` sidecar |
| `AGENT_AZURE_SIDECAR_PORT` | `8012` | HTTP listen port |
| `AGENT_AZURE_SIDECAR_CMD` | `npx -y @azure/mcp@latest server start` | Sidecar launch command |
| `AGENT_AZURE_CONNECT_ON_BOOT` | `0` | Auto-attach MCP when OAuth exists |

## Services filter

```text
connect_provider({
  provider: "azure",
  services: ["compute", "storage", "keyvault"],
  mode: "read_only"
})
```

`services: ["all"]` (default) runs the sidecar in `--mode all` for the full tool surface.

## Generic ARM access

For APIs not wrapped by MCP tools:

```text
azure_check_auth()
azure_list_subscriptions()
azure_rest_call({
  method: "GET",
  path: "/subscriptions"
})
```

`api-version` is added automatically (`2022-12-01` for subscriptions, `2021-04-01` for resource groups/resources). For provider-specific resources use `azure_get_provider_api_versions` or pass `api_version` to `azure_get_resource` / `azure_rest_call`.

Write methods (`POST`, `PUT`, `PATCH`, `DELETE`) require approval.
