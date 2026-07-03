"""Guard: every handler main.py imports from `.handlers` must be re-exported.

main.py does ``from .handlers import (...)`` and registers each name, so a
handler added to a submodule (e.g. handlers/reapplication.py) but not re-exported
from handlers/__init__.py makes ``import billie_servicing.main`` — the
event-processor entrypoint — raise ImportError at startup, even though the
handler's own unit tests (which import the submodule directly) still pass.

This parses main.py's `from .handlers import (...)` block statically and asserts
each name resolves on the handlers package. It needs no billie SDKs (it does not
import main.py, which pulls the accounts/customers SDKs via processor.py).
"""

from __future__ import annotations

import ast
from pathlib import Path

import billie_servicing.handlers as handlers_pkg

_MAIN_PY = Path(handlers_pkg.__file__).parent.parent / "main.py"


def _names_imported_from_handlers() -> list[str]:
    tree = ast.parse(_MAIN_PY.read_text())
    names: list[str] = []
    for node in ast.walk(tree):
        # `from .handlers import (...)` → module="handlers", level=1
        if isinstance(node, ast.ImportFrom) and node.module == "handlers" and node.level == 1:
            names.extend(alias.name for alias in node.names)
    return names


def test_main_imports_from_handlers_are_all_reexported():
    imported = _names_imported_from_handlers()
    assert imported, "expected main.py to import handlers from `.handlers`"
    missing = [n for n in imported if not hasattr(handlers_pkg, n)]
    assert not missing, (
        "main.py imports these from billie_servicing.handlers but they are not "
        f"re-exported in handlers/__init__.py (import billie_servicing.main would "
        f"raise ImportError): {missing}"
    )
