import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db

JWT_ALGORITHM = "HS256"
DEFAULT_JWT_EXPIRE_MINUTES = 60 * 24 * 7
PASSWORD_ITERATIONS = 200_000
HTTP_BEARER = HTTPBearer(auto_error=False)


def normalize_mobile_number(mobile_number: str) -> str:
    digits_only = "".join(char for char in mobile_number if char.isdigit())

    if len(digits_only) == 11 and digits_only.startswith("0"):
        digits_only = digits_only[1:]

    if len(digits_only) == 10:
        digits_only = f"91{digits_only}"

    if not re.fullmatch(r"\d{10,15}", digits_only):
        raise ValueError("Enter a valid mobile number.")

    return digits_only


def validate_password(password: str) -> None:
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters long.")


def hash_password(password: str) -> str:
    validate_password(password)
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_ITERATIONS,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_password_hash: str) -> bool:
    try:
        salt, expected_digest = stored_password_hash.split("$", 1)
        candidate_digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            PASSWORD_ITERATIONS,
        ).hex()
    except Exception:
        return False

    return hmac.compare_digest(candidate_digest, expected_digest)


def _get_jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "change-me-in-production")


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_access_token(payload: dict, expires_minutes: int | None = None) -> str:
    expiry_minutes = expires_minutes or int(
        os.getenv("JWT_EXPIRE_MINUTES", str(DEFAULT_JWT_EXPIRE_MINUTES))
    )

    token_payload = {
        **payload,
        "exp": int((datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)).timestamp()),
    }
    token_header = {"alg": JWT_ALGORITHM, "typ": "JWT"}

    encoded_header = _base64url_encode(
        json.dumps(token_header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    encoded_payload = _base64url_encode(
        json.dumps(token_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{encoded_header}.{encoded_payload}"
    signature = hmac.new(
        _get_jwt_secret().encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    return f"{signing_input}.{_base64url_encode(signature)}"


def decode_access_token(token: str) -> dict:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError as exc:
        raise ValueError("Invalid token format.") from exc

    signing_input = f"{encoded_header}.{encoded_payload}"
    expected_signature = hmac.new(
        _get_jwt_secret().encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    if not hmac.compare_digest(_base64url_decode(encoded_signature), expected_signature):
        raise ValueError("Invalid token signature.")

    payload = json.loads(_base64url_decode(encoded_payload))
    if payload.get("exp", 0) < int(time.time()):
        raise ValueError("Token has expired.")

    return payload


def _call_2factor_api(method: str, url: str) -> dict:
    request = urllib_request.Request(
        url=url,
        method=method,
        headers={"Accept": "application/json"},
    )

    try:
        with urllib_request.urlopen(request, timeout=10) as response:
            payload = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(payload or "OTP service returned an error.") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError("Failed to reach OTP service.") from exc

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OTP service returned an invalid response.") from exc


def send_signup_otp(mobile_number: str) -> str:
    api_key = os.getenv("TWOFACTOR_API_KEY")
    if not api_key:
        raise RuntimeError("OTP service is not configured.")

    template_name = os.getenv("TWOFACTOR_OTP_TEMPLATE")
    encoded_api_key = urllib_parse.quote(api_key, safe="")
    encoded_mobile = urllib_parse.quote(mobile_number, safe="")

    if template_name:
        encoded_template = urllib_parse.quote(template_name, safe="")
        url = (
            f"https://2factor.in/API/V1/{encoded_api_key}/SMS/"
            f"{encoded_mobile}/AUTOGEN/{encoded_template}"
        )
    else:
        url = f"https://2factor.in/API/V1/{encoded_api_key}/SMS/{encoded_mobile}/AUTOGEN"

    response_data = _call_2factor_api("POST", url)
    if response_data.get("Status") != "Success":
        raise RuntimeError(str(response_data.get("Details") or "Failed to send OTP."))

    session_id = response_data.get("Details")
    if not session_id:
        raise RuntimeError("OTP service did not return a session id.")

    return str(session_id)


def verify_signup_otp(session_id: str, otp_code: str) -> bool:
    api_key = os.getenv("TWOFACTOR_API_KEY")
    if not api_key:
        raise RuntimeError("OTP service is not configured.")

    encoded_api_key = urllib_parse.quote(api_key, safe="")
    encoded_session = urllib_parse.quote(session_id, safe="")
    encoded_otp = urllib_parse.quote(otp_code, safe="")
    url = f"https://2factor.in/API/V1/{encoded_api_key}/SMS/VERIFY/{encoded_session}/{encoded_otp}"

    response_data = _call_2factor_api("GET", url)
    return response_data.get("Status") == "Success"


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTP_BEARER),
    request: Request | None = None,
    db: Session = Depends(get_db),
):
    token = credentials.credentials if credentials and credentials.credentials else None
    if token is None and request is not None:
        token = request.query_params.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )

    return user
