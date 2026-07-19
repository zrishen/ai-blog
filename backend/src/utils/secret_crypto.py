"""Encrypt and decrypt secrets stored in the database."""

from cryptography.fernet import Fernet, InvalidToken

from src.config import settings

ENCRYPTED_SECRET_PREFIX = "fernet:v1:"


class SecretDecryptionError(ValueError):
    """Raised when an encrypted database value cannot be decrypted."""


def is_encrypted_secret(value: str | None) -> bool:
    return bool(value and value.startswith(ENCRYPTED_SECRET_PREFIX))


def encrypt_secret(value: str) -> str:
    token = Fernet(settings.llm_settings_encryption_key.encode("ascii")).encrypt(value.encode("utf-8"))
    return f"{ENCRYPTED_SECRET_PREFIX}{token.decode('ascii')}"


def decrypt_secret(value: str | None) -> str | None:
    if not value or not is_encrypted_secret(value):
        return value

    token = value[len(ENCRYPTED_SECRET_PREFIX) :]
    try:
        decrypted = Fernet(settings.llm_settings_encryption_key.encode("ascii")).decrypt(token.encode("ascii"))
    except (InvalidToken, UnicodeEncodeError, ValueError) as exc:
        raise SecretDecryptionError("数据库中的 LLM API Key 无法解密") from exc
    return decrypted.decode("utf-8")
