import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Check,
  Copy,
  KeyRound,
  Play,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { api, type Session } from "./api";

type ConfigTab = "claude" | "cursor" | "entra" | "playground";

const MCP_TOOLS = [
  {
    name: "list_archives",
    summary: "Discover authorized scale units, regions & RBAC permissions",
  },
  {
    name: "fleet_overview",
    summary: "Query degraded DBs, incidents, CPU/Memory & silent collectors",
  },
  {
    name: "investigate_incident",
    summary: "Inspect root cause, blocking head session, SQL & fix guidance",
  },
  {
    name: "query_database_window",
    summary: "Read Top SQL, wait intervals, deadlocks & ranked DDL fixes",
  },
  {
    name: "diff_execution_plans",
    summary: "Parse & diff SQL Server, PostgreSQL or MySQL execution plans",
  },
];

function CopySnippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mcp-code-box">
      <div className="mcp-code-head">
        <span>{label}</span>
        <button
          type="button"
          className="chip"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

export function McpButton({
  providers,
}: {
  providers: Session["providers"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="top-pill"
        aria-label="Connect coding agent via MCP"
        title="Connect coding agents via Model Context Protocol (MCP)"
        onClick={() => setOpen(true)}
      >
        <Bot size={14} />
        <span className="top-pill-label">MCP</span>
      </button>
      {open && (
        <McpModal providers={providers} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function McpModal({
  providers,
  onClose,
}: {
  providers: Session["providers"];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>("claude");
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://fleet.example.com";
  const endpoint = `${origin}/mcp`;
  const primaryProvider = providers[0];
  const clientId =
    primaryProvider?.client_id || "<ENTRA-APP-CLIENT-ID>";
  const issuer =
    primaryProvider?.issuer ||
    "https://login.microsoftonline.com/<TENANT-GUID>/v2.0";

  const claudeCmd = `# 1. Zero-secret Microsoft Entra ID OAuth 2.1 (auto-discovers /.well-known/oauth-protected-resource)
claude mcp add --transport http culprit-fleet "${endpoint}"

# 2. Or pass a short-lived Entra ID token minted from your signed-in Azure CLI session
TOKEN="$(az account get-access-token --resource api://${clientId} --query accessToken -o tsv)"
claude mcp add --transport http culprit-fleet "${endpoint}" \\
  --header "Authorization: Bearer \${TOKEN}"`;

  const cursorJson = JSON.stringify(
    {
      mcpServers: {
        "culprit-fleet": {
          type: "streamable-http",
          url: endpoint,
          headers: {
            Authorization: "Bearer ${env:CULPRIT_MCP_TOKEN}",
          },
        },
      },
    },
    null,
    2,
  );

  const entraNotes = `Issuer:     ${issuer}
Client ID:  ${clientId}
Audience:   api://${clientId}  (or ${clientId})
Discovery:  ${origin}/.well-known/oauth-protected-resource

# Mint a token locally with Azure CLI (inherits your MFA + Entra roles):
export CULPRIT_MCP_TOKEN="$(az account get-access-token \\
  --resource api://${clientId} \\
  --query accessToken -o tsv)"`;

  const runLiveTest = async (
    method: string,
    params: Record<string, unknown>,
  ) => {
    setRunning(true);
    try {
      const res = await api.mcp({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      });
      setOutput(JSON.stringify(res, null, 2));
    } catch (err) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return createPortal(
    <div
      className="palette-backdrop mcp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mcp-modal panel"
        role="dialog"
        aria-modal="true"
        aria-label="Connect coding agent via MCP"
      >
        <header className="mcp-modal-head">
          <div className="mcp-modal-title">
            <span className="mcp-title-icon">
              <Bot size={18} />
            </span>
            <div>
              <h2>Model Context Protocol (MCP) Server</h2>
              <small>
                Streamable HTTP endpoint · Microsoft Entra ID / OIDC RBAC &amp;
                audit logging
              </small>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close MCP modal"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="mcp-modal-body">
          <div className="mcp-security-banner">
            <ShieldCheck size={16} />
            <div>
              <strong>Same Entra ID identity, zero shared static keys</strong>
              <p>
                <code>POST /mcp</code> verifies Microsoft Entra ID / OIDC JWTs
                against cached JWKS, maps <code>roles</code> / group claims
                through the exact same <code>Access::from_claims</code> database
                grants as the web UI, and records every tool call in{" "}
                <code>access_audit</code>.
              </p>
            </div>
          </div>

          <nav className="drawer-tabs mcp-tabs" aria-label="MCP setup guides">
            <button
              type="button"
              data-active={tab === "claude"}
              onClick={() => setTab("claude")}
            >
              <Terminal size={14} />
              Claude Code
            </button>
            <button
              type="button"
              data-active={tab === "cursor"}
              onClick={() => setTab("cursor")}
            >
              <Bot size={14} />
              Cursor &amp; VS Code
            </button>
            <button
              type="button"
              data-active={tab === "entra"}
              onClick={() => setTab("entra")}
            >
              <KeyRound size={14} />
              Entra ID Auth
            </button>
            <button
              type="button"
              data-active={tab === "playground"}
              onClick={() => setTab("playground")}
            >
              <Play size={14} />
              Live Tester
            </button>
          </nav>

          {tab === "claude" && (
            <CopySnippet
              label="Terminal — add Streamable HTTP MCP server"
              code={claudeCmd}
            />
          )}

          {tab === "cursor" && (
            <CopySnippet
              label=".cursor/mcp.json or .vscode/mcp.json"
              code={cursorJson}
            />
          )}

          {tab === "entra" && (
            <CopySnippet
              label="Microsoft Entra ID App Registration & RFC 9728 Metadata"
              code={entraNotes}
            />
          )}

          {tab === "playground" && (
            <div className="mcp-playground">
              <div className="mcp-playground-actions">
                <button
                  type="button"
                  className="button button-accent"
                  disabled={running}
                  onClick={() => runLiveTest("tools/list", {})}
                >
                  <Play size={13} />
                  Run tools/list
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={running}
                  onClick={() =>
                    runLiveTest("tools/call", {
                      name: "list_archives",
                      arguments: {},
                    })
                  }
                >
                  <Play size={13} />
                  Call list_archives
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={running}
                  onClick={() =>
                    runLiveTest("tools/call", {
                      name: "fleet_overview",
                      arguments: {
                        archive: "Demo estate",
                        attention_only: true,
                      },
                    })
                  }
                >
                  <Play size={13} />
                  Call fleet_overview
                </button>
              </div>
              <pre className="mcp-playground-out">
                {output ||
                  "// Click a button above to send a live JSON-RPC 2.0 request to POST /mcp"}
              </pre>
            </div>
          )}

          <div className="mcp-tools-section">
            <h3>Exposed read-only investigation tools (5)</h3>
            <div className="mcp-tool-list">
              {MCP_TOOLS.map((t) => (
                <div key={t.name} className="mcp-tool-chip">
                  <code>{t.name}</code>
                  <small>{t.summary}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
