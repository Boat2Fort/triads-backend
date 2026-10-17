import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '../prisma/prisma.service'
import { TriadsController } from './triads.controller'
import { TriadsService } from './triads.service'
import { TriadsDailyService } from './triads-daily.service'

describe('TriadsController', () => {
	let controller: TriadsController
	let service: TriadsService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [TriadsController],
			providers: [TriadsService, { provide: PrismaService, useValue: {} }, { provide: TriadsDailyService, useValue: {} }],
		}).compile()

		controller = module.get<TriadsController>(TriadsController)
		service = module.get<TriadsService>(TriadsService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
	it('returns false for an invalid triad instead of an answer-validation exception', async () => {
		jest.spyOn(service, 'getMatchedTriad').mockResolvedValue(undefined)
		expect(await controller.checkAnswer({ cues: ['A', 'B', 'C'], answer: 'KEY', triadGroupId: 7 })).toBe(false)
	})

	it('keeps validated submitted cues intact in a correct answer response', async () => {
		const triad = { id: 1, keyword: 'BUTTON', cues: ['PUSH', 'CAMPAIGN', 'PANIC'], fullPhrases: ['PUSH-BUTTON', 'CAMPAIGN BUTTON', 'PANIC BUTTON'] }
		const dto = { cues: ['PANIC', 'PUSH-', 'CAMPAIGN'], answer: 'BUTTON', triadGroupId: 7, triadsStep: 'INITIAL' as const }
		const match = jest.spyOn(service, 'getMatchedTriad').mockResolvedValue(triad)
		expect(await controller.checkAnswer(dto)).toEqual({ ...triad, cues: dto.cues })
		expect(match).toHaveBeenCalledWith(dto.cues, dto, 'BUTTON')
	})
})
