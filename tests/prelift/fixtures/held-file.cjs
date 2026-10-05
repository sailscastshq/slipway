const fs = require('node:fs')
const fd = fs.openSync(process.argv[2], 'r+')
fs.writeFileSync(process.argv[3], String(process.pid))
setInterval(() => fs.fsyncSync(fd), 100)
