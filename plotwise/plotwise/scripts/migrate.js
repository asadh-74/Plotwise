require('dotenv').config();
const { ensureSchema } = require('../src/setup');
ensureSchema().then((created) => { console.log(created ? 'Done' : 'Schema already exists, nothing to do'); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
