; Included by electron-builder (nsis.include) at the top of the installer and uninstaller scripts.

; Declares the installer DPI aware, so Windows does not draw it at 100% and stretch the bitmap
; at larger display scales. NSIS does not redraw its pages when the window moves to a
; monitor with another scale, so per-monitor awareness would not help.
ManifestDPIAware true
