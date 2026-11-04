from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .pipeline import LivePipeline


log = logging.getLogger("agamin.api")


class Handler(BaseHTTPRequestHandler):
    pipeline: LivePipeline
    api_key: str = ""

    def _send(self, status: int, payload: dict | list, cache_seconds: int = 0) -> None:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", f"public, max-age={cache_seconds}" if cache_seconds else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not self.api_key:
            return False
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return hmac.compare_digest(self.api_key, supplied)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(HTTPStatus.NO_CONTENT, {})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/", "/health", "/api/health"}:
            self._send(HTTPStatus.OK, self.pipeline.health())
        elif path == "/api/models":
            models = {symbol: list(self.pipeline.runtime.models_for_symbol(symbol)) for symbol in self.pipeline.runtime.symbols}
            self._send(HTTPStatus.OK, {"models": models}, 300)
        elif path == "/api/predictions":
            self._send(HTTPStatus.OK, {"predictions": self.pipeline.cache.all_predictions()}, 60)
        elif path == "/api/best":
            summary = json.loads((self.pipeline.repo_root / "grok_study_best_v2" / "summary.json").read_text())
            self._send(HTTPStatus.OK, {"best_by_horizon": summary}, 3600)
        else:
            self._send(HTTPStatus.NOT_FOUND, {"success": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in {"/api/predict", "/api/admin/refresh"}:
            self._send(HTTPStatus.NOT_FOUND, {"success": False, "error": "not found"})
            return
        if path == "/api/admin/refresh" and not self._authorized():
            self._send(HTTPStatus.UNAUTHORIZED, {"success": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 1_000_000:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/admin/refresh":
                self._send(HTTPStatus.ACCEPTED, self.pipeline.refresh_all())
                return
            horizons = payload.get("horizons")
            if horizons is not None and not isinstance(horizons, list):
                raise ValueError("horizons must be an array")
            result = self.pipeline.predict(payload.get("coin"), horizons)
            self._send(HTTPStatus.OK, result, 60)
        except ValueError as error:
            self._send(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(error)})
        except Exception as error:
            log.exception("request failed")
            self._send(HTTPStatus.SERVICE_UNAVAILABLE, {"success": False, "error": str(error)})


def serve(host: str, port: int, pipeline: LivePipeline, api_key: str = "") -> None:
    handler = type("ConfiguredHandler", (Handler,), {"pipeline": pipeline, "api_key": api_key})
    server = ThreadingHTTPServer((host, port), handler)
    pipeline.start()
    log.info("Agamin live ML API listening on %s:%d", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        pipeline.stop()
        server.server_close()


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("AGAMIN_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("AGAMIN_PORT", "8000")))
    parser.add_argument("--state-dir", type=Path, default=Path(os.getenv("AGAMIN_STATE_DIR", root / ".runtime")))
    parser.add_argument("--workers", type=int, default=int(os.getenv("AGAMIN_WORKERS", "0")) or None)
    args = parser.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    pipeline = LivePipeline(root, args.state_dir, args.workers)
    serve(args.host, args.port, pipeline, os.getenv("AGAMIN_API_KEY", ""))


if __name__ == "__main__":
    main()
