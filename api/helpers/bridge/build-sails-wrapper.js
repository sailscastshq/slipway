module.exports = {
  friendlyName: 'Build Sails wrapper',

  description: 'Wrap a Waterline expression in the Sails bootstrap boilerplate for container execution.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code that uses sails.models / Waterline'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ code }) {
    return `
(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false, flash: false, session: false },
        log: { level: 'silent' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const __result = await (async function() {
      ${code}
    })();

    if (__result !== undefined) {
      process.stdout.write(JSON.stringify(__result));
    }
  } catch (err) {
    process.stderr.write(err.stack || err.message);
    process.exitCode = 1;
  }

  if (sailsApp && sailsApp.lower) {
    sailsApp.lower(() => process.exit());
  } else {
    process.exit();
  }
})();
`
  }
}
