module.exports.models = {
  migrate: 'safe',
  attributes: {
    id: { type: 'number', autoIncrement: true },
    createdAt: false,
    updatedAt: false
  }
}
