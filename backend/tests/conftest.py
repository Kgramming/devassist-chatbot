"""Shared fixtures: mock-mode app, isolated ingestion state."""

import os

# Must be set BEFORE importing the app so Settings picks it up.
os.environ["MOCK_GROQ"] = "true"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rag.ingestion import ingestion_service


@pytest.fixture()
def client():
    ingestion_service.reset()
    with TestClient(app) as c:
        yield c
    ingestion_service.reset()


@pytest.fixture()
def ingestion():
    ingestion_service.reset()
    yield ingestion_service
    ingestion_service.reset()
