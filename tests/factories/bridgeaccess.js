module.exports = ({ defineFactory }) =>
  defineFactory('bridgeaccess', ({ sequence }) => ({
    email: sequence(
      'bridge-access-email',
      (number) => `bridge-user-${number}@example.com`
    ),
    role: 'viewer',
    status: 'pending'
  }))
