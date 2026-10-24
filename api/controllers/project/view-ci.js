module.exports = {
  friendlyName: 'View CI workspace',
  description:
    'View tenant-scoped CI evidence and policy. Viewing never registers or enables a runner.',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' }
  },
  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },
  fn: async function ({ slug, envSlug }) {
    const user = await User.forRequest(this.req, { populateTeam: true })
    if (!user?.team?.id) throw 'notFound'
    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw 'notFound'
    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) throw 'notFound'
    const app = this.req.param('appSlug')
      ? await App.findOne({
          environment: environment.id,
          slug: this.req.param('appSlug')
        })
      : (await App.findOne({ environment: environment.id, isDefault: true })) ||
        (await App.findOne({ environment: environment.id }))
    if (this.req.param('appSlug') && !app) throw 'notFound'
    const policy = app ? await CiPolicy.findOne({ app: app.id }) : null
    const runners = app
      ? await CiRunner.find({ app: app.id })
          .select([
            'id',
            'runnerId',
            'name',
            'policyRevision',
            'revokedAt',
            'createdAt'
          ])
          .limit(100)
      : []
    const receipts = app
      ? await CiRun.find({
          app: app.id,
          or: [{ completedAt: { '!=': null } }, { runner: null }]
        })
          .sort('createdAt DESC')
          .limit(100)
      : []
    const verifications = app
      ? await CiVerification.find({ app: app.id })
          .sort('verifiedAt DESC')
          .limit(100)
      : []
    const accepted = (run) => {
      if (run.runner == null)
        return sails.helpers.ci.isServerEvidence.with({
          run,
          policy: policy || {}
        })
      const runner = runners.find((item) => item.id === run.runner)
      return !!(
        policy?.enabled &&
        runner &&
        runner.revokedAt == null &&
        runner.policyRevision === policy.revision &&
        run.policyRevision === policy.revision &&
        run.state === 'passed' &&
        run.summary.finishedAt > Date.now() - 3600000
      )
    }
    return {
      page: 'projects/ci',
      props: {
        project: { name: project.name, slug: project.slug },
        environment: { name: environment.name, slug: environment.slug },
        app: app ? { id: app.id, name: app.name, slug: app.slug } : null,
        canManage:
          ['owner', 'admin'].includes(user.teamRole) &&
          !this.req.session?.bridgeAccessId,
        workspace: {
          version: 1,
          runner: runners.some((runner) => runner.revokedAt == null)
            ? 'registered'
            : 'not-configured',
          readOnly: false,
          policy: policy || null,
          runners,
          runs: receipts.map((run) => ({
            ...run.summary,
            accepted: accepted(run)
          })),
          verifications: verifications.map((item) => ({
            runId: receipts.find((run) => run.id === item.run)?.runId,
            imageId: item.imageId,
            commit: item.commit,
            verifiedAt: item.verifiedAt,
            deploymentUrl: `/projects/${project.slug}/deployments/${item.deployment}`
          }))
        }
      }
    }
  }
}
