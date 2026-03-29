"""Input sanitization for event handler data used in MongoDB queries.

Prevents NoSQL injection by ensuring values used in query filters are
primitive types (strings), not dicts that MongoDB would interpret as
query operators (e.g., {"$ne": null}, {"$gt": ""}).
"""

import structlog

logger = structlog.get_logger()


def safe_str(value: object, field_name: str = "unknown") -> str:
    """Validate that a value is a string suitable for use in a MongoDB query filter.

    Returns the value as a string if it's a primitive type.
    Raises ValueError if the value is a dict or list (potential operator injection).
    Returns empty string for None.
    """
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        logger.warning(
            "Rejected non-primitive value in query field",
            field=field_name,
            value_type=type(value).__name__,
        )
        raise ValueError(
            f"Expected string for '{field_name}', got {type(value).__name__}"
        )
    return str(value)


def strip_dollar_keys(data: dict) -> dict:
    """Remove keys starting with '$' from a dict to prevent MongoDB operator injection.

    Only strips top-level keys. Returns a new dict.
    """
    cleaned = {k: v for k, v in data.items() if not k.startswith("$")}
    if len(cleaned) != len(data):
        stripped = [k for k in data if k.startswith("$")]
        logger.warning("Stripped dollar-prefixed keys from event data", keys=stripped)
    return cleaned
