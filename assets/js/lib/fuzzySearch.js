/**
 * Fuzzy search with scoring
 * Inspired by fzf/Raycast ranking
 */
export function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()

  let score = 0
  let queryIndex = 0
  let consecutiveMatches = 0
  let lastMatchIndex = -1

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      // Boost for consecutive matches
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++
        score += 2 * consecutiveMatches
      } else {
        consecutiveMatches = 0
        score += 1
      }

      // Boost for word boundary matches
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '/') {
        score += 5
      }

      // Boost for exact case match
      if (text[i] === query[queryIndex]) {
        score += 1
      }

      lastMatchIndex = i
      queryIndex++
    }
  }

  // All query chars must match
  if (queryIndex < queryLower.length) return null

  // Boost shorter matches (more relevant)
  score -= text.length * 0.1

  return { score, text }
}

export function fuzzySearch(query, items, getText) {
  if (!query) return items

  return items
    .map(item => {
      const result = fuzzyMatch(query, getText(item))
      return result ? { item, score: result.score } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(r => r.item)
}
