"""Tests never read a developer's .env: it holds real providers and API keys."""

from app.config import Settings

Settings.model_config["env_file"] = None
