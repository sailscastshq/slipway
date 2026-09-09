import { ref, computed, onScopeDispose } from 'vue'

// Each picker owns its request lifetime; retries resume at the failed page.
export function useGithubRepositories() {
  const repos = ref([])
  const repoSearch = ref('')
  const loadingRepos = ref(false)
  const reposError = ref('')
  const reposComplete = ref(false)
  let nextPage = 1
  let controller
  const filteredRepos = computed(() => {
    const query = repoSearch.value.trim().toLowerCase()
    return repos.value.filter((repo) =>
      repo.fullName.toLowerCase().includes(query)
    )
  })

  async function fetchRepos() {
    if (loadingRepos.value || reposComplete.value) return
    loadingRepos.value = true
    reposError.value = ''
    controller = new AbortController()
    const signal = controller.signal
    try {
      while (!reposComplete.value) {
        const response = await fetch(`/api/v1/git/repos?page=${nextPage}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
          headers: { Accept: 'application/json' }
        })
        if (!response.ok) throw new Error('Repository request failed')
        const data = await response.json()
        if (
          !Array.isArray(data.repos) ||
          data.page !== nextPage ||
          typeof data.hasMore !== 'boolean'
        ) {
          throw new Error('Invalid repository response')
        }
        if (signal.aborted) return
        const merged = new Map(repos.value.map((repo) => [repo.id, repo]))
        for (const repo of data.repos) merged.set(repo.id, repo)
        repos.value = [...merged.values()]
        reposComplete.value = !data.hasMore
        nextPage++
      }
    } catch {
      if (!signal.aborted)
        reposError.value =
          'Could not load all repositories. Retry to finish searching.'
    } finally {
      loadingRepos.value = false
    }
  }

  onScopeDispose(() => controller?.abort())
  return {
    repos,
    repoSearch,
    filteredRepos,
    loadingRepos,
    reposError,
    reposComplete,
    fetchRepos
  }
}
