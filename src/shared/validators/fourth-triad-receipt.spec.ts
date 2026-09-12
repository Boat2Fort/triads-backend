import { buildFourthTriadReceipt, formatFourthTriadReceipt } from './fourth-triad-receipt'

describe('buildFourthTriadReceipt', () => {
	it('matches each final phrase to exactly one earlier triad', () => {
		const receipt = buildFourthTriadReceipt(['AUTO', 'E', 'PROFIT'], {
			keyword: 'MOTIVE',
			fullPhrases: ['AUTOMOTIVE', 'PROFIT MOTIVE', 'EMOTIVE'],
		})

		expect(receipt.valid).toBe(true)
		expect(receipt.matches.map((match) => match.display)).toEqual([
			'AUTOMOTIVE - MOTIVE = AUTO -> Triad 1',
			'PROFIT MOTIVE - MOTIVE = PROFIT -> Triad 3',
			'EMOTIVE - MOTIVE = E -> Triad 2',
		])
	})

	it('rejects a group when a final phrase does not link to each earlier keyword', () => {
		const receipt = buildFourthTriadReceipt(['ARROW', 'EGG', 'STONE'], {
			keyword: 'HEAD',
			fullPhrases: ['ARROWHEAD', 'SPEARHEAD', 'HEADSTONE'],
		})

		expect(receipt.valid).toBe(false)
		expect(receipt.unmatchedKeywords).toEqual([{ triadIndex: 2, keyword: 'EGG' }])
		expect(formatFourthTriadReceipt(receipt)).toContain('Word 2')
	})

	it('rejects the synthetic case the old server loop accepted', () => {
		const receipt = buildFourthTriadReceipt(['ALPHA', 'BRAVO', 'ZULU'], {
			keyword: 'LINK',
			fullPhrases: ['ZULULINK', 'FOOLINK', 'BARLINK'],
		})

		expect(receipt.valid).toBe(false)
		expect(receipt.unmatchedKeywords.map((item) => item.keyword)).toEqual(['ALPHA', 'BRAVO'])
	})

	it('allows a one-letter final keyword only when it is joined to the residual', () => {
		const receipt = buildFourthTriadReceipt(['BONE', 'MOBILE', 'REX'], {
			keyword: 'T',
			fullPhrases: ['T-BONE', 'T-MOBILE', 'T-REX'],
		})

		expect(receipt.valid).toBe(true)
	})

	it('rejects an incidental one-letter occurrence inside a word', () => {
		const receipt = buildFourthTriadReceipt(['AX', 'BONE', 'MOBILE'], {
			keyword: 'T',
			fullPhrases: ['TAX', 'T-BONE', 'T-MOBILE'],
		})

		expect(receipt.valid).toBe(false)
		expect(receipt.unmatchedKeywords).toEqual([{ triadIndex: 1, keyword: 'AX' }])
	})

	it('normalizes joiners exposed by removal without changing internal punctuation', () => {
		const receipt = buildFourthTriadReceipt(['T-', 'BONE', 'MOBILE'], {
			keyword: 'SHIRT',
			fullPhrases: ['T-SHIRT', 'BONE SHIRT', 'MOBILE_SHIRT'],
		})

		expect(receipt.valid).toBe(true)
		expect(receipt.matches[0].canonicalResidual).toBe('T')
	})
})
