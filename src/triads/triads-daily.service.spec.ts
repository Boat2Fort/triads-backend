import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { DailyAttemptStatus } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { DAILY_CLASSIC_EXTRA_LIMIT } from './triads-daily.constants'
import { TriadsDailyService } from './triads-daily.service'
import { easternYmdToDbDate, getEasternYmd } from './triads-daily-timezone'

type ScheduleRow = { id: number; puzzleDate: Date; triadGroupId: number }
type AttemptRow = {
	id?: number
	anonymousId: string
	puzzleDate: Date
	status: DailyAttemptStatus
	progress?: unknown
}
type ClassicUsageRow = {
	anonymousId: string
	puzzleDate: Date
	gamesStarted: number
}

type PrismaMockBundle = {
	prismaMock: PrismaService
	rows: ScheduleRow[]
	attempts: AttemptRow[]
	classicUsage: ClassicUsageRow[]
}

const TEST_ANONYMOUS_ID = 'test-player-12345678'

function dateOnly(d: Date): string {
	return d.toISOString().slice(0, 10)
}

function addDaysYmd(baseYmd: string, days: number): string {
	const [y, m, d] = baseYmd.split('-').map(Number)
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function createPrismaMock(
	initialRows: Array<{ id: number; puzzleDateYmd: string; triadGroupId: number }>,
	options?: {
		attempts?: AttemptRow[]
		classicUsage?: ClassicUsageRow[]
	},
): PrismaMockBundle {
	const rows: ScheduleRow[] = initialRows.map((r) => ({
		id: r.id,
		puzzleDate: easternYmdToDbDate(r.puzzleDateYmd),
		triadGroupId: r.triadGroupId,
	}))
	const attempts: AttemptRow[] = options?.attempts ?? []
	const classicUsage: ClassicUsageRow[] = options?.classicUsage ?? []

	const sortAsc = () => rows.sort((a, b) => a.puzzleDate.getTime() - b.puzzleDate.getTime() || a.id - b.id)

	const prismaMock = {
		triadGroup: {
			findFirst: jest.fn(() => ({ id: 1, active: true })),
		},
		triadDailySchedule: {
			findUnique: jest.fn(({ where }: { where: { puzzleDate?: Date; id?: number } }) => {
				if (where.puzzleDate) {
					const row = rows.find((r) => dateOnly(r.puzzleDate) === dateOnly(where.puzzleDate))
					return row ? { id: row.id, puzzleDate: row.puzzleDate, triadGroupId: row.triadGroupId } : null
				}
				if (where.id !== undefined) {
					const row = rows.find((r) => r.id === where.id)
					if (!row) {
						return null
					}
					return { id: row.id, puzzleDate: row.puzzleDate, triadGroupId: row.triadGroupId }
				}
				return null
			}),
			findFirst: jest.fn(({ where }: { where: { triadGroupId: number } }) => {
				const row = rows.find((r) => r.triadGroupId === where.triadGroupId)
				return row ? { id: row.id, puzzleDate: row.puzzleDate, triadGroupId: row.triadGroupId } : null
			}),
			count: jest.fn(({ where }: { where: { puzzleDate: { lte: Date } } }) => {
				const cutoff = where.puzzleDate.lte
				return rows.filter((r) => r.puzzleDate.getTime() <= cutoff.getTime()).length
			}),
			create: jest.fn(({ data }: { data: { puzzleDate: Date; triadGroupId?: number; TriadGroup?: { connect: { id: number } } } }) => {
				const nextId = rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1
				const created = { id: nextId, puzzleDate: data.puzzleDate, triadGroupId: data.triadGroupId ?? data.TriadGroup?.connect.id ?? 0 }
				rows.push(created)
				sortAsc()
				return created
			}),
			update: jest.fn(({ where, data }: { where: { id: number }; data: { puzzleDate: Date } }) => {
				const row = rows.find((r) => r.id === where.id)
				if (!row) {
					const error = new Error('not found') as Error & { code?: string }
					error.code = 'P2025'
					throw error
				}
				row.puzzleDate = data.puzzleDate
				sortAsc()
				return row
			}),
			delete: jest.fn(({ where }: { where: { id: number } }) => {
				const idx = rows.findIndex((r) => r.id === where.id)
				if (idx === -1) {
					const error = new Error('not found') as Error & { code?: string }
					error.code = 'P2025'
					throw error
				}
				return rows.splice(idx, 1)[0]
			}),
			findMany: jest.fn(() => rows),
		},
		dailyTriadAttempt: {
			findUnique: jest.fn(({ where }: { where: { anonymousId_puzzleDate: { anonymousId: string; puzzleDate: Date } } }) => {
				const row = attempts.find(
					(a) =>
						a.anonymousId === where.anonymousId_puzzleDate.anonymousId &&
						dateOnly(a.puzzleDate) === dateOnly(where.anonymousId_puzzleDate.puzzleDate),
				)
				if (!row) return null
				if (row.id === undefined) {
					row.id = attempts.indexOf(row) + 1
				}
				return { id: row.id, status: row.status, progress: row.progress ?? null }
			}),
			updateMany: jest.fn(
				({
					where,
					data,
				}: {
					where: { id: number; status: DailyAttemptStatus }
					data: { progress?: unknown; status?: DailyAttemptStatus; score?: number }
				}) => {
					const row = attempts.find((a) => a.id === where.id && a.status === where.status)
					if (!row) return { count: 0 }
					if (data.progress !== undefined) row.progress = data.progress
					if (data.status !== undefined) row.status = data.status
					return { count: 1 }
				},
			),
			update: jest.fn(({ where, data }: { where: { id: number }; data: { progress?: unknown; status?: DailyAttemptStatus; score?: number } }) => {
				const row = attempts.find((a) => a.id === where.id)
				if (!row) return null
				if (data.progress !== undefined) {
					row.progress = data.progress
				}
				if (data.status !== undefined) {
					row.status = data.status
				}
				return { id: row.id, status: row.status }
			}),
		},
		dailyClassicExtraUsage: {
			findUnique: jest.fn(({ where }: { where: { anonymousId_puzzleDate: { anonymousId: string; puzzleDate: Date } } }) => {
				const row = classicUsage.find(
					(u) =>
						u.anonymousId === where.anonymousId_puzzleDate.anonymousId &&
						dateOnly(u.puzzleDate) === dateOnly(where.anonymousId_puzzleDate.puzzleDate),
				)
				return row ? { gamesStarted: row.gamesStarted } : null
			}),
			upsert: jest.fn(
				({
					where,
					create,
					update,
				}: {
					where: { anonymousId_puzzleDate: { anonymousId: string; puzzleDate: Date } }
					create: { anonymousId: string; puzzleDate: Date; gamesStarted: number }
					update: { gamesStarted: { increment: number } }
				}) => {
					const existing = classicUsage.find(
						(u) =>
							u.anonymousId === where.anonymousId_puzzleDate.anonymousId &&
							dateOnly(u.puzzleDate) === dateOnly(where.anonymousId_puzzleDate.puzzleDate),
					)
					if (existing) {
						existing.gamesStarted += update.gamesStarted.increment
						return { gamesStarted: existing.gamesStarted }
					}
					classicUsage.push(create)
					return { gamesStarted: create.gamesStarted }
				},
			),
		},
		$transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
		$queryRaw: jest.fn(({ values }: { values: unknown[] }) => {
			const offset = Number(values[0] ?? 0)
			const take = Number(values[1] ?? 50)
			sortAsc()
			const rankedAsc = rows.map((r, idx) => ({
				id: r.id,
				puzzleDate: r.puzzleDate,
				triadGroupId: r.triadGroupId,
				challengeNumber: BigInt(idx + 1),
			}))
			return rankedAsc.sort((a, b) => b.puzzleDate.getTime() - a.puzzleDate.getTime() || b.id - a.id).slice(offset, offset + take)
		}),
	}

	return { prismaMock: prismaMock as PrismaService, rows, attempts, classicUsage }
}

describe('TriadsDailyService (date-ordered challenge numbers)', () => {
	const buildService = async (prismaMock: PrismaService) => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [TriadsDailyService, { provide: PrismaService, useValue: prismaMock }],
		}).compile()
		return module.get(TriadsDailyService)
	}

	it('computes today challengeNumber by date order', async () => {
		const today = getEasternYmd()
		const { prismaMock } = createPrismaMock([
			{ id: 1, puzzleDateYmd: addDaysYmd(today, -1), triadGroupId: 10 },
			{ id: 2, puzzleDateYmd: today, triadGroupId: 11 },
		])
		const service = await buildService(prismaMock)

		const info = await service.getTodayPublicInfo()
		expect(info.scheduled).toBe(true)
		if (info.scheduled) {
			expect(info.challengeNumber).toBe(2)
		}
	})

	it('creates a schedule for an unscheduled active group', async () => {
		const { prismaMock, rows } = createPrismaMock([])
		const service = await buildService(prismaMock)
		const futureYmd = addDaysYmd(getEasternYmd(), 3)

		const created = await service.createSchedule(futureYmd, 1)

		expect(created.puzzleDate).toBe(futureYmd)
		expect(created.triadGroupId).toBe(1)
		expect(rows).toHaveLength(1)
	})

	it('moves an existing future schedule to a free date', async () => {
		const today = getEasternYmd()
		const originalYmd = addDaysYmd(today, 3)
		const targetYmd = addDaysYmd(today, 4)
		const { prismaMock, rows } = createPrismaMock([{ id: 1, puzzleDateYmd: originalYmd, triadGroupId: 1 }])
		const service = await buildService(prismaMock)

		const moved = await service.createSchedule(targetYmd, 1)

		expect(moved.id).toBe(1)
		expect(moved.puzzleDate).toBe(targetYmd)
		expect(rows).toHaveLength(1)
		expect(dateOnly(rows[0].puzzleDate)).toBe(targetYmd)
	})

	it('rejects moving an existing today or past schedule', async () => {
		const today = getEasternYmd()
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 1 }])
		const service = await buildService(prismaMock)

		await expect(service.createSchedule(addDaysYmd(today, 2), 1)).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('rejects moving an existing future schedule to today or the past', async () => {
		const today = getEasternYmd()
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: addDaysYmd(today, 2), triadGroupId: 1 }])
		const service = await buildService(prismaMock)

		await expect(service.createSchedule(today, 1)).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('rejects scheduling onto a date assigned to another group', async () => {
		const targetYmd = addDaysYmd(getEasternYmd(), 2)
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: targetYmd, triadGroupId: 2 }])
		const service = await buildService(prismaMock)

		await expect(service.createSchedule(targetYmd, 1)).rejects.toBeInstanceOf(ConflictException)
	})

	it('deletes future schedule rows and keeps date-ordered challenge numbers contiguous', async () => {
		const today = getEasternYmd()
		const { prismaMock, rows } = createPrismaMock([
			{ id: 1, puzzleDateYmd: addDaysYmd(today, 1), triadGroupId: 1 },
			{ id: 2, puzzleDateYmd: addDaysYmd(today, 2), triadGroupId: 2 },
			{ id: 3, puzzleDateYmd: addDaysYmd(today, 3), triadGroupId: 3 },
		])
		const service = await buildService(prismaMock)

		await service.deleteSchedule(2)
		const listAfterDelete = await service.listSchedules(0, 50)
		const byDateDelete = [...listAfterDelete].sort((a, b) => a.puzzleDate.localeCompare(b.puzzleDate))
		expect(byDateDelete.map((r) => r.challengeNumber)).toEqual([1, 2])
		expect(rows).toHaveLength(2)
	})

	it('rejects deleting today or past schedule rows', async () => {
		const today = getEasternYmd()
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 1 }])
		const service = await buildService(prismaMock)

		await expect(service.deleteSchedule(1)).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('throws NotFoundException for unknown schedule deletion', async () => {
		const { prismaMock } = createPrismaMock([])
		const service = await buildService(prismaMock)
		await expect(service.deleteSchedule(999)).rejects.toBeInstanceOf(NotFoundException)
	})
})

describe('TriadsDailyService (classic extra quota)', () => {
	const buildService = async (prismaMock: PrismaService) => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [TriadsDailyService, { provide: PrismaService, useValue: prismaMock }],
		}).compile()
		return module.get(TriadsDailyService)
	}

	const today = getEasternYmd()
	const todayDate = easternYmdToDbDate(today)

	it('blocks Classic when Daily is scheduled and not completed', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }])
		const service = await buildService(prismaMock)

		const usage = await service.getClassicExtraUsage(TEST_ANONYMOUS_ID)
		expect(usage.canPlayClassic).toBe(false)
		expect(usage.classicBlockedReason).toBe('daily_required')
		expect(usage.classicExtrasRemaining).toBe(DAILY_CLASSIC_EXTRA_LIMIT)

		await expect(service.incrementClassicExtraStart(TEST_ANONYMOUS_ID)).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('allows Classic after Daily is won or lost', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.WON }],
		})
		const service = await buildService(prismaMock)

		const usage = await service.getClassicExtraUsage(TEST_ANONYMOUS_ID)
		expect(usage.canPlayClassic).toBe(true)
		expect(usage.classicBlockedReason).toBeNull()

		const afterStart = await service.incrementClassicExtraStart(TEST_ANONYMOUS_ID)
		expect(afterStart.classicExtrasUsed).toBe(1)
		expect(afterStart.classicExtrasRemaining).toBe(DAILY_CLASSIC_EXTRA_LIMIT - 1)
	})

	it('allows up to six Classic starts on unscheduled days without Daily gate', async () => {
		const { prismaMock } = createPrismaMock([])
		const service = await buildService(prismaMock)

		const usage = await service.getClassicExtraUsage(TEST_ANONYMOUS_ID)
		expect(usage.canPlayClassic).toBe(true)
		expect(usage.classicBlockedReason).toBeNull()

		for (let i = 0; i < DAILY_CLASSIC_EXTRA_LIMIT; i++) {
			const next = await service.incrementClassicExtraStart(TEST_ANONYMOUS_ID)
			expect(next.classicExtrasUsed).toBe(i + 1)
			expect(next.classicExtrasRemaining).toBe(DAILY_CLASSIC_EXTRA_LIMIT - (i + 1))
		}

		await expect(service.incrementClassicExtraStart(TEST_ANONYMOUS_ID)).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('saves in-progress snapshot only while attempt is IN_PROGRESS', async () => {
		const { prismaMock, attempts } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ id: 7, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.IN_PROGRESS }],
		})
		const service = await buildService(prismaMock)

		const result = await service.saveDailyProgress(TEST_ANONYMOUS_ID, { solvedTriads: ['a', 'b'] })
		expect(result).toEqual({ ok: true, ignored: false })
		expect(attempts[0].progress).toEqual({ solvedTriads: ['a', 'b'] })

		attempts[0].status = DailyAttemptStatus.WON
		const lateSave = await service.saveDailyProgress(TEST_ANONYMOUS_ID, { stale: true })
		expect(lateSave).toEqual({ ok: true, ignored: true })
		expect(attempts[0].progress).toEqual({ solvedTriads: ['a', 'b'] })
	})

	it('rejects oversized progress payloads', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ id: 1, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.IN_PROGRESS }],
		})
		const service = await buildService(prismaMock)

		const huge = { blob: 'x'.repeat(20 * 1024) }
		await expect(service.saveDailyProgress(TEST_ANONYMOUS_ID, huge)).rejects.toBeInstanceOf(BadRequestException)
	})

	it('rejects progress save when no attempt exists', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }])
		const service = await buildService(prismaMock)
		await expect(service.saveDailyProgress(TEST_ANONYMOUS_ID, { foo: 1 })).rejects.toBeInstanceOf(NotFoundException)
	})

	it('saves and completes the loaded puzzle after Eastern midnight without modifying today’s attempt', async () => {
		const yesterday = addDaysYmd(today, -1)
		const { prismaMock, attempts } = createPrismaMock([], {
			attempts: [
				{ id: 1, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: easternYmdToDbDate(yesterday), status: DailyAttemptStatus.IN_PROGRESS },
				{ id: 2, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.IN_PROGRESS },
			],
		})
		const service = await buildService(prismaMock)
		const progress = { puzzleDate: yesterday, solvedTriads: ['BUTTON'] }
		await service.saveDailyProgress(TEST_ANONYMOUS_ID, progress)
		expect(attempts[0].progress).toEqual(progress)
		expect(attempts[1].progress).toBeUndefined()
		const result = await service.completeDaily(TEST_ANONYMOUS_ID, 'won', 15, yesterday)
		expect(result.puzzleDate).toBe(yesterday)
		expect(attempts[0].status).toBe(DailyAttemptStatus.WON)
		expect(attempts[1].status).toBe(DailyAttemptStatus.IN_PROGRESS)
	})

	it.each(['not-a-date', '2026-02-30', '2999-01-01'])('rejects invalid or future attempt date %s', async (date) => {
		const { prismaMock } = createPrismaMock([])
		const service = await buildService(prismaMock)
		await expect(service.completeDaily(TEST_ANONYMOUS_ID, 'won', 15, date)).rejects.toBeInstanceOf(BadRequestException)
		await expect(service.saveDailyProgress(TEST_ANONYMOUS_ID, { puzzleDate: date })).rejects.toBeInstanceOf(BadRequestException)
	})

	it('allows only one concurrent completion to commit a result', async () => {
		const { prismaMock } = createPrismaMock([], {
			attempts: [{ id: 1, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.IN_PROGRESS }],
		})
		const service = await buildService(prismaMock)
		const results = await Promise.allSettled([service.completeDaily(TEST_ANONYMOUS_ID, 'won', 15), service.completeDaily(TEST_ANONYMOUS_ID, 'lost', 0)])
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		const failure = results.find((result) => result.status === 'rejected')
		expect(failure?.reason).toBeInstanceOf(ConflictException)
	})

	it('ignores a delayed progress write if completion won the database race', async () => {
		const { prismaMock, attempts } = createPrismaMock([], {
			attempts: [{ id: 1, anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.IN_PROGRESS }],
		})
		const service = await buildService(prismaMock)
		const completion = service.completeDaily(TEST_ANONYMOUS_ID, 'won', 15)
		const save = service.saveDailyProgress(TEST_ANONYMOUS_ID, { stale: true })
		await completion
		expect(await save).toEqual({ ok: true, ignored: true })
		expect(attempts[0].progress).not.toEqual({ stale: true })
	})

	it('includes classic quota fields in getTodayPublicInfo', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, status: DailyAttemptStatus.LOST }],
			classicUsage: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: todayDate, gamesStarted: 2 }],
		})
		const service = await buildService(prismaMock)

		const info = await service.getTodayPublicInfo(TEST_ANONYMOUS_ID)
		expect(info).toMatchObject({
			scheduled: true,
			hasCompletedDaily: true,
			classicExtrasUsed: 2,
			classicExtrasRemaining: 1,
			classicExtrasLimit: DAILY_CLASSIC_EXTRA_LIMIT,
			canPlayClassic: true,
			classicBlockedReason: null,
		})
	})
})

// Trello KxOrLjJv: yesterday's attempt/bonus state must never influence today's response. The
// home page and play guards key off this endpoint to decide between Welcome / in-progress Daily /
// completed Daily / bonus games, so any leakage across the Eastern-midnight rollover would strand
// a returning player on yesterday's screen.
describe('TriadsDailyService (cross-day rollover isolation)', () => {
	const buildService = async (prismaMock: PrismaService) => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [TriadsDailyService, { provide: PrismaService, useValue: prismaMock }],
		}).compile()
		return module.get(TriadsDailyService)
	}

	const today = getEasternYmd()
	const yesterday = addDaysYmd(today, -1)
	const yesterdayDate = easternYmdToDbDate(yesterday)

	it("reports today's Welcome state when yesterday's Daily was won with no bonus games", async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, status: DailyAttemptStatus.WON }],
		})
		const service = await buildService(prismaMock)

		const info = await service.getTodayPublicInfo(TEST_ANONYMOUS_ID)
		expect(info).toMatchObject({
			scheduled: true,
			hasCompletedDaily: false,
			classicExtrasUsed: 0,
			classicExtrasRemaining: DAILY_CLASSIC_EXTRA_LIMIT,
			canPlayClassic: false,
			classicBlockedReason: 'daily_required',
		})
	})

	it("reports today's Welcome state when yesterday's Daily was won and one bonus game was played", async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, status: DailyAttemptStatus.WON }],
			classicUsage: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, gamesStarted: 1 }],
		})
		const service = await buildService(prismaMock)

		const info = await service.getTodayPublicInfo(TEST_ANONYMOUS_ID)
		expect(info).toMatchObject({
			scheduled: true,
			hasCompletedDaily: false,
			classicExtrasUsed: 0,
			classicExtrasRemaining: DAILY_CLASSIC_EXTRA_LIMIT,
			canPlayClassic: false,
			classicBlockedReason: 'daily_required',
		})
	})

	it("reports today's Welcome state when yesterday's Daily was left in progress", async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, status: DailyAttemptStatus.IN_PROGRESS }],
		})
		const service = await buildService(prismaMock)

		const info = await service.getTodayPublicInfo(TEST_ANONYMOUS_ID)
		expect(info).toMatchObject({
			scheduled: true,
			hasCompletedDaily: false,
			classicExtrasUsed: 0,
			classicExtrasRemaining: DAILY_CLASSIC_EXTRA_LIMIT,
			canPlayClassic: false,
			classicBlockedReason: 'daily_required',
		})
	})

	it('keeps Classic blocked by daily_required when yesterday had max bonus usage', async () => {
		const { prismaMock } = createPrismaMock([{ id: 1, puzzleDateYmd: today, triadGroupId: 10 }], {
			attempts: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, status: DailyAttemptStatus.WON }],
			classicUsage: [{ anonymousId: TEST_ANONYMOUS_ID, puzzleDate: yesterdayDate, gamesStarted: DAILY_CLASSIC_EXTRA_LIMIT }],
		})
		const service = await buildService(prismaMock)

		const usage = await service.getClassicExtraUsage(TEST_ANONYMOUS_ID)
		expect(usage).toMatchObject({
			classicExtrasUsed: 0,
			classicExtrasRemaining: DAILY_CLASSIC_EXTRA_LIMIT,
			canPlayClassic: false,
			classicBlockedReason: 'daily_required',
		})
	})
})
