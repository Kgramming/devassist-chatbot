"""Process-environment compatibility shims.

httpx 0.28.x builds proxy-bypass rules by turning every NO_PROXY/no_proxy
entry into a URLPattern. Bracketed IPv6 literals (``[::1]``) — which this
sandbox puts in no_proxy — are not recognized as IPv6 by httpx, fall into its
wildcard branch, and produce an unparseable pattern (``all://*[::1]``), so
``httpx.Client()`` raises ``InvalidURL`` before any request is ever made.
That breaks both the Groq streaming client and the Hugging Face model
download.

The shim below strips brackets from bracketed IPv6 literals
(``[::1]`` -> ``::1``), which httpx handles correctly. It is idempotent and
process-local, and it only touches entry formatting — proxy hosts, ports and
credentials are never modified.
"""

import ipaddress
import logging
import os

logger = logging.getLogger(__name__)


def _unbracket_ipv6(entry: str) -> str:
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith("[") and entry.endswith("]"):
        inner = entry[1:-1]
        try:
            ipaddress.IPv6Address(inner)
        except ipaddress.AddressValueError:
            return entry
        return inner
    return entry


def sanitize_proxy_env() -> None:
    """Normalize NO_PROXY/no_proxy so httpx can parse every entry."""
    for var in ("NO_PROXY", "no_proxy"):
        raw = os.environ.get(var)
        if not raw:
            continue
        fixed = ",".join(_unbracket_ipv6(part) for part in raw.split(","))
        if fixed != raw:
            logger.debug(
                "Normalized bracketed IPv6 entries in %s for httpx compatibility",
                var,
            )
            os.environ[var] = fixed
