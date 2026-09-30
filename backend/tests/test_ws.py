"""WebSocket /ws/chat: protocol, streaming, errors, disconnects.

Runs in MOCK_GROQ mode (set in conftest) — no real Groq calls.
"""

import json


def _collect_until_done(ws):
    events = []
    while True:
        event = ws.receive_json()
        events.append(event)
        if event["type"] in ("done", "error"):
            break
    return events


def test_ws_valid_message_streams_to_done(client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_json({"message": "Explain Python decorators."})
        events = _collect_until_done(ws)

        types = [e["type"] for e in events]
        assert "status" in types
        assert "token" in types
        assert types[-1] == "done"

        tokens = [e["content"] for e in events if e["type"] == "token"]
        combined = "".join(tokens)
        assert "[MOCK MODE" in combined  # clearly-marked canned response


def test_ws_malformed_frame_keeps_socket_open(client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text("this is not json {{{")
        event = ws.receive_json()
        assert event["type"] == "error"

        # socket still usable afterwards
        ws.send_json({"message": "Hello"})
        events = _collect_until_done(ws)
        assert events[-1]["type"] == "done"


def test_ws_invalid_payloads_get_errors(client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_json({"message": ""})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"message": "   "})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"message": 123})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"message": "x" * 9000})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"nope": "missing message key"})
        assert ws.receive_json()["type"] == "error"


def test_ws_sources_event_when_documents_indexed(client):
    text = ("Python's asyncio uses an event loop to run coroutines. " * 30).encode()
    up = client.post("/upload", files={"file": ("asyncio.txt", text, "text/plain")})
    assert up.status_code == 200

    with client.websocket_connect("/ws/chat") as ws:
        ws.send_json({"message": "How does asyncio work?"})
        events = _collect_until_done(ws)
        sources = [e for e in events if e["type"] == "sources"]
        assert len(sources) == 1
        assert 1 <= len(sources[0]["chunks"]) <= 3
        for chunk in sources[0]["chunks"]:
            assert chunk["filename"] == "asyncio.txt"
            assert "text" in chunk


def test_ws_disconnect_is_clean(client):
    # connect and disconnect without messaging — must not error or leak
    with client.websocket_connect("/ws/chat"):
        pass
    assert client.get("/health").status_code == 200


def test_ws_binary_frame_handled(client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_bytes(b"\x00\x01\x02")
        event = ws.receive_json()
        assert event["type"] == "error"
