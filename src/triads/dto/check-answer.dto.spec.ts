import 'reflect-metadata'

import { plainToInstance } from 'class-transformer'

import { CheckAnswerDto } from './check-answer.dto'

describe('CheckAnswerDto', () => {
	it('strips trailing whitespace from the answer (iOS auto-complete bug)', () => {
		const dto = plainToInstance(CheckAnswerDto, { cues: ['a', 'b', 'c'], answer: 'fish ' })
		expect(dto.answer).toBe('fish')
	})

	it('strips leading whitespace from the answer', () => {
		const dto = plainToInstance(CheckAnswerDto, { cues: ['a', 'b', 'c'], answer: ' fish' })
		expect(dto.answer).toBe('fish')
	})

	it('leaves internal whitespace untouched (full phrases may contain spaces)', () => {
		const dto = plainToInstance(CheckAnswerDto, { cues: ['a', 'b', 'c'], answer: '  full moon  ' })
		expect(dto.answer).toBe('full moon')
	})
})
