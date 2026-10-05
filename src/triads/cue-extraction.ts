export function extractCuesFromPhrases(fullPhrases: string[], keyword: string): string[] {
	const keywordUpper = keyword.toUpperCase()

	return fullPhrases.map((phrase) => {
		const phraseUpper = phrase.toUpperCase()
		let cue = phrase

		// Check startsWith before endsWith so "EVEN STEVEN" yields "STEVEN" (not "EVEN ST").
		if (phraseUpper.startsWith(keywordUpper + ' ')) {
			cue = phrase.slice(keyword.length + 1).trim()
		} else if (phraseUpper.startsWith(keywordUpper)) {
			cue = phrase.slice(keyword.length).trim()
		} else if (phraseUpper.endsWith(keywordUpper)) {
			const beforeKeyword = phrase.slice(0, -keyword.length)
			const lastChar = beforeKeyword.slice(-1)
			if (lastChar === '-') {
				cue = beforeKeyword
			} else if (lastChar === ' ' || lastChar === '_') {
				cue = beforeKeyword.slice(0, -1).trim()
			} else {
				cue = beforeKeyword.trim()
			}
		} else if (phraseUpper.includes(keywordUpper)) {
			const index = phraseUpper.indexOf(keywordUpper)
			cue = (phrase.slice(0, index) + phrase.slice(index + keyword.length)).trim()
		}

		return cue.toUpperCase()
	})
}
