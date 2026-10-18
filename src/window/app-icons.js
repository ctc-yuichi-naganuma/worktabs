const path = require('node:path');

// OS surfaces follow the system appearance, independently of the selected VS Code theme.
function appIconPath(nativeTheme, iconsDir = path.join(__dirname, '..', 'assets')) {
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
  return path.join(iconsDir, dark ? 'icon.png' : 'icon-light.png');
}

function attachAppIcons({ app, nativeTheme, window, platform = process.platform }) {
  let previous;
  const update = () => {
    if (window.isDestroyed()) return;
    const icon = appIconPath(nativeTheme);
    if (icon === previous) return;
    if (platform === 'darwin') app.dock.setIcon(icon);
    else window.setIcon(icon);
    previous = icon;
  };
  const dispose = () => nativeTheme.removeListener('updated', update);
  update();
  nativeTheme.on('updated', update);
  window.once('closed', dispose);
  return dispose;
}

module.exports = { appIconPath, attachAppIcons };
