module.exports = {
  friendlyName: 'Build update swap script',

  description:
    'Build the sidecar script that swaps Slipway containers with rollback.',

  inputs: {
    runArgs: {
      type: 'ref',
      required: true,
      description: 'Docker run arguments for the new Slipway container.'
    },
    containerName: {
      type: 'string',
      defaultsTo: 'slipway'
    },
    backupContainerName: {
      type: 'string',
      defaultsTo: 'slipway-previous'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ runArgs, containerName, backupContainerName }) {
    return `
  const { execFileSync } = require("child_process")
  const containerName = ${JSON.stringify(containerName)}
  const backupName = ${JSON.stringify(backupContainerName)}
  const runArgs = ${JSON.stringify(runArgs)}
  let renamed = false
  let candidateMayExist = false

  function docker(args, options = {}) {
    return execFileSync("docker", args, { stdio: "inherit", timeout: 30000, ...options })
  }

  function dockerQuiet(args) {
    return execFileSync("docker", args, { stdio: "pipe", timeout: 10000 })
  }

  function tryDocker(args) {
    try {
      docker(args)
      return true
    } catch (error) {
      console.error("Docker command failed:", args.join(" "), error.message)
      return false
    }
  }

  function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }

  function waitForHealth() {
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      try {
        const body = dockerQuiet([
          "exec",
          containerName,
          "curl",
          "-fsS",
          "--max-time",
          "5",
          "http://localhost:1337/health"
        ])
        const health = JSON.parse(body.toString())
        if (health.status !== "ok" || health.mode === "preflight")
          throw new Error("The candidate has not completed normal startup")
        return
      } catch {
        sleep(2000)
      }
    }

    throw new Error("New Slipway container did not pass health check")
  }

  function restorePrevious() {
    if (!renamed) return
    console.log("Restoring previous Slipway container...")
    if (candidateMayExist) tryDocker(["rm", "-f", containerName])
    docker(["rename", backupName, containerName])
    docker(["start", containerName])
    console.log("Rollback complete; previous Slipway container restored.")
  }

  setTimeout(() => {
    try {
      console.log("Preparing rollback target...")
      tryDocker(["rm", "-f", backupName])
      docker(["rename", containerName, backupName])
      renamed = true
      docker(["stop", backupName])

      console.log("Starting new Slipway container...")
      candidateMayExist = true
      docker(runArgs)

      console.log("Health-checking new Slipway container...")
      waitForHealth()

      console.log("New Slipway container is healthy. Removing rollback target...")
      tryDocker(["rm", "-f", backupName])
      console.log("Update complete!")
    } catch (error) {
      console.error("Swap failed:", error.message)
      try {
        restorePrevious()
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError.message)
      }
      process.exit(1)
    }
  }, 3000)
`.trim()
  }
}
