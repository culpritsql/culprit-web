"""Exercise empty and attributed incident windows through signed-in browsers and native storage."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
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


def browse(directory, ports, pipeline, prefix, journey):
    config = json.loads((ROOT / "config/archive.example.json").read_text())
    config["pipeline"] = pipeline
    config["credentials"]["warehouse-read"].update(username="culprit_fixture", variable="CULPRIT_FIXTURE_PASSWORD")
    config["warehouse"]["options"] = {
        "endpoint": "http://127.0.0.1:" + ports["CULPRIT_TEST_CLICKHOUSE_PORT"],
        "database": "culprit_fixture",
    }
    config["recovery"]["options"].update(
        bucket="delivery-fixture", region="us-east-1", prefix=prefix,
        endpoint="http://127.0.0.1:" + ports["CULPRIT_TEST_S3_PORT"],
    )
    archive = directory / "archive.json"
    archive.write_text(json.dumps(config))
    keys = directory / "credentials"
    keys.write_text("[culprit-archive-reader]\naws_access_key_id=fixture-access-key\naws_secret_access_key=fixture-secret-key\n")
    keys.chmod(0o600)
    environment = {**os.environ, "CULPRIT_FIXTURE_ARCHIVE": str(archive),
                   "CULPRIT_FIXTURE_PASSWORD": "owned-fixture-password",
                   "AWS_CONFIG_FILE": str(directory / "aws-config"), "AWS_SHARED_CREDENTIALS_FILE": str(keys),
                   "AWS_EC2_METADATA_DISABLED": "true"}
    server = subprocess.Popen(["node", "tests/serve.mjs"], cwd=ROOT, env=environment)
    try:
        wait_for_app(server)
        subprocess.run(["node", str(ROOT / "tests/native" / journey)], cwd=ROOT, check=True, timeout=200)
    finally:
        server.terminate()
        server.wait(timeout=20)


def main():
    subprocess.run(["cargo", "build", "--locked", "--example", "publish-incident-fixture"], cwd=ROOT, check=True)
    binary = test_binary("culprit-blob-s3")
    with load_fixture("s3")() as recovery, load_fixture("clickhouse")() as warehouse:
        ports = {**recovery, **warehouse}
        run_test(binary, "tests::s3_recovery_clickhouse_delivery_and_restart", ports)
        with tempfile.TemporaryDirectory(prefix="culprit-web-native-") as scratch:
            directory = Path(scratch)
            browse(directory, ports, "s3-clickhouse", "pipeline/shard", "fleet.mjs")
            subprocess.run([ROOT / "target/debug/examples/publish-incident-fixture"], cwd=ROOT,
                           env={**os.environ, **ports}, check=True, timeout=120)
            browse(directory, ports, "incident-browser", "incident/shard", "incident.mjs")


if __name__ == "__main__":
    main()
