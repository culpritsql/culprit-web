// Disposable loopback identity provider for the browser suite. Uses fresh keys and one-use codes.
import http from "node:http";
import { generateKeyPairSync, randomUUID, createHash, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const base = "http://127.0.0.1:4387";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const codes = new Map();
const fixture = await mkdtemp(join(tmpdir(), "culprit-web-test-"));
let issuer;
const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  const send = (o) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(o));
  };
  switch (url.pathname) {
    case "/tenant/.well-known/openid-configuration":
      return send({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/keys",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    case "/tenant/keys":
      return send({ keys: [jwk] });
    case "/tenant/authorize": {
      if (
        url.searchParams.get("code_challenge_method") !== "S256" ||
        url.searchParams.get("redirect_uri") !== base + "/auth/callback/company"
      ) {
        res.writeHead(400);
        return res.end();
      }
      const flow = randomUUID();
      codes.set(flow, Object.fromEntries(url.searchParams));
      res.setHeader("Content-Type", "text/html");
      return res.end(
        '<form action="/tenant/select"><input type="hidden" name="flow" value="' +
          flow +
          '"><button name="role" value="DBA">DBA</button><button name="role" value="Viewer">Viewer</button><button name="role" value="Guest">Guest</button></form>',
      );
    }
    case "/tenant/select": {
      const flow = url.searchParams.get("flow");
      const info = codes.get(flow);
      codes.delete(flow);
      if (!info) {
        res.writeHead(400);
        return res.end();
      }
      const code = randomUUID();
      codes.set(code, { ...info, role: url.searchParams.get("role") });
      const callback = new URL(info.redirect_uri);
      callback.search = new URLSearchParams({ code, state: info.state });
      res.writeHead(302, { location: callback.href });
      return res.end();
    }
    case "/tenant/token": {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = new URLSearchParams(body);
      const code = data.get("code");
      const info = codes.get(code);
      codes.delete(code);
      if (
        !info ||
        req.headers.authorization !== "Basic " + Buffer.from("culprit:fixture-secret").toString("base64") ||
        createHash("sha256")
          .update(data.get("code_verifier") || "")
          .digest("base64url") !== info.code_challenge
      ) {
        res.writeHead(400);
        return res.end();
      }
      const now = Math.floor(Date.now() / 1000);
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const signed =
        encode({ alg: "RS256", kid: "test-key" }) +
        "." +
        encode({
          iss: issuer,
          sub: "test-user",
          aud: "culprit",
          iat: now,
          exp: now + 300,
          nonce: info.nonce,
          roles: [info.role],
        });
      return send({
        access_token: "unused-fixture-token",
        token_type: "Bearer",
        id_token: signed + "." + sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url"),
      });
    }
    default:
      res.writeHead(404);
      res.end();
  }
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
issuer = "http://127.0.0.1:" + provider.address().port + "/tenant";
const secret = join(fixture, "secret");
await writeFile(secret, "fixture-secret", { mode: 0o600 });
const cfg = {
  public_url: base,
  archive_name: "production",
  evidence_config: "config/archive.example.json",
  auth: {
    providers: [
      { id: "company", label: "Company SSO", issuer, client_id: "culprit", client_secret_file: secret },
    ],
    grants: [
      {
        provider: "company",
        archive: "production",
        claim: "roles",
        value: "DBA",
        permissions: ["view_reports", "inspect_evidence"],
      },
      {
        provider: "company",
        archive: "production",
        claim: "roles",
        value: "Viewer",
        permissions: ["view_reports"],
      },
    ],
  },
};
const path = join(fixture, "web.json");
await writeFile(path, JSON.stringify(cfg));
const server = spawn(process.env.CULPRIT_WEB_BINARY || "target/debug/culprit-web", [path], {
  stdio: "inherit",
  env: { ...process.env, CULPRIT_WAREHOUSE_PASSWORD: "test-only", CULPRIT_WEB_BIND: "127.0.0.1:4387" },
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.kill("SIGTERM");
  provider.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.on("exit", async (code) => {
  provider.close();
  await rm(fixture, { recursive: true, force: true });
  process.exit(code ?? 0);
});
