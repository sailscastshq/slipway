async function manager(inputs) {
  try {
    return await sails.helpers.bearing.resolveManager.with(inputs)
  } catch (error) {
    if (error.code === 'forbidden') throw 'forbidden'
    if (error.code === 'notFound') throw 'notFound'
    throw error
  }
}
async function publicBearing(inputs) {
  try {
    return await sails.helpers.bearing.resolvePublicRequest.with(inputs)
  } catch (error) {
    if (error.code === 'notFound') throw 'notFound'
    throw error
  }
}
async function bridge(inputs) {
  try {
    return await sails.helpers.bridge.resolveRequest.with(inputs)
  } catch (error) {
    if (error.code === 'forbidden') throw 'forbidden'
    if (error.code === 'notFound') throw 'notFound'
    if (error.code === 'reauthenticate')
      throw { reauthenticate: error.raw || error }
    throw error
  }
}
module.exports = { manager, publicBearing, bridge }
