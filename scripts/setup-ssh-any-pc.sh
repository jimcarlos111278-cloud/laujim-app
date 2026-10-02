#!/usr/bin/env bash
# setup-ssh-any-pc.sh
# Configura el acceso SSH universal a la VM Laujim en Linux/macOS
# Uso: curl -sSL https://raw.githubusercontent.com/jimcarlos111278-cloud/laujim-app/main/scripts/setup-ssh-any-pc.sh | bash

set -e
mkdir -p ~/.ssh
chmod 700 ~/.ssh

echo "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUFNd0FBQUF0emMyZ3RaVwpReU5UVXhPUUFBQUNEd0lLQVV4VEo1SnI0SFhmMXdBNVA0d1YxZk9DcEl6ck03SFpReWE3L2dEUUFBQUtCZnBCRWVYNlFSCkhnQUFBQXR6YzJndFpXUXlOVFV4T1FBQUFDRHdJS0FVeFRKNUpyNEhYZjF3QTVQNHdWMWZPQ3BJenJNN0haUXlhNy9nRFEKQUFBRUQ2UkJGdEd5dTR6QlZmUllxL0ozWkhadS9NZEdUS1FFM1paM1hPY3dBTUp2QWdvQlRGTW5rbXZnZGQvWEFEay9qQgpYVjg0S2tqT3N6c2RsREpyditBTkFBQUFIWFZpZFc1MGRVQnNZWFZxYVcwdGRtNXBZeTB5TURJMkxUQTVMVEV4Ci0tLS0tRU5EIE9QRU5TU0ggUFJJVkFURSBLRVktLS0tLQo=" | base64 -d > ~/.ssh/id_ed25519_laujim
chmod 600 ~/.ssh/id_ed25519_laujim

if ! grep -q "Host laujim" ~/.ssh/config 2>/dev/null; then
    cat << 'EOF' >> ~/.ssh/config

Host laujim
  HostName 149.130.160.116
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519_laujim
  StrictHostKeyChecking accept-new
EOF
fi

echo "Verificando conexión..."
ssh -o ConnectTimeout=8 laujim "echo 'Conectado exitosamente a Laujim VM'"
