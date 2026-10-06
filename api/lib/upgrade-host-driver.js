const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ledger = require('./upgrade-ledger')
const { processIdentity, sameProcess } = require('./upgrade-writer-observer')
const { runBounded } = require('./upgrade-process')
const launchConfig = require('./upgrade-launch-config')
const startup = require('./upgrade-startup')
function fail(code = 'upgradeFenceLost') {
  throw Object.assign(
    new Error('Exclusive host upgrade control could not be proved.'),
    { code }
  )
}
// This driver is used only by the privileged host launcher. It never stops an
// unreviewed container or changes daemon-wide security/restart configuration.
module.exports = function createHostDriver({
  docker,
  controllerContainer,
  hostFileSystem,
  directory,
  current,
  imageConfig,
  imageId,
  actor = { kind: 'host-root', uid: 0, id: 0, team: 0 },
  authorize
}) {
  if (process.platform !== 'linux' || process.getuid() !== 0) fail()
  const root = fs.realpathSync(directory)
  const stat = fs.statSync(root)
  if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o700)
    fail()
  const controller = processIdentity(process.pid)
  const namespace = fs.readlinkSync('/proc/self/ns/pid')
  let lock
  let token
  let deadline
  let owned
  let controllerId
  const remaining = () => {
    const value = deadline - Date.now()
    if (value <= 0) fail('upgradeHostTimeout')
    return value
  }
  const call = (method, route, body) =>
    docker(method, route, body, Math.min(30000, remaining()))
  async function inspect(id) {
    return call('GET', `/containers/${encodeURIComponent(id)}/json`)
  }
  function verifyLock() {
    if (
      !lock ||
      !owned ||
      !sameProcess(controller, processIdentity(process.pid))
    )
      fail()
    const value = JSON.parse(fs.readFileSync(lock, 'utf8'))
    if (ledger.digest(value) !== ledger.digest(token)) fail()
  }
  async function candidates(id) {
    const filters = encodeURIComponent(
      JSON.stringify({ label: [`io.slipway.upgrade.run=${id}`] })
    )
    const values = await call(
      'GET',
      `/containers/json?all=1&filters=${filters}`
    )
    if (values.length > 1) fail('upgradeLaunchConfig')
    return values
  }
  async function holdCandidate(state) {
    for (const candidate of await candidates(state.id)) {
      const info = await inspect(candidate.Id)
      if (
        info.Config.Labels?.['io.slipway.upgrade.run'] !== state.id ||
        info.Image !== imageId
      )
        fail('upgradeLaunchConfig')
      if (state.stage) {
        const marker = path.join(state.stage.directory, 'launch.json')
        if (fs.existsSync(marker)) {
          const value = startup.readMarker(marker)
          startup.writeMarker(marker, { ...value, phase: 'hold' })
        }
      }
      await call('POST', `/containers/${info.Id}/update`, {
        RestartPolicy: { Name: 'no' }
      })
      if (info.State.Running)
        await call('POST', `/containers/${info.Id}/stop?t=10`)
    }
  }
  return {
    async acquire(input) {
      deadline = input.deadline
      if (actor.kind === 'instance-admin') {
        if (
          typeof authorize !== 'function' ||
          authorize().actorUserId !== actor.id
        )
          fail('upgradeHandoffRejected')
      } else if (
        actor.kind !== 'host-root' ||
        actor.uid !== 0 ||
        actor.id !== 0
      )
        fail('upgradeHandoffRejected')
      if (
        current.Id !== input.reviewed.containerId ||
        current.Mounts.filter((mount) => mount.Destination === '/app/db')
          .length !== 1 ||
        fs.realpathSync(
          current.Mounts.find((mount) => mount.Destination === '/app/db').Source
        ) !== input.reviewed.sourceDirectory
      )
        fail('upgradeHostTarget')
      if (controllerContainer) {
        const self = await inspect(controllerContainer)
        if (
          !/^[a-f0-9]{64}$/.test(self.Id || '') ||
          self.State.Pid !== controller.pid ||
          !self.State.Running ||
          self.HostConfig.PidMode !== 'host' ||
          self.HostConfig.RestartPolicy.Name !== 'no'
        )
          fail()
        if (
          hostFileSystem &&
          !self.Mounts.some(
            (mount) =>
              mount.Type === 'bind' &&
              mount.Source === '/' &&
              mount.Destination === hostFileSystem &&
              mount.RW === false
          )
        )
          fail()
        controllerId = self.Id
      }
      // Prove basic host process visibility before taking the lock or stopping
      // the source. The complete writer scan still runs after freeze and again
      // throughout backup/preflight/DDL; this precheck cannot authorize DDL.
      await runBounded({
        operation: 'checkHostVisibility',
        input: { hostPidNamespace: namespace },
        timeoutMs: remaining()
      })
      lock = path.join(
        root,
        `instance-${ledger.digest(input.reviewed.instanceId)}.lock`
      )
      token = {
        format: 1,
        id: input.id,
        owner: controller,
        checkpoint: input.filename
      }
      const temporary = lock + '.' + crypto.randomUUID()
      fs.writeFileSync(temporary, JSON.stringify(token), {
        mode: 0o600,
        flag: 'wx'
      })
      try {
        try {
          fs.linkSync(temporary, lock)
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          const previous = JSON.parse(fs.readFileSync(lock, 'utf8'))
          if (
            previous.id !== input.id ||
            previous.checkpoint !== input.filename
          )
            fail('upgradeBusy')
          let alive = false
          try {
            alive = sameProcess(
              previous.owner,
              processIdentity(previous.owner.pid)
            )
          } catch (identityError) {
            if (!['ENOENT', 'ESRCH'].includes(identityError.code))
              throw identityError
          }
          if (alive) fail('upgradeBusy')
          if (
            ledger.digest(previous) !==
            ledger.digest(JSON.parse(fs.readFileSync(lock, 'utf8')))
          )
            fail('upgradeBusy')
          fs.unlinkSync(lock)
          fs.linkSync(temporary, lock)
        }
        owned = {
          id: input.id,
          owner: `host:${controller.boot}:${controller.pid}:${controller.start}`,
          originalRestartPolicy: { ...current.HostConfig.RestartPolicy },
          actor
        }
        return owned
      } finally {
        fs.rmSync(temporary, { force: true })
      }
    },
    async freeze({ reviewed, control }) {
      verifyLock()
      if (control !== owned) fail()
      const source = await inspect(reviewed.containerId)
      if (source.Id !== current.Id || source.Image !== current.Image)
        fail('upgradeHostTarget')
      // Coordinated future starts consult this gate before ORM. Immutable old
      // releases are stopped with restart disabled and remain on original data.
      const markerSetting = source.Config.Env?.find((value) =>
        value.startsWith('SLIPWAY_UPGRADE_MARKER=')
      )
      if (markerSetting) {
        const marker = markerSetting.slice('SLIPWAY_UPGRADE_MARKER='.length)
        startup.writeMarker(marker, {
          ...startup.readMarker(marker),
          phase: 'hold'
        })
      }
      await call('POST', `/containers/${source.Id}/update`, {
        RestartPolicy: { Name: 'no' }
      })
      if (source.State.Running)
        await call('POST', `/containers/${source.Id}/stop?t=10`)
      if (authorize && authorize().actorUserId !== actor.id)
        fail('upgradeHandoffRejected')
      const state = require('./upgrade-host-controller').read(token.checkpoint)
      await holdCandidate(state)
    },
    async verifyFence({ control, targets, context, worker }) {
      verifyLock()
      if (control !== owned) fail()
      const old = await inspect(current.Id)
      if (
        old.State.Running ||
        old.State.Paused ||
        old.State.Restarting ||
        old.HostConfig.RestartPolicy.Name !== 'no'
      )
        fail()
      const observed = await runBounded({
        operation: 'observeWriters',
        input: {
          databases: targets,
          storageDirectories: [
            ...new Set(targets.map((target) => path.dirname(target.path)))
          ],
          controller,
          worker: worker?.workerPid
            ? processIdentity(worker.workerPid)
            : undefined,
          controllerContainer: controllerId,
          hostPidNamespace: namespace,
          hostFileSystem
        },
        timeoutMs: remaining()
      })
      // Exclusivity covers supported managed launches: private staged storage,
      // a root-owned instance lock, disabled old restart, and the native startup
      // admission gate. Privileged raw Docker/root access is the trusted host
      // administration boundary, not an actor this lock can sandbox.
      return {
        ...observed,
        id: owned.id,
        exclusiveController: true,
        controllerOwner: owned.owner,
        previousOwnerStopped: context?.previousOwner ? true : undefined
      }
    },
    async publish({ state }) {
      verifyLock()
      const marker = path.join(state.stage.directory, 'launch.json')
      startup.writeMarker(marker, {
        format: 1,
        phase: 'publishing',
        filename: state.handle.filename,
        instanceId: state.reviewed.instanceId,
        version: state.reviewed.identity.manifest.version,
        image: state.reviewed.identity.manifest.image,
        manifestHash: state.reviewed.identity.hash
      })
      const found = await candidates(state.id)
      let target
      if (found.length) {
        target = await inspect(found[0].Id)
        if (
          target.Image !== imageId ||
          target.Config.Labels?.['io.slipway.upgrade.manifest'] !==
            state.reviewed.identity.hash ||
          !target.Mounts.some(
            (mount) =>
              mount.Destination === '/app/db' &&
              mount.Source === state.stage.dataDirectory &&
              mount.RW
          )
        )
          fail('upgradeLaunchConfig')
      } else {
        const old = await inspect(current.Id)
        const name = state.reviewed.containerName
        if (old.Name === '/' + name)
          await call(
            'POST',
            `/containers/${old.Id}/rename?name=${encodeURIComponent(
              name + '-before-' + state.id
            )}`
          )
        const body = launchConfig({
          current,
          imageConfig,
          image: state.reviewed.identity.manifest.image,
          stage: state.stage,
          marker,
          instanceId: state.reviewed.instanceId,
          manifestHash: state.reviewed.identity.hash,
          runId: state.id,
          stateRoot: root,
          hostCheckpoint: token.checkpoint
        })
        const created = await call(
          'POST',
          `/containers/create?name=${encodeURIComponent(name)}`,
          body
        )
        target = await inspect(created.Id)
      }
      if (!target.State.Running)
        await call('POST', `/containers/${target.Id}/start`)
      return { id: target.Id, imageId, marker }
    },
    async health({ state }) {
      verifyLock()
      // A fixed in-container request keeps host bind/network topology intact.
      // It emits only health metadata; no Env, logs or exception text is sent.
      const source =
        'const h=require("http");const r=h.get({host:"127.0.0.1",port:Number(process.env.PORT)||1337,path:"/health",timeout:2000},s=>{let b="";s.on("data",x=>{b+=x;if(b.length>65536)process.exit(1)});s.on("end",()=>{if(s.statusCode!==200)process.exit(1);try{console.log(JSON.stringify(JSON.parse(b)))}catch{process.exit(1)}})});r.on("timeout",()=>process.exit(1));r.on("error",()=>process.exit(1))'
      while (remaining() > 0) {
        try {
          const execution = await call(
            'POST',
            `/containers/${state.target.id}/exec`,
            {
              AttachStdout: true,
              AttachStderr: false,
              Tty: true,
              Cmd: ['node', '-e', source]
            }
          )
          const result = await call('POST', `/exec/${execution.Id}/start`, {
            Detach: false,
            Tty: true
          })
          const exit = await call('GET', `/exec/${execution.Id}/json`)
          if (
            !exit.Running &&
            exit.ExitCode === 0 &&
            result.status === 'ok' &&
            result.upgrade?.verified === true
          )
            return { ready: true, ...result.upgrade }
        } catch {
          /* Retry only bounded readiness reads; never old-image rollback. */
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1000, remaining()))
        )
      }
      fail('upgradeHostHealth')
    },
    async release({ state }) {
      if (!owned) return
      // Safety cleanup gets its own bounded budget after the operation budget.
      deadline = Math.max(deadline, Date.now() + 30000)
      try {
        verifyLock()
        if (state.phase === 'ready') {
          const policy = state.originalRestartPolicy
          if (
            !policy ||
            !['no', 'always', 'unless-stopped', 'on-failure'].includes(
              policy.Name
            ) ||
            !Number.isSafeInteger(policy.MaximumRetryCount ?? 0) ||
            (policy.MaximumRetryCount ?? 0) < 0
          )
            fail('upgradeLaunchConfig')
          const value = startup.readMarker(state.target.marker)
          startup.writeMarker(state.target.marker, { ...value, phase: 'ready' })
          await call('POST', `/containers/${state.target.id}/update`, {
            RestartPolicy: policy
          })
        } else await holdCandidate(state)
      } finally {
        if (
          lock &&
          fs.existsSync(lock) &&
          ledger.digest(JSON.parse(fs.readFileSync(lock, 'utf8'))) ===
            ledger.digest(token)
        )
          fs.unlinkSync(lock)
        owned = null
      }
    }
  }
}
