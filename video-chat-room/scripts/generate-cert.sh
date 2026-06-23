#!/usr/bin/env bash
#
# Генерирует самоподписанный TLS-сертификат для локальной HTTPS-разработки.
# getUserMedia/WebRTC работают только в secure context: localhost ИЛИ https
# (PRD п. 34–37, TDD §10/§12). Сертификат нужен для доступа по LAN-IP и паритета с продом.
#
# Использование: npm run certs   (или ./scripts/generate-cert.sh)
# Файлы кладутся в certs/ и игнорируются git (см. .gitignore).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/certs"
KEY="$CERT_DIR/localhost-key.pem"
CRT="$CERT_DIR/localhost-cert.pem"

mkdir -p "$CERT_DIR"

if [[ -f "$KEY" && -f "$CRT" ]]; then
  echo "✓ Сертификаты уже существуют в $CERT_DIR (перегенерация — удалите их и запустите снова)"
  exit 0
fi

# Конфиг с SAN (localhost + 127.0.0.1) через файл — переносимо между OpenSSL и LibreSSL.
CONFIG="$(mktemp)"
cat > "$CONFIG" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN = localhost
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY" \
  -out "$CRT" \
  -days 825 \
  -config "$CONFIG" >/dev/null 2>&1

rm -f "$CONFIG"

echo "✓ Самоподписанные сертификаты созданы в $CERT_DIR (localhost, 127.0.0.1)"
echo "  Браузер покажет предупреждение о доверии — это нормально для self-signed."
echo "  Для доверенного сертификата используйте mkcert (см. README)."
