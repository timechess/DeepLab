const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('deeplabDesktop', {
  runtime: 'electron',
});
