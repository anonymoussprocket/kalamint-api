# kalamint-api

```
const conseilUtil = require('./conseilUtil');

async function run() {
    const r = await conseilUtil.getCollectionForAddress('tz1LDFRQ8y6D4u3hiBe8o3YEVumTDRYaz4g9');

    console.log(JSON.stringify(r))
}

run();
```
