"""CLI: ``python -m congruence_eye_ai run | simulate ...``."""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv.pop(0) if argv else "run"
    if cmd == "run":
        from .main import run

        run()
        return 0
    if cmd == "api":
        from .main import run

        run(start_runner=False)
        return 0
    if cmd in ("simulate", "sim"):
        from .simulate import main as sim_main

        return sim_main(argv)
    if cmd in ("-h", "--help", "help"):
        print("usage: python -m congruence_eye_ai [run | api | simulate --help]")
        print("  run       edge pipeline for the store of EDGE_API_KEY + HTTP API on API_PORT")
        print("  api       HTTP API only (AI-in-Checklist endpoints), no cameras")
        print("  simulate  synthetic store simulator")
        return 0
    print(f"unknown command {cmd!r}; use 'run', 'api' or 'simulate'", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
