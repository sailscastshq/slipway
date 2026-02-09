const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'List Quest jobs',

  description: 'Get all scheduled jobs from a running app with sails-hook-quest.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    // Check if sails-quest is detected
    const questFeature = environment.features && environment.features['sails-quest']
    if (!questFeature) {
      throw { badRequest: 'sails-hook-quest not detected in this app.' }
    }

    const app = await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      // App not running - return scripts from detection as manual-only jobs
      const scripts = questFeature.scripts || []
      return {
        jobs: scripts.map(s => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        })),
        appRunning: false
      }
    }

    // Execute sails.quest.list() in the container
    const code = buildListJobsCode()
    const result = await executeInContainer(app.containerName, code)

    if (!result.success) {
      // Fallback to scripts from detection
      const scripts = questFeature.scripts || []
      return {
        jobs: scripts.map(s => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        })),
        error: result.error,
        appRunning: true
      }
    }

    try {
      const scheduledJobs = JSON.parse(result.output)
      const scheduledNames = new Set(scheduledJobs.map(j => j.name))

      // Add scripts that aren't scheduled as manual jobs
      const scripts = questFeature.scripts || []
      const manualJobs = scripts
        .filter(s => !scheduledNames.has(s.name))
        .map(s => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        }))

      return {
        jobs: [...scheduledJobs, ...manualJobs],
        appRunning: true
      }
    } catch (e) {
      // Fallback to scripts from detection when parsing fails
      const scripts = questFeature.scripts || []
      return {
        jobs: scripts.map(s => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        })),
        error: result.output ? `Parse error: ${result.output.substring(0, 200)}` : 'Failed to parse job list',
        appRunning: true
      }
    }
  }
}

function buildListJobsCode() {
  return `
(async () => {
  const fs = require('fs');
  const path = require('path');
  let sailsApp;

  try {
    // First, get all scripts from scripts/ directory
    const scriptsDir = path.join(process.cwd(), 'scripts');
    let allScripts = [];

    if (fs.existsSync(scriptsDir)) {
      const files = fs.readdirSync(scriptsDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          const scriptName = file.replace('.js', '');
          try {
            const scriptPath = path.join(scriptsDir, file);
            const script = require(scriptPath);
            allScripts.push({
              name: scriptName,
              friendlyName: script.friendlyName || scriptName,
              description: script.description || '',
              hasQuest: !!script.quest,
              quest: script.quest || null
            });
          } catch (e) {
            // Script failed to load, add as basic entry
            allScripts.push({
              name: scriptName,
              friendlyName: scriptName,
              description: '',
              hasQuest: false,
              quest: null
            });
          }
        }
      }
    }

    // Now load sails to get runtime job status
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        environment: 'console',
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false, flash: false, session: false },
        log: { level: 'silent' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Build final job list
    const jobs = allScripts.map(script => {
      const questJob = sails.quest ? sails.quest.get(script.name) : null;
      const quest = script.quest || {};

      return {
        name: script.name,
        friendlyName: script.friendlyName,
        description: script.description,
        schedule: quest.cron || quest.interval || quest.timeout || null,
        scheduleType: quest.cron ? 'cron' : (quest.interval ? 'interval' : (quest.timeout ? 'timeout' : 'manual')),
        paused: questJob ? !!questJob.paused : false,
        withoutOverlapping: quest.withoutOverlapping || false,
        isRunning: sails.quest && sails.quest.isRunning ? sails.quest.isRunning(script.name) : false
      };
    });

    process.stdout.write(JSON.stringify(jobs));
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

function executeInContainer(containerName, code) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, ['exec', '-i', containerName, 'node'], {
      timeout: 30000
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.stdin.write(code)
    proc.stdin.end()

    proc.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        output: stdout.trim(),
        error: stderr.trim() || null,
        exitCode
      })
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: 1
      })
    })
  })
}
