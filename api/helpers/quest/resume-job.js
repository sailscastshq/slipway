module.exports = {
  friendlyName: 'Resume Quest job',

  description: 'Resume a paused Quest job in a running container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name'
    },
    jobName: {
      type: 'string',
      required: true,
      description: 'Name of the job to resume'
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
        environment: 'console',
        models: { migrate: 'safe' },
        log: { level: 'warn' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!sails.quest) {
      throw new Error('sails.quest is not available');
    }

    const result = sails.quest.resume('${jobName}');
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
