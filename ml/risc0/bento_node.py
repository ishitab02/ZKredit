"""Scale-to-zero lifecycle for the remote Bento proving node (E2E Networks).

The RISC Zero host offloads proving to a Bento GPU cluster whenever
``BONSAI_API_URL``/``BONSAI_API_KEY`` are set (risc0-zkvm's ``default_prover``
returns a ``BonsaiProver``; Bento is Bonsai-API-compatible). This module makes
that endpoint exist on demand: it boots the E2E GPU node, tunnels to Bento's
REST API (which is deliberately bound to localhost on the node — it is
unauthenticated), health-checks it, and tears the node down after an idle
period so a mostly-idle attestor pays for GPU minutes, not GPU months.

E2E billing note (docs.e2enetworks.com): a powered-off node **keeps billing**
until terminated, so the money-saving strategy on E2E is ``e2e_recreate`` —
save a machine image of the configured node once, then terminate when idle and
recreate from that image per proof burst. ``e2e_stop`` (power_off/power_on) is
kept for plans/providers where stopped nodes don't bill; ``static`` assumes the
endpoint is already reachable (dev: a hand-opened SSH tunnel) and manages
nothing.

The E2E MyAccount API contract below (endpoints, auth = ``apikey`` query param
+ ``Authorization: Bearer``) was taken from E2E's terraform provider source
(e2eterraformprovider/terraform-provider-e2e, client/client.go).

Concurrency: one file lock (``flock``) serializes the whole prove path across
processes. Attestation volume is proofs-per-day; simplicity beats throughput.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import socket
import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx

from ml.config import get_settings

_E2E_API_BASE = "https://api.e2enetworks.com/myaccount/api/v1"
_STATE_DIR = Path(os.environ.get("ZKREDIT_BENTO_STATE_DIR", "~/.zkredit")).expanduser()
_LOCK_FILE = _STATE_DIR / "bento.lock"
_KNOWN_HOSTS = _STATE_DIR / "bento_known_hosts"  # recreated nodes get new host keys

# Node-side facts (see docs/proving-infrastructure-findings.md §9):
_BENTO_PORT = 8081  # bound to 127.0.0.1 on the node; reachable only via tunnel
_BOOT_TIMEOUT_S = 420  # image-create boot is the slow path; generous ceiling
_HEALTH_TIMEOUT_S = 180  # docker compose (restart=always) after sshd is up


class BentoNodeError(RuntimeError):
    """Remote proving infrastructure could not be made available."""


class _E2EClient:
    """Minimal E2E MyAccount API client (nodes list/get/create/action/delete)."""

    def __init__(self, api_key: str, auth_token: str) -> None:
        self._params = {"apikey": api_key}
        self._headers = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        resp = httpx.request(
            method,
            f"{_E2E_API_BASE}{path}",
            params=self._params,
            headers=self._headers,
            json=body,
            timeout=60,
        )
        if resp.status_code // 100 != 2:
            raise BentoNodeError(
                f"E2E API {method} {path} failed ({resp.status_code}): {resp.text[:500]}"
            )
        return resp.json()

    def list_nodes(self) -> list[dict]:
        return self._request("GET", "/nodes/").get("data", [])

    def get_node(self, node_id: int) -> dict:
        return self._request("GET", f"/nodes/{node_id}/").get("data", {})

    def node_action(self, node_id: int, action: str, name: str) -> None:
        self._request("POST", f"/nodes/{node_id}/actions/", {"type": action, "name": name})

    def create_node(self, name: str, plan: str, image: str) -> dict:
        return self._request(
            "POST", "/nodes/", {"name": name, "plan": plan, "image": image}
        ).get("data", {})

    def delete_node(self, node_id: int) -> None:
        self._request("DELETE", f"/nodes/{node_id}/")


def _find_node(client: _E2EClient, name: str) -> dict | None:
    """The managed node, found by its configured name (survives process restarts)."""
    matches = [n for n in client.list_nodes() if n.get("name") == name]
    return matches[0] if matches else None


def _wait(predicate, timeout_s: int, interval_s: float, what: str) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(interval_s)
    raise BentoNodeError(f"timed out after {timeout_s}s waiting for {what}")


def _ssh_ready(host: str) -> bool:
    try:
        with socket.create_connection((host, 22), timeout=5):
            return True
    except OSError:
        return False


def _free_local_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Tunnel:
    """An ssh -N -L forward from a local port to the node's Bento API."""

    def __init__(self, host: str, user: str) -> None:
        self.local_port = _free_local_port()
        self._proc = subprocess.Popen(
            [
                "ssh",
                "-N",
                "-L",
                f"{self.local_port}:localhost:{_BENTO_PORT}",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                f"UserKnownHostsFile={_KNOWN_HOSTS}",
                f"{user}@{host}",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def healthy(self) -> bool:
        if self._proc.poll() is not None:
            return False
        try:
            return (
                httpx.get(f"http://127.0.0.1:{self.local_port}/health", timeout=5).status_code
                == 200
            )
        except httpx.HTTPError:
            return False

    def close(self) -> None:
        if self._proc.poll() is None:
            self._proc.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self._proc.wait(timeout=10)


class _NodeManager:
    """Ensures the Bento endpoint exists; retires the node after idle timeout.

    One instance per process. The idle reaper is a daemon timer: if the process
    dies before it fires, the node keeps running (and billing) — recover with
    ``python -m ml.risc0.bento_node down``.
    """

    def __init__(self) -> None:
        self._mutex = threading.Lock()
        self._tunnel: _Tunnel | None = None
        self._node_id: int | None = None
        self._node_ip: str | None = None
        self._reaper: threading.Timer | None = None

    # -- lifecycle -----------------------------------------------------------

    def _client(self) -> _E2EClient:
        s = get_settings()
        if not (s.e2e_api_key and s.e2e_auth_token):
            raise BentoNodeError(
                "bento_strategy is e2e_* but E2E_API_KEY / E2E_AUTH_TOKEN are unset"
            )
        return _E2EClient(s.e2e_api_key, s.e2e_auth_token)

    def _ensure_node(self) -> str:
        """Bring the E2E node to Running and return its public IP."""
        s = get_settings()
        client = self._client()
        node = _find_node(client, s.e2e_node_name)

        if node is None:
            if s.bento_strategy != "e2e_recreate":
                raise BentoNodeError(
                    f"node {s.e2e_node_name!r} not found and strategy is {s.bento_strategy!r}"
                    " (only e2e_recreate may create nodes)"
                )
            if not (s.e2e_plan and s.e2e_saved_image):
                raise BentoNodeError(
                    "e2e_recreate needs E2E_PLAN and E2E_SAVED_IMAGE to create the node"
                )
            node = client.create_node(s.e2e_node_name, s.e2e_plan, s.e2e_saved_image)

        node_id = int(node["id"])
        if node.get("status") != "Running":
            client.node_action(node_id, "power_on", s.e2e_node_name)
        _wait(
            lambda: client.get_node(node_id).get("status") == "Running",
            _BOOT_TIMEOUT_S,
            10,
            "E2E node to reach Running",
        )
        ip = client.get_node(node_id).get("public_ip_address")
        if not ip:
            raise BentoNodeError("E2E node is Running but has no public_ip_address")
        self._node_id, self._node_ip = node_id, str(ip)
        return self._node_ip

    def _ensure_endpoint(self) -> str:
        """Return a live BONSAI_API_URL, building node + tunnel as needed."""
        if self._tunnel is not None and self._tunnel.healthy():
            return f"http://127.0.0.1:{self._tunnel.local_port}"

        if self._tunnel is not None:
            self._tunnel.close()
            self._tunnel = None

        s = get_settings()
        host = self._node_ip if self._node_ip else self._ensure_node()
        _wait(lambda: _ssh_ready(host), _BOOT_TIMEOUT_S, 5, f"sshd on {host}")
        tunnel = _Tunnel(host, s.bento_ssh_user)
        try:
            _wait(tunnel.healthy, _HEALTH_TIMEOUT_S, 5, "Bento /health through tunnel")
        except BentoNodeError:
            tunnel.close()
            # The cached IP may be stale (node was recreated); retry once fresh.
            if self._node_ip is not None:
                self._node_ip = None
                self._node_id = None
                return self._ensure_endpoint()
            raise
        self._tunnel = tunnel
        return f"http://127.0.0.1:{tunnel.local_port}"

    def _retire_node(self) -> None:
        """Idle reaper body: tear down tunnel and stop/terminate the node."""
        with self._mutex:
            s = get_settings()
            if self._tunnel is not None:
                self._tunnel.close()
                self._tunnel = None
            if self._node_id is None:
                return
            client = self._client()
            if s.bento_strategy == "e2e_recreate":
                client.delete_node(self._node_id)
            else:  # e2e_stop
                client.node_action(self._node_id, "power_off", s.e2e_node_name)
            self._node_id, self._node_ip = None, None

    def _schedule_reaper(self) -> None:
        if self._reaper is not None:
            self._reaper.cancel()
        self._reaper = threading.Timer(get_settings().bento_idle_timeout_s, self._retire_node)
        self._reaper.daemon = True
        self._reaper.start()

    # -- public --------------------------------------------------------------

    @contextlib.contextmanager
    def session(self) -> Iterator[dict[str, str]]:
        """Yield the env vars that point the host binary at a live Bento.

        Holds the cross-process lock for the whole prove so lifecycle actions
        never race; reschedules the idle reaper on exit.
        """
        _STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(_LOCK_FILE, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self._mutex:
                if self._reaper is not None:
                    self._reaper.cancel()
                url = self._ensure_endpoint()
            try:
                yield {"BONSAI_API_URL": url, "BONSAI_API_KEY": "zkredit"}
            finally:
                self._schedule_reaper()


_MANAGER = _NodeManager()


@contextlib.contextmanager
def proving_endpoint() -> Iterator[dict[str, str]]:
    """Env vars for the host subprocess, per the configured strategy.

    - ``off``: empty — the host proves locally (r0vm + Docker required).
    - ``static``: pass through the caller's ``BONSAI_API_URL``/``BONSAI_API_KEY``
      (e.g. a hand-opened dev tunnel); error if unset.
    - ``e2e_stop`` / ``e2e_recreate``: full lifecycle via :class:`_NodeManager`.
    """
    strategy = get_settings().bento_strategy
    if strategy == "off":
        yield {}
    elif strategy == "static":
        url = os.environ.get("BONSAI_API_URL")
        if not url:
            raise BentoNodeError("bento_strategy=static but BONSAI_API_URL is unset")
        yield {"BONSAI_API_URL": url, "BONSAI_API_KEY": os.environ.get("BONSAI_API_KEY", "zkredit")}
    elif strategy in ("e2e_stop", "e2e_recreate"):
        with _MANAGER.session() as env:
            yield env
    else:
        raise BentoNodeError(f"unknown bento_strategy {strategy!r}")


def remote_proving_configured() -> bool:
    """True when proofs go to a remote Bento (no local r0vm/Docker needed)."""
    return get_settings().bento_strategy != "off" or "BONSAI_API_URL" in os.environ


def _cli() -> None:
    """Ops helper: ``python -m ml.risc0.bento_node status|up|down``."""
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    s = get_settings()
    if s.bento_strategy in ("off", "static"):
        print(f"bento_strategy={s.bento_strategy}: no managed node")
        return
    client = _MANAGER._client()
    node = _find_node(client, s.e2e_node_name)
    if cmd == "status":
        if node is None:
            print(f"node {s.e2e_node_name!r}: absent")
        else:
            print(json.dumps({k: node.get(k) for k in ("id", "name", "status", "public_ip_address")}))
    elif cmd == "up":
        with _MANAGER.session() as env:
            print(f"bento live: {env['BONSAI_API_URL']} (node ip {_MANAGER._node_ip})")
            print("note: idle reaper starts when this process exits — node retires "
                  f"after {s.bento_idle_timeout_s}s unless a proof lands first")
            time.sleep(1)
    elif cmd == "down":
        if node is None:
            print("nothing to retire")
            return
        _MANAGER._node_id = int(node["id"])
        _MANAGER._retire_node()
        print(f"retired node {node['id']} ({s.bento_strategy})")
    else:
        print(f"unknown command {cmd!r} (want status|up|down)")


if __name__ == "__main__":
    _cli()
