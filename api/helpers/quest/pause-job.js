module.exports = {
  friendlyName: 'Pause Quest job',

  description: 'Pause a scheduled Quest job in a running container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name'
    },
    jobName: {
      type: 'string',
      required: true,
      description: 'Name of the job to pause'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, jobName }) {
    const code = `
(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false },
        log: { level: 'warn' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!sails.quest) {
      throw new Error('sails.quest is not available');
    }

    const result = sails.quest.pause('${jobName}');
    process.stdout.write(JSON.stringify({ success: result }));
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
    return await sails.helpers.quest.executeInContainer(containerName, code)
  }
}
