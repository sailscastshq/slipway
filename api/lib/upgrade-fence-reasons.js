// Fixed diagnostic vocabulary; raw paths, process names and messages never cross IPC.
module.exports = new Set([
  'workerParent',
  'workerIdentity',
  'controllerIdentity',
  'storageTopology',
  'openHandle',
  'memoryMapping',
  'processChanged',
  'procUnobservable',
  'inventoryChanged',
  'activeContainer'
])
