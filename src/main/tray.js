'use strict';

const { Tray, Menu, nativeImage } = require('electron');

function createTray(controller, quit) {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 4; y < 12; y++) {
    for (let x = 1; x < 15; x++) {
      if ((x < 3 || x > 12) && (y < 6 || y > 9)) continue;
      const i = (y * 16 + x) * 4;
      pixels[i] = 230; pixels[i + 1] = 230; pixels[i + 2] = 230; pixels[i + 3] = 255;
    }
  }
  const tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
  const update = () => {
    const { paused, preview } = controller.snapshot();
    tray.setToolTip(`Usage Pill${paused ? ' - paused' : preview ? ' - manual preview' : ''}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Pause automatic display', enabled: !paused, click: () => controller.pause() },
      { label: 'Resume', enabled: paused || preview, click: () => controller.resume() },
      { label: 'Show preview', click: () => controller.showPreview() },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]));
  };
  update();
  return { update, destroy: () => tray.destroy() };
}

module.exports = { createTray };
