#Requires -Version 5.1
<#
  Abre la TUI de una IA corriendo en la VM (misma interfaz, ejecución remota).
  Un solo comando: entra por Tailscale, reusa/crea sesión tmux y lanza la IA.
  Requiere: Tailscale instalado + login con la misma cuenta de la VM.
  Uso: powershell -ExecutionPolicy Bypass -File scripts/open-vm-opencode.ps1 [-Ia opencode|codex|agy] [-Sesion ia]
  Si -t falla (versión vieja de tailscale): entra con `tailscale ssh ubuntu@laujim-vm`
  y corre `bash ~/bin/vm-ia` a mano.
#>
param(
  [string]$Ia = 'opencode',
  [string]$Sesion = 'ia',
  [string]$Vm = 'ubuntu@laujim-vm'
)
tailscale ssh $Vm -t "tmux new -A -s $Sesion bash /home/ubuntu/bin/vm-ia $Ia"
