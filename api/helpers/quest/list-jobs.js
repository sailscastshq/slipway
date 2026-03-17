module.exports = {
  friendlyName: 'List Quest jobs',

  description:
    'Get all scheduled jobs from a running app with sails-hook-quest.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name'
    },
    questFeature: {
      type: 'ref',
      required: true,
      description: 'Quest feature config from environment.features'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, questFeature }) {
    const scripts = questFeature.scripts || []

    const code = buildListJobsCode()
    const result = await sails.helpers.quest.executeInContainer(
      containerName,
      code
    )

    if (!result.success) {
      // Fallback to scripts from detection
      return {
        jobs: scripts.map((s) => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        })),
        error: result.error
      }
    }

    try {
      const scheduledJobs = JSON.parse(result.output)
      const scheduledNames = new Set(scheduledJobs.map((j) => j.name))

      // Add scripts that aren't scheduled as manual jobs
      const manualJobs = scripts
        .filter((s) => !scheduledNames.has(s.name))
        .map((s) => ({
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
        error: null
      }
    } catch (e) {
      // Fallback when parsing fails
      return {
        jobs: scripts.map((s) => ({
          name: s.name,
          friendlyName: s.name,
          description: '',
          schedule: null,
          scheduleType: 'manual',
          paused: false,
          withoutOverlapping: false,
          isRunning: false
        })),
        error: result.output
          ? `Parse error: ${result.output.substring(0, 200)}`
          : 'Failed to parse job list'
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
        environment: 'console',
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

      let nextRunAt = null;
      let lastRunAt = null;

      if (sails.quest) {
        // Try to get next scheduled run time
        if (typeof sails.quest.nextRun === 'function') {
          try { nextRunAt = sails.quest.nextRun(script.name); } catch (e) { /* ignore */ }
        }
        // Try to get last run time from quest runtime
        if (questJob && questJob.lastRunAt) {
          lastRunAt = questJob.lastRunAt;
        } else if (questJob && questJob.lastRun) {
          lastRunAt = questJob.lastRun;
        }
      }

      return {
        name: script.name,
        friendlyName: script.friendlyName,
        description: script.description,
        schedule: quest.cron || quest.interval || quest.timeout || null,
        scheduleType: quest.cron ? 'cron' : (quest.interval ? 'interval' : (quest.timeout ? 'timeout' : 'manual')),
        paused: questJob ? !!questJob.paused : false,
        withoutOverlapping: quest.withoutOverlapping || false,
        isRunning: sails.quest && sails.quest.isRunning ? sails.quest.isRunning(script.name) : false,
        nextRunAt: nextRunAt ? new Date(nextRunAt).getTime() : null,
        lastRunAt: lastRunAt ? new Date(lastRunAt).getTime() : null
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
