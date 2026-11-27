"""Exercise empty and attributed incident windows through signed-in browsers and native storage."""
from contextlib import ExitStack, contextmanager
import argparse
import importlib.util
import json
import os
import secrets
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM_DEV = ROOT / "vendor/culprit/dev"
sys.path.insert(0, str(UPSTREAM_DEV))
from telemetry_fixture import run_test, test_binary


def load_fixture(name):
    spec = importlib.util.spec_from_file_location(name, UPSTREAM_DEV / f"smoke-{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.fixture


def wait_for_app(server):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError("The fixture web process exited during startup")
        try:
            with urllib.request.urlopen("http://127.0.0.1:4387/healthz", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError("The fixture web process did not become ready")


def warehouse_reader(port, region):
    username = f"reader_{region}"
    password = secrets.token_hex(24)
    variable = f"CULPRIT_FIXTURE_{region.upper()}_PASSWORD"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for statement in (f"CREATE USER {username} IDENTIFIED WITH sha256_password BY '{password}'",
                      f"GRANT SELECT ON culprit_fixture.* TO {username}"):
        request = urllib.request.Request(f"http://127.0.0.1:{port}/", method="POST", data=statement.encode(),
                                         headers={"X-ClickHouse-User": "culprit_fixture",
                                                  "X-ClickHouse-Key": "owned-fixture-password"})
        with opener.open(request, timeout=10) as response:
            response.read()
    return {"username": username, "variable": variable}, {variable: password}


def archive_config(directory, ports, pipeline, prefix, reader):
    config = json.loads((ROOT / "config/archive.example.json").read_text())
    config["pipeline"] = pipeline
    config["credentials"]["warehouse-read"].update(reader)
    config["warehouse"]["options"] = {
        "endpoint": "http://127.0.0.1:" + ports["CULPRIT_TEST_CLICKHOUSE_PORT"],
        "database": "culprit_fixture",
    }
    config["recovery"]["options"].update(
        bucket="delivery-fixture", region="us-east-1", prefix=prefix,
        endpoint="http://127.0.0.1:" + ports["CULPRIT_TEST_S3_PORT"],
    )
    archive = directory / (pipeline + ".json")
    archive.write_text(json.dumps(config))
    return str(archive)


def clickhouse_archive(stores, directory, binary, region, *, publish_incident=False):
    ports = {**stores.enter_context(load_fixture("s3")()),
             **stores.enter_context(load_fixture("clickhouse")())}
    run_test(binary, "tests::s3_recovery_clickhouse_delivery_and_restart", ports)
    pipeline, prefix = "s3-clickhouse", "pipeline/shard"
    if publish_incident:
        subprocess.run([ROOT / "target/debug/examples/publish-incident-fixture"], cwd=ROOT,
                       env={**os.environ, **ports}, check=True, timeout=120)
        pipeline, prefix = "incident-browser", "incident/shard"
    reader, environment = warehouse_reader(ports["CULPRIT_TEST_CLICKHOUSE_PORT"], region)
    return archive_config(directory, ports, pipeline, prefix, reader), environment


def unavailable_azure_archive(directory):
    config = json.loads((ROOT / "config/archive.azure.example.json").read_text())
    # An absent fixture assertion fails locally before token exchange or archive access.
    for profile in config["credentials"].values():
        profile["identity"] = {"kind": "workload-identity", "tenant_id": "00000000-0000-4000-8000-000000000001",
                               "client_id": "00000000-0000-4000-8000-000000000002",
                               "token_file": str(directory / "unmounted-assertion")}
    path = directory / "unavailable-azure.json"
    path.write_text(json.dumps(config))
    return str(path)


@contextmanager
def web_service(directory, archives, reader_env):
    keys = directory / "credentials"
    keys.write_text("[culprit-archive-reader]\naws_access_key_id=fixture-access-key\naws_secret_access_key=fixture-secret-key\n")
    keys.chmod(0o600)
    environment = {**os.environ, "CULPRIT_FIXTURE_ARCHIVES": json.dumps(archives),
                   **reader_env,
                   "AWS_CONFIG_FILE": str(directory / "aws-config"), "AWS_SHARED_CREDENTIALS_FILE": str(keys),
                   "AWS_EC2_METADATA_DISABLED": "true"}
    server = subprocess.Popen(["node", "tests/serve.mjs"], cwd=ROOT, env=environment)
    try:
        wait_for_app(server)
        yield
    finally:
        server.terminate()
        server.wait(timeout=20)


def acceptance_inputs():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--azure-archive", type=Path, help="read-only ADX/Blob config for a synthetic incident archive")
    parser.add_argument("--incident-link", help="investigation link for the published synthetic blocking incident")
    args = parser.parse_args()
    if bool(args.incident_link) != bool(args.azure_archive):
        parser.error("supply --azure-archive and --incident-link together")
    if not args.azure_archive:
        return None, []
    config = json.loads(args.azure_archive.read_text())
    if (config["warehouse"]["provider"], config["recovery"]["provider"]) != ("adx", "azure-blob"):
        parser.error("--azure-archive requires an ADX warehouse and Azure Blob recovery")
    query = urllib.parse.urlsplit(args.incident_link).query
    fields = urllib.parse.parse_qs(query)
    required = {"revision", "namespace", "database", "around", "incident"}
    if fields.get("archive") != ["production"] or not required <= fields.keys():
        parser.error("--incident-link must select an incident revision in the production archive")
    return str(args.azure_archive.resolve()), ["/?" + query]


def main():
    azure_archive, incident_args = acceptance_inputs()
    subprocess.run(["cargo", "build", "--locked", "--bin", "culprit-fleet"], cwd=ROOT, check=True)
    if not azure_archive:
        subprocess.run(["cargo", "build", "--locked", "--example", "publish-incident-fixture"], cwd=ROOT, check=True)
    binary = test_binary("culprit-blob-s3")
    with ExitStack() as owned:
        directory = Path(owned.enter_context(tempfile.TemporaryDirectory(prefix="culprit-web-regions-")))
        eu_stores = owned.enter_context(ExitStack())
        europe, eu_env = clickhouse_archive(eu_stores, directory, binary, "eu")
        if azure_archive:
            incident_archive, us_env = azure_archive, {}
        else:
            incident_archive, us_env = clickhouse_archive(owned, directory, binary, "us", publish_incident=True)
        archives = {"production": incident_archive, "restricted": europe, "japan": unavailable_azure_archive(directory)}
        with web_service(directory, archives, {**us_env, **eu_env}):
            fleet_args = ["--published-azure"] if azure_archive else []
            run_browser("fleet.mjs", *fleet_args)
            eu_stores.close()
            run_browser("fleet.mjs", "--europe-offline", *fleet_args)
            run_browser("incident.mjs", *incident_args)


def run_browser(journey, *args):
    subprocess.run(["node", str(ROOT / "tests/native" / journey), *args], cwd=ROOT, check=True, timeout=200)


if __name__ == "__main__":
    main()
