// 故意什么都不桥：渲染进程拿不到 Node 能力，桌面版就不会漂移出浏览器版做不到的事。
// 这条纪律的意义是「桌面版和网页版跑同一份代码」——门禁量的是网页那份，
// 一旦 preload 里多了什么 IO 能力，main.js 就有了一条在 Chrome 里不存在的路可走。
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('desktopShell', { platform: process.platform, version: '0.1.0' });
