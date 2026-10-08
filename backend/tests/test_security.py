import time

import pytest
from app.security import (
    SecretBox,
    hash_password,
    make_token,
    normalize_username,
    read_token,
    validate_password,
    verify_password,
)


def test_password_hash_verifies_and_is_salted():
    h1, h2 = hash_password("correct horse battery"), hash_password("correct horse battery")
    assert h1 != h2 and h1.startswith("scrypt$")  # unique salt per hash
    assert verify_password("correct horse battery", h1) and not verify_password("wrong password!!", h1)
    assert not verify_password("x", "garbage") and not verify_password("x", "")


def test_token_signature_expiry_and_tampering():
    tok = make_token("secret", {"u": "ann"}, ttl=60)
    assert read_token("secret", tok)["u"] == "ann"
    assert read_token("other-secret", tok) is None  # wrong key
    body, sig = tok.split(".")
    assert read_token("secret", body + "x." + sig) is None  # tampered body
    assert read_token("secret", make_token("secret", {"u": "ann"}, ttl=-1)) is None  # expired
    assert read_token("secret", "not-a-token") is None


def test_secret_box_roundtrip_mask_and_key_change():
    box = SecretBox("server-secret")
    enc = box.encrypt("sk-live-abcdef123456")
    assert enc.startswith("enc:v1:") and "abcdef" not in enc
    assert box.decrypt(enc) == "sk-live-abcdef123456"
    assert SecretBox("different-secret").decrypt(enc) is None  # cannot be read after the secret changes
    assert SecretBox.mask("sk-live-abcdef123456") == "••••3456" and SecretBox.mask("short") == "••••"


def test_username_and_password_rules():
    assert normalize_username("  Ann.Lee_1 ") == "ann.lee_1"
    for bad in ("ab", "has space", "-lead", "x" * 40, "emoji😀"):
        with pytest.raises(ValueError):
            normalize_username(bad)
    validate_password("a-long-enough-pass")
    for bad in ("short", "x" * 200, "password123"):
        with pytest.raises(ValueError):
            validate_password(bad)


def test_hash_is_slow_enough_to_resist_guessing():
    t = time.perf_counter()
    hash_password("timing-test-password")
    assert time.perf_counter() - t > 0.01  # scrypt(n=2**14) costs real CPU/memory per guess


def test_weak_secrets_are_reported():
    from app.security import weak_secrets

    assert weak_secrets("short", "tiny") and len(weak_secrets("short", "tiny")) == 2
    assert weak_secrets("x" * 40, "y" * 20) == []
    assert weak_secrets(None, None) == []
    assert weak_secrets("z" * 40, "z" * 40) == ["SECRET_KEY and ADMIN_TOKEN must be different values"]
