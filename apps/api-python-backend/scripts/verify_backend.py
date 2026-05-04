#!/usr/bin/env python3
"""Stdlib-only checks for the realtime voice FastAPI spike skeleton."""

from __future__ import annotations

import ast
import pathlib
import sys
import tomllib


ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "api_python_backend"
APP = SRC / "main.py"
PYPROJECT = ROOT / "pyproject.toml"


def fail(message: str) -> None:
    print(f"verify_backend: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_text(path: pathlib.Path) -> str:
    if not path.exists():
        fail(f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def compile_sources() -> None:
    for path in sorted(SRC.rglob("*.py")):
        compile(read_text(path), str(path), "exec")


def load_pyproject() -> dict[str, object]:
    if not PYPROJECT.exists():
        fail("missing pyproject.toml")
    with PYPROJECT.open("rb") as handle:
        return tomllib.load(handle)


def normalized_dependency_names(pyproject: dict[str, object]) -> set[str]:
    project = pyproject.get("project")
    if not isinstance(project, dict):
        fail("pyproject.toml missing [project]")

    deps = project.get("dependencies")
    if not isinstance(deps, list):
        fail("pyproject.toml missing project.dependencies")

    names: set[str] = set()
    for dep in deps:
        if not isinstance(dep, str):
            fail("project.dependencies entries must be strings")
        name = dep.split(";", 1)[0].split("[", 1)[0]
        for separator in ("<", ">", "=", "!", "~"):
            name = name.split(separator, 1)[0]
        names.add(name.strip().lower())
    return names


def assert_dependencies(pyproject: dict[str, object]) -> None:
    names = normalized_dependency_names(pyproject)
    for expected in ("fastapi", "uvicorn", "websockets"):
        if expected not in names:
            fail(f"missing dependency {expected}")

    optional = pyproject.get("project", {}).get("optional-dependencies", {})
    if not isinstance(optional, dict):
        fail("pyproject.toml missing project.optional-dependencies")
    if "mlx-moshi-qwen-notes" not in optional:
        fail("missing optional MLX/Moshi/Qwen notes extra")
    if optional["mlx-moshi-qwen-notes"] != []:
        fail("MLX/Moshi/Qwen notes extra must not install packages")


def decorator_paths(tree: ast.AST) -> set[tuple[str, str]]:
    paths: set[tuple[str, str]] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            if call is None or not isinstance(call.func, ast.Attribute):
                continue
            if not call.args or not isinstance(call.args[0], ast.Constant):
                continue
            if not isinstance(call.args[0].value, str):
                continue
            paths.add((call.func.attr, call.args[0].value))
    return paths


def assert_source_contract() -> None:
    source = read_text(APP)
    tree = ast.parse(source, filename=str(APP))
    routes = decorator_paths(tree)
    if ("get", "/health") not in routes:
        fail("missing GET /health route")
    if ("websocket", "/voice/realtime/ws") not in routes:
        fail("missing websocket /voice/realtime/ws route")

    expected_snippets = (
        "receive()",
        "send_json",
        "send_bytes",
        "\"websocket.receive\"",
        "bytes",
        "text",
    )
    for snippet in expected_snippets:
        if snippet not in source:
            fail(f"source missing expected realtime handling snippet: {snippet}")


def main() -> None:
    compile_sources()
    pyproject = load_pyproject()
    assert_dependencies(pyproject)
    assert_source_contract()
    print("verify_backend: ok")


if __name__ == "__main__":
    main()
