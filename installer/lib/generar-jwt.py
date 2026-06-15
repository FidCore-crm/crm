#!/usr/bin/env python3
"""
generar-jwt.py — genera los JWTs ANON_KEY y SERVICE_ROLE_KEY para Supabase
self-hosted, firmados con HS256 usando JWT_SECRET.

Usa solo módulos built-in de Python 3 (sin pip install). Compatible con
Python 3.6+.

Uso:
    python3 generar-jwt.py <jwt_secret> <role>

    role: 'anon' o 'service_role'

Output: el JWT por stdout (una sola línea, sin newline final).

Los JWTs tienen vencimiento de 10 años a partir de ahora — esto es lo
que hace el generador oficial de Supabase. Si el server vive más de 10
años habría que regenerarlos, pero para entonces el CRM va a estar
re-instalado varias veces.
"""

import sys
import json
import hmac
import hashlib
import base64
import time


def base64url(data: bytes) -> str:
    """Base64 URL-safe sin padding (formato JWT)."""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def generar_jwt(secret: str, role: str) -> str:
    if role not in ('anon', 'service_role'):
        raise ValueError(f"Role inválido: '{role}'. Debe ser 'anon' o 'service_role'.")

    now = int(time.time())
    ten_years = 60 * 60 * 24 * 365 * 10

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "role": role,
        "iss": "supabase",
        "iat": now,
        "exp": now + ten_years,
    }

    header_b64 = base64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    payload_b64 = base64url(json.dumps(payload, separators=(',', ':')).encode('utf-8'))

    signing_input = f"{header_b64}.{payload_b64}".encode('ascii')
    signature = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
    signature_b64 = base64url(signature)

    return f"{header_b64}.{payload_b64}.{signature_b64}"


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("uso: python3 generar-jwt.py <jwt_secret> <anon|service_role>\n")
        return 1

    secret = sys.argv[1]
    role = sys.argv[2]

    if len(secret) < 32:
        sys.stderr.write(f"error: JWT_SECRET tiene {len(secret)} chars, mínimo 32\n")
        return 1

    try:
        jwt = generar_jwt(secret, role)
    except ValueError as e:
        sys.stderr.write(f"error: {e}\n")
        return 1

    sys.stdout.write(jwt)
    return 0


if __name__ == '__main__':
    sys.exit(main())
