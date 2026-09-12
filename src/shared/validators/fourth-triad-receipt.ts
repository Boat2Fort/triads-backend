const JOINER_PATTERN = /^[ _-]+|[ _-]+$/g

export interface FinalTriadInput {
	keyword: string
	fullPhrases: string[]
}

export interface TriadReceiptCandidate {
	phraseIndex: number
	phrase: string
	keywordOccurrenceIndex: number
	residual: string
	canonicalResidual: string
	triadIndex: number
	keyword: string
}

export interface TriadReceiptMatch extends TriadReceiptCandidate {
	display: string
}

export interface FourthTriadReceipt {
	valid: boolean
	matches: TriadReceiptMatch[]
	candidates: TriadReceiptCandidate[]
	unmatchedPhrases: number[]
	unmatchedKeywords: { triadIndex: number; keyword: string }[]
	ambiguousCandidates: TriadReceiptCandidate[]
	failureReason?: 'invalid-input' | 'duplicate-keywords' | 'no-perfect-matching' | 'ambiguous-matching'
}

interface MatchEdge {
	triadIndex: number
	candidate: TriadReceiptCandidate
}

function canonicalize(value: string): string {
	return value.replace(JOINER_PATTERN, '').toUpperCase()
}

function isJoiner(value: string | undefined): boolean {
	return value === ' ' || value === '-' || value === '_'
}

function canRemoveKeyword(phrase: string, keyword: string, index: number): boolean {
	if (keyword.length !== 1) {
		return true
	}

	return isJoiner(phrase[index - 1]) || isJoiner(phrase[index + keyword.length])
}

function invalidReceipt(failureReason: FourthTriadReceipt['failureReason']): FourthTriadReceipt {
	return {
		valid: false,
		matches: [],
		candidates: [],
		unmatchedPhrases: [],
		unmatchedKeywords: [],
		ambiguousCandidates: [],
		failureReason,
	}
}

/**
 * Proves that each final-triad phrase reduces to one distinct earlier keyword.
 *
 * A removable keyword occurrence is considered for every final phrase. The
 * resulting residual only loses joiners exposed by that removal; its spelling
 * and internal punctuation remain significant.
 */
export function buildFourthTriadReceipt(earlyKeywords: string[], finalTriad: FinalTriadInput): FourthTriadReceipt {
	if (
		earlyKeywords.length !== 3 ||
		earlyKeywords.some((keyword) => typeof keyword !== 'string' || keyword.length === 0) ||
		typeof finalTriad.keyword !== 'string' ||
		finalTriad.keyword.length === 0 ||
		!Array.isArray(finalTriad.fullPhrases) ||
		finalTriad.fullPhrases.length !== 3 ||
		finalTriad.fullPhrases.some((phrase) => typeof phrase !== 'string' || phrase.length === 0)
	) {
		return invalidReceipt('invalid-input')
	}

	const canonicalKeywords = earlyKeywords.map(canonicalize)
	if (canonicalKeywords.some((keyword) => keyword.length === 0) || new Set(canonicalKeywords).size !== canonicalKeywords.length) {
		const receipt = invalidReceipt('duplicate-keywords')
		receipt.unmatchedKeywords = earlyKeywords.map((keyword, index) => ({ triadIndex: index + 1, keyword }))
		return receipt
	}

	const finalKeywordUpper = finalTriad.keyword.toUpperCase()
	const candidates: TriadReceiptCandidate[] = []

	for (const [phraseIndex, phrase] of finalTriad.fullPhrases.entries()) {
		const phraseUpper = phrase.toUpperCase()
		let occurrenceIndex = phraseUpper.indexOf(finalKeywordUpper)

		while (occurrenceIndex !== -1) {
			if (canRemoveKeyword(phrase, finalTriad.keyword, occurrenceIndex)) {
				const residual = phrase.slice(0, occurrenceIndex) + phrase.slice(occurrenceIndex + finalTriad.keyword.length)
				const canonicalResidual = canonicalize(residual)

				for (const [keywordIndex, canonicalKeyword] of canonicalKeywords.entries()) {
					if (canonicalResidual === canonicalKeyword) {
						candidates.push({
							phraseIndex,
							phrase,
							keywordOccurrenceIndex: occurrenceIndex,
							residual,
							canonicalResidual,
							triadIndex: keywordIndex + 1,
							keyword: earlyKeywords[keywordIndex],
						})
					}
				}
			}

			occurrenceIndex = phraseUpper.indexOf(finalKeywordUpper, occurrenceIndex + 1)
		}
	}

	const edgesByPhrase = finalTriad.fullPhrases.map((_, phraseIndex) => {
		const edges = new Map<number, MatchEdge>()
		for (const candidate of candidates.filter((item) => item.phraseIndex === phraseIndex)) {
			if (!edges.has(candidate.triadIndex)) {
				edges.set(candidate.triadIndex, { triadIndex: candidate.triadIndex, candidate })
			}
		}
		return [...edges.values()]
	})

	const matchings: MatchEdge[][] = []
	const findMatchings = (phraseIndex: number, usedTriads: Set<number>, matching: MatchEdge[]) => {
		if (phraseIndex === edgesByPhrase.length) {
			matchings.push(matching)
			return
		}

		for (const edge of edgesByPhrase[phraseIndex]) {
			if (!usedTriads.has(edge.triadIndex)) {
				usedTriads.add(edge.triadIndex)
				findMatchings(phraseIndex + 1, usedTriads, [...matching, edge])
				usedTriads.delete(edge.triadIndex)
			}
		}
	}

	findMatchings(0, new Set<number>(), [])

	const unmatchedPhrases = edgesByPhrase.flatMap((edges, phraseIndex) => (edges.length === 0 ? [phraseIndex] : []))
	const matchedTriads = new Set(candidates.map((candidate) => candidate.triadIndex))
	const unmatchedKeywords = earlyKeywords
		.map((keyword, index) => ({ triadIndex: index + 1, keyword }))
		.filter(({ triadIndex }) => !matchedTriads.has(triadIndex))

	if (matchings.length !== 1) {
		const ambiguousCandidates = matchings.length > 1 ? matchings.flat().map((edge) => edge.candidate) : candidates
		return {
			valid: false,
			matches: [],
			candidates,
			unmatchedPhrases,
			unmatchedKeywords,
			ambiguousCandidates,
			failureReason: matchings.length > 1 ? 'ambiguous-matching' : 'no-perfect-matching',
		}
	}

	const matches = matchings[0].map(({ candidate }) => ({
		...candidate,
		display: `${candidate.phrase} - ${finalTriad.keyword} = ${candidate.canonicalResidual} -> Triad ${candidate.triadIndex}`,
	}))

	return {
		valid: true,
		matches,
		candidates,
		unmatchedPhrases: [],
		unmatchedKeywords: [],
		ambiguousCandidates: [],
	}
}

export function formatFourthTriadReceipt(receipt: FourthTriadReceipt): string {
	if (receipt.valid) {
		return receipt.matches.map((match) => match.display).join('; ')
	}

	const details: string[] = []
	if (receipt.unmatchedKeywords.length > 0) {
		details.push(`Unmatched keywords: ${receipt.unmatchedKeywords.map((item) => `Triad ${item.triadIndex} (${item.keyword})`).join(', ')}`)
	}
	if (receipt.unmatchedPhrases.length > 0) {
		details.push(`Unmatched final phrases: ${receipt.unmatchedPhrases.map((index) => `Word ${index + 1}`).join(', ')}`)
	}
	if (receipt.ambiguousCandidates.length > 0) {
		details.push(
			`Candidate matches: ${receipt.ambiguousCandidates
				.map((candidate) => `${candidate.phrase} - ${candidate.keyword} -> Triad ${candidate.triadIndex}`)
				.join('; ')}`,
		)
	}

	return details.length > 0 ? details.join('. ') : 'Final triad must map each phrase to one distinct earlier keyword'
}
