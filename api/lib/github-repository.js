module.exports = (repo) => ({
  id: String(repo.id),
  name: repo.name,
  fullName: repo.full_name,
  owner: repo.owner.login,
  htmlUrl: repo.html_url,
  cloneUrl: repo.ssh_url,
  defaultBranch: repo.default_branch,
  isPrivate: repo.private,
  description: repo.description,
  language: repo.language,
  updatedAt: repo.updated_at
})
