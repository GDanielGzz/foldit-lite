from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    esm_atlas_url: str = "https://api.esmatlas.com/foldSequence/v1/pdb/"
    request_timeout_s: int = 60
    max_retries: int = 3
    retry_base_delay_s: float = 1.5

    max_sequence_length: int = 400  # ESM Atlas hard limit
    min_sequence_length: int = 10

    data_dir: Path = Path(__file__).parent / "data"
    cache_db_path: Path = Path(__file__).parent / "data" / "cache.db"

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5180", "http://localhost:8000"]

    # LLM tutor (optional — disables gracefully if no key)
    anthropic_api_key: str = ""
    tutor_model: str = "claude-sonnet-4-6"
    tutor_max_tokens: int = 350


settings = Settings()
