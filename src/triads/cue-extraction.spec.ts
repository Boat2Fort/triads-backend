import { extractCuesFromPhrases } from './cue-extraction'

describe('extractCuesFromPhrases', () => {
	it('preserves hyphens before and after the key for display', () => {
		expect(extractCuesFromPhrases(['PUSH-BUTTON', 'BUTTON-HOLE', 'PANIC BUTTON'], 'BUTTON')).toEqual(['PUSH-', '-HOLE', 'PANIC'])
	})

	it('preserves internal hyphens while removing a space or underscore joiner', () => {
		expect(extractCuesFromPhrases(['SELF-SERVICE KEY', 'KEY_SELF-SERVICE', 'KEY SELF-SERVICE'], 'KEY')).toEqual([
			'SELF-SERVICE',
			'SELF-SERVICE',
			'SELF-SERVICE',
		])
	})

	it('handles fused compounds, case differences, and a repeated key substring', () => {
		expect(extractCuesFromPhrases(['Overstock', 'STOCK EXCHANGE', 'Woodstock'], 'stock')).toEqual(['OVER', 'EXCHANGE', 'WOOD'])
		expect(extractCuesFromPhrases(['EVEN STEVEN'], 'EVEN')).toEqual(['STEVEN'])
	})
})
