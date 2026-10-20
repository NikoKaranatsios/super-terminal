// A separate Electron utility process keeps PTYs and discovery off the UI thread.
import('../server/index.mjs').catch(error => { console.error(error); process.exit(1); });
