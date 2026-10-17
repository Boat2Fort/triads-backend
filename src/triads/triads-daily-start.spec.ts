import { Test } from '@nestjs/testing'
import { DailyAttemptStatus, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { TriadsDailyService } from './triads-daily.service'

// Simulate the database interleaving: two requests both saw no attempt, then
// one inserted it before the other's INSERT reached the unique constraint.
describe('Daily attempt creation race', () => {
	const anonymousId = 'test-player-12345678'
	const stored = {
		id: 1,
		anonymousId,
		status: DailyAttemptStatus.IN_PROGRESS,
		score: null,
		progress: { saved: true },
		scrambledCues: ['PANIC', 'PUSH-', 'CAMPAIGN'],
	}
	const group = {
		id: 7,
		active: true,
		Triad1: { keyword: 'BUTTON', fullPhrases: ['PUSH-BUTTON', 'PANIC BUTTON', 'CAMPAIGN BUTTON'] },
		Triad2: { keyword: 'PIGEON', fullPhrases: ['CLAY PIGEON', 'CARRIER PIGEON', 'STOOL PIGEON'] },
		Triad3: { keyword: 'PORT', fullPhrases: ['PORT AUTHORITY', 'AIRPORT', 'PORT WINE'] },
	}

	it('returns the winning request’s board and progress after a unique-constraint conflict', async () => {
		const prisma = {
			triadDailySchedule: { findUnique: jest.fn().mockResolvedValue({ TriadGroup: group }) },
			dailyTriadAttempt: {
				findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(stored),
				create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Duplicate attempt', { code: 'P2002', clientVersion: '6.12.0' })),
			},
		}
		const module = await Test.createTestingModule({ providers: [TriadsDailyService, { provide: PrismaService, useValue: prisma }] }).compile()
		const response = await module.get(TriadsDailyService).getDailyCues(anonymousId)
		expect(response).toMatchObject({ scheduled: true, alreadyCompleted: false, cues: stored.scrambledCues, progress: stored.progress })
		expect(prisma.dailyTriadAttempt.create).toHaveBeenCalledTimes(1)
	})

	it('returns a finished result if the other request also completed the attempt', async () => {
		const prisma = {
			triadDailySchedule: { findUnique: jest.fn().mockResolvedValue({ TriadGroup: group }) },
			dailyTriadAttempt: {
				findUnique: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce({ ...stored, status: DailyAttemptStatus.WON, score: 15 }),
				create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Duplicate attempt', { code: 'P2002', clientVersion: '6.12.0' })),
			},
		}
		const module = await Test.createTestingModule({ providers: [TriadsDailyService, { provide: PrismaService, useValue: prisma }] }).compile()
		expect(await module.get(TriadsDailyService).getDailyCues(anonymousId)).toMatchObject({ alreadyCompleted: true, score: 15, cues: null })
	})
})
