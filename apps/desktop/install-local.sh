#!/usr/bin/env bash
#
# install-local.sh — Build Innerio desktop from this checkout and install it
# for this user, in the same place as the public installer
# (https://innerio.frederickandrade.com/install.sh), so the in-app updater
# (actualizar.cjs) can replace it later.
#
#   ~/.local/share/innerio      the app
#   ~/.local/bin/innerio        launcher (adds --no-sandbox, see install.sh)
#   ~/.local/share/applications/innerio.desktop
#
# Your data lives in ~/.config/Innerio and is never touched. Removes the old
# ~/.local/opt/innerio install from before ADR-040 if present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATOS="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="${DATOS}/innerio"
BIN="${HOME}/.local/bin"
APPS="${DATOS}/applications"
ICONS="${DATOS}/icons/hicolor/512x512/apps"

echo "==> 1/3  Build web ..."
(cd "${HERE}/../web" && bun run build)

echo "==> 2/3  Empaquetando Electron ..."
(cd "${HERE}" && rm -rf dist && bunx electron-builder --linux dir)

echo "==> 3/3  Instalando en ${DEST} ..."
mkdir -p "${DATOS}" "${BIN}" "${APPS}" "${ICONS}"
rm -rf "${DEST}.nueva"
cp -a "${HERE}/dist/linux-unpacked" "${DEST}.nueva"
rm -rf "${DEST}"
mv "${DEST}.nueva" "${DEST}"
cp "${HERE}/icon.png" "${ICONS}/innerio.png"

# Sandbox when the system allows it (same logic as the public install.sh).
cat > "${BIN}/innerio" <<EOF
#!/bin/sh
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && [ ! -e /etc/apparmor.d/innerio ]; then
  exec "${DEST}/innerio" --no-sandbox "\$@"
fi
exec "${DEST}/innerio" "\$@"
EOF
chmod +x "${BIN}/innerio"

cat > "${APPS}/innerio.desktop" <<EOF
[Desktop Entry]
Name=Innerio
Comment=Gestor de tareas con el método GTD
Exec=${BIN}/innerio %U
Icon=innerio
Terminal=false
Type=Application
Categories=Office;ProjectManagement;
StartupWMClass=Innerio
EOF

rm -rf "${HOME}/.local/opt/innerio"
update-desktop-database "${APPS}" 2>/dev/null || true
echo "✅ Innerio $(node -p "require('${HERE}/package.json').version") instalado. Búscalo en el menú de aplicaciones."
