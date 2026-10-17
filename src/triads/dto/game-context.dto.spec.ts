import 'reflect-metadata'

import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { CheckAnswerDto } from './check-answer.dto'
import { GetHintDto } from './get-hint.dto'

describe('gameplay context validation', () => {
	it('transforms the group query parameter and validates it for answers and hints', async () => {
		for (const dto of [
			plainToInstance(CheckAnswerDto, { cues: ['A', 'B', 'C'], answer: 'KEY', triadGroupId: '7', triadsStep: 'FINAL' }),
			plainToInstance(GetHintDto, { cues: ['A', 'B', 'C'], triadGroupId: '7', triadsStep: 'FINAL' }),
		]) {
			expect(dto.triadGroupId).toBe(7)
			expect(await validate(dto)).toHaveLength(0)
		}
	})

	it.each(['0', '-1', '1.5', 'bad'])('rejects invalid group %s', async (triadGroupId) => {
		const dto = plainToInstance(CheckAnswerDto, { cues: ['A', 'B', 'C'], answer: 'KEY', triadGroupId })
		expect((await validate(dto)).some((error) => error.property === 'triadGroupId')).toBe(true)
	})

	it('rejects an unknown round', async () => {
		const dto = plainToInstance(GetHintDto, { cues: ['A', 'B', 'C'], triadGroupId: '7', triadsStep: 'UNKNOWN' })
		expect((await validate(dto)).some((error) => error.property === 'triadsStep')).toBe(true)
	})
})
