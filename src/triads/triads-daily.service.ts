import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DailyAttemptStatus, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { extractCuesFromPhrases } from './cue-extraction'
import { buildClassicExtraUsageInfo, ClassicExtraUsageInfo } from './triads-daily.types'
import { easternYmdToDbDate, getEasternYmd, getNextEasternMidnightIso } from './triads-daily-timezone'

const ANONYMOUS_ID_PATTERN = /^[a-zA-Z0-9-]{8,128}$/
const MAX_PROGRESS_BYTES = 16 * 1024

@Injectable()
export class TriadsDailyService {
	constructor(private readonly prismaService: PrismaService) {}

	validateAnonymousId(anonymousId: string | undefined): asserts anonymousId is string {
		if (!anonymousId || !ANONYMOUS_ID_PATTERN.test(anonymousId)) {
			throw new BadRequestException('Header x-anonymous-id is required (8–128 alphanumeric or hyphen characters).')
		}
	}

	private shuffleInitialCues(triad1: string[], triad2: string[], triad3: string[]): string[] {
		return [...triad1, ...triad2, ...triad3].sort(() => Math.random() - 0.5)
	}

	async getDailyCues(anonymousId: string) {
		this.validateAnonymousId(anonymousId)

		const puzzleDateStr = getEasternYmd()
		const puzzleDate = easternYmdToDbDate(puzzleDateStr)
		const nextPuzzleAt = getNextEasternMidnightIso()

		const schedule = await this.prismaService.triadDailySchedule.findUnique({
			where: { puzzleDate },
			include: {
				TriadGroup: {
					include: {
						Triad1: { select: { keyword: true, fullPhrases: true } },
						Triad2: { select: { keyword: true, fullPhrases: true } },
						Triad3: { select: { keyword: true, fullPhrases: true } },
					},
				},
			},
		})

		if (!schedule) {
			return {
				scheduled: false as const,
				puzzleDate: puzzleDateStr,
				nextPuzzleAt,
				message: 'No puzzle scheduled for today.',
			}
		}

		const { TriadGroup: group } = schedule
		if (!group.active) {
			return {
				scheduled: false as const,
				puzzleDate: puzzleDateStr,
				nextPuzzleAt,
				message: 'Today’s puzzle is unavailable.',
			}
		}

		const triadGroupId = group.id

		const attempt = await this.prismaService.dailyTriadAttempt.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
		})

		if (attempt?.status === DailyAttemptStatus.WON || attempt?.status === DailyAttemptStatus.LOST) {
			return {
				scheduled: true as const,
				alreadyCompleted: true as const,
				attemptStatus: attempt.status,
				score: attempt.score,
				triadGroupId,
				puzzleDate: puzzleDateStr,
				nextPuzzleAt,
				cues: null,
			}
		}

		if (attempt?.status === DailyAttemptStatus.IN_PROGRESS) {
			return {
				scheduled: true as const,
				alreadyCompleted: false as const,
				attemptStatus: DailyAttemptStatus.IN_PROGRESS,
				triadGroupId,
				cues: attempt.scrambledCues,
				progress: attempt.progress ?? null,
				puzzleDate: puzzleDateStr,
				nextPuzzleAt,
			}
		}

		const triad1 = group.Triad1
		const triad2 = group.Triad2
		const triad3 = group.Triad3
		if (!triad1?.fullPhrases.length || !triad2?.fullPhrases.length || !triad3?.fullPhrases.length) {
			throw new BadRequestException('Today’s puzzle data is invalid.')
		}

		const cues = this.shuffleInitialCues(
			extractCuesFromPhrases(triad1.fullPhrases, triad1.keyword),
			extractCuesFromPhrases(triad2.fullPhrases, triad2.keyword),
			extractCuesFromPhrases(triad3.fullPhrases, triad3.keyword),
		)

		await this.prismaService.dailyTriadAttempt.create({
			data: {
				anonymousId,
				puzzleDate,
				triadGroupId,
				status: DailyAttemptStatus.IN_PROGRESS,
				scrambledCues: cues,
			},
		})

		return {
			scheduled: true as const,
			alreadyCompleted: false as const,
			attemptStatus: DailyAttemptStatus.IN_PROGRESS,
			triadGroupId,
			cues,
			progress: null,
			puzzleDate: puzzleDateStr,
			nextPuzzleAt,
		}
	}

	async saveDailyProgress(anonymousId: string, progress: unknown) {
		this.validateAnonymousId(anonymousId)

		if (progress === null || typeof progress !== 'object') {
			throw new BadRequestException('Progress payload must be a JSON object.')
		}

		const serialized = JSON.stringify(progress)
		if (serialized.length > MAX_PROGRESS_BYTES) {
			throw new BadRequestException('Progress payload is too large.')
		}

		const puzzleDateStr = getEasternYmd()
		const puzzleDate = easternYmdToDbDate(puzzleDateStr)

		const attempt = await this.prismaService.dailyTriadAttempt.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
			select: { id: true, status: true },
		})

		if (!attempt) {
			throw new NotFoundException('No daily game in progress for this player.')
		}

		// Silently ignore late saves for finished attempts so a stale client retry can't reopen a game.
		if (attempt.status !== DailyAttemptStatus.IN_PROGRESS) {
			return { ok: true as const, ignored: true as const }
		}

		await this.prismaService.dailyTriadAttempt.update({
			where: { id: attempt.id },
			data: { progress: progress as Prisma.InputJsonValue },
		})

		return { ok: true as const, ignored: false as const }
	}

	async completeDaily(anonymousId: string, outcome: 'won' | 'lost', score: number) {
		this.validateAnonymousId(anonymousId)

		const puzzleDateStr = getEasternYmd()
		const puzzleDate = easternYmdToDbDate(puzzleDateStr)

		const attempt = await this.prismaService.dailyTriadAttempt.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
		})

		if (!attempt) {
			throw new NotFoundException('No daily game in progress for this player.')
		}

		if (attempt.status === DailyAttemptStatus.WON || attempt.status === DailyAttemptStatus.LOST) {
			throw new ConflictException('This daily puzzle is already completed.')
		}

		const nextStatus = outcome === 'won' ? DailyAttemptStatus.WON : DailyAttemptStatus.LOST

		await this.prismaService.dailyTriadAttempt.update({
			where: { id: attempt.id },
			data: {
				status: nextStatus,
				score,
				progress: Prisma.JsonNull,
			},
		})

		return {
			ok: true as const,
			puzzleDate: puzzleDateStr,
			nextPuzzleAt: getNextEasternMidnightIso(),
		}
	}

	async listSchedules(offset = 0, limit = 50) {
		const take = Math.min(limit, 100)
		const rows = await this.prismaService.$queryRaw<Array<{ id: number; puzzleDate: Date; triadGroupId: number; challengeNumber: bigint }>>(Prisma.sql`
			SELECT
				s.id,
				s."puzzleDate",
				s."triadGroupId",
				ROW_NUMBER() OVER (ORDER BY s."puzzleDate" ASC, s.id ASC) AS "challengeNumber"
			FROM "triad_daily_schedules" s
			ORDER BY s."puzzleDate" DESC, s.id DESC
			OFFSET ${offset}
			LIMIT ${take}
		`)

		return rows.map((r) => ({
			id: r.id,
			puzzleDate: this.formatDbDateAsYmd(r.puzzleDate),
			triadGroupId: r.triadGroupId,
			challengeNumber: Number(r.challengeNumber),
		}))
	}

	async createSchedule(puzzleDateYmd: string, triadGroupId: number) {
		const puzzleDate = easternYmdToDbDate(puzzleDateYmd)
		const today = easternYmdToDbDate(getEasternYmd())

		const group = await this.prismaService.triadGroup.findFirst({
			where: { id: triadGroupId, active: true },
		})
		if (!group) {
			throw new NotFoundException(`Active triad group ${triadGroupId} not found.`)
		}

		try {
			const schedule = await this.prismaService.$transaction(async (tx) => {
				const dateSchedule = await tx.triadDailySchedule.findUnique({
					where: { puzzleDate },
					select: { id: true, puzzleDate: true, triadGroupId: true },
				})
				if (dateSchedule && dateSchedule.triadGroupId !== triadGroupId) {
					throw new ConflictException(`A puzzle is already scheduled for ${puzzleDateYmd}.`)
				}

				const groupSchedule = await tx.triadDailySchedule.findFirst({
					where: { triadGroupId },
					select: { id: true, puzzleDate: true, triadGroupId: true },
				})
				if (groupSchedule) {
					if (groupSchedule.puzzleDate.getTime() === puzzleDate.getTime()) {
						return groupSchedule
					}
					if (groupSchedule.puzzleDate.getTime() <= today.getTime()) {
						throw new ForbiddenException('Today and past daily schedules cannot be moved.')
					}
					if (puzzleDate.getTime() <= today.getTime()) {
						throw new ForbiddenException('Daily schedules can only be moved to a future date.')
					}
					return tx.triadDailySchedule.update({
						where: { id: groupSchedule.id },
						data: { puzzleDate },
						select: {
							id: true,
							puzzleDate: true,
							triadGroupId: true,
						},
					})
				}

				return tx.triadDailySchedule.create({
					data: {
						puzzleDate,
						TriadGroup: {
							connect: { id: triadGroupId },
						},
					},
					select: {
						id: true,
						puzzleDate: true,
						triadGroupId: true,
					},
				})
			})
			const challengeNumber = await this.computeChallengeNumberForDate(schedule.puzzleDate)
			return {
				id: schedule.id,
				puzzleDate: this.formatDbDateAsYmd(schedule.puzzleDate),
				triadGroupId: schedule.triadGroupId,
				challengeNumber,
			}
		} catch (e) {
			if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
				throw new ConflictException(`A puzzle is already scheduled for ${puzzleDateYmd}.`)
			}
			throw e
		}
	}

	private async computeChallengeNumberForDate(puzzleDate: Date): Promise<number> {
		const rank = await this.prismaService.triadDailySchedule.count({
			where: {
				puzzleDate: {
					lte: puzzleDate,
				},
			},
		})
		return rank
	}

	/** Eastern-calendar “today” puzzle metadata for the landing page (challenge # = 100 + date-ordered schedule rank). */
	async getTodayPublicInfo(anonymousId?: string) {
		const puzzleDateStr = getEasternYmd()
		const puzzleDate = easternYmdToDbDate(puzzleDateStr)

		const schedule = await this.prismaService.triadDailySchedule.findUnique({
			where: { puzzleDate },
			select: { triadGroupId: true },
		})

		if (!schedule) {
			const base = { scheduled: false as const, puzzleDate: puzzleDateStr }
			if (!anonymousId || !ANONYMOUS_ID_PATTERN.test(anonymousId)) {
				return base
			}
			const classicExtra = await this.getClassicExtraUsage(anonymousId)
			return { ...base, ...classicExtra }
		}

		const challengeNumber = await this.computeChallengeNumberForDate(puzzleDate)

		const base = {
			scheduled: true as const,
			puzzleDate: puzzleDateStr,
			triadGroupId: schedule.triadGroupId,
			challengeNumber,
		}

		if (!anonymousId || !ANONYMOUS_ID_PATTERN.test(anonymousId)) {
			return base
		}

		const attempt = await this.prismaService.dailyTriadAttempt.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
			select: { status: true },
		})

		const hasCompletedDaily = attempt?.status === DailyAttemptStatus.WON || attempt?.status === DailyAttemptStatus.LOST
		const classicExtra = await this.getClassicExtraUsage(anonymousId)

		return { ...base, hasCompletedDaily, ...classicExtra }
	}

	async deleteSchedule(id: number) {
		try {
			const schedule = await this.prismaService.triadDailySchedule.findUnique({
				where: { id },
				select: { id: true, puzzleDate: true },
			})
			if (!schedule) {
				throw new NotFoundException(`Schedule ${id} not found.`)
			}
			const today = easternYmdToDbDate(getEasternYmd())
			if (schedule.puzzleDate.getTime() <= today.getTime()) {
				throw new ForbiddenException('Today and past daily schedules cannot be removed.')
			}
			await this.prismaService.triadDailySchedule.delete({
				where: { id },
			})
			return { success: true as const }
		} catch (e) {
			if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
				throw new NotFoundException(`Schedule ${id} not found.`)
			}
			if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2025') {
				throw new NotFoundException(`Schedule ${id} not found.`)
			}
			throw e
		}
	}

	private formatDbDateAsYmd(d: Date): string {
		const y = d.getUTCFullYear()
		const m = String(d.getUTCMonth() + 1).padStart(2, '0')
		const day = String(d.getUTCDate()).padStart(2, '0')
		return `${y}-${m}-${day}`
	}

	private async getDailyGateContext(anonymousId: string, puzzleDate: Date) {
		const schedule = await this.prismaService.triadDailySchedule.findUnique({
			where: { puzzleDate },
			select: { triadGroupId: true },
		})

		const attempt = await this.prismaService.dailyTriadAttempt.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
			select: { status: true },
		})

		const dailyScheduled = Boolean(schedule)
		const hasCompletedDaily = attempt?.status === DailyAttemptStatus.WON || attempt?.status === DailyAttemptStatus.LOST

		return { dailyScheduled, hasCompletedDaily }
	}

	async getClassicExtraUsage(anonymousId: string): Promise<ClassicExtraUsageInfo> {
		this.validateAnonymousId(anonymousId)

		const puzzleDate = easternYmdToDbDate(getEasternYmd())
		const usage = await this.prismaService.dailyClassicExtraUsage.findUnique({
			where: {
				anonymousId_puzzleDate: {
					anonymousId,
					puzzleDate,
				},
			},
			select: { gamesStarted: true },
		})

		const gate = await this.getDailyGateContext(anonymousId, puzzleDate)

		return buildClassicExtraUsageInfo(usage?.gamesStarted ?? 0, gate.dailyScheduled, gate.hasCompletedDaily)
	}

	private classicBlockedMessage(blockedReason: ClassicExtraUsageInfo['classicBlockedReason']): string {
		if (blockedReason === 'daily_required') {
			return "Complete today's Daily to unlock Classic."
		}
		if (blockedReason === 'capacity_reached') {
			return "You've reached today's limit. Come back tomorrow after the Daily."
		}
		return 'Classic is unavailable right now.'
	}

	async assertCanStartClassicExtra(anonymousId: string): Promise<ClassicExtraUsageInfo> {
		const usage = await this.getClassicExtraUsage(anonymousId)
		if (!usage.canPlayClassic) {
			throw new ForbiddenException({
				message: this.classicBlockedMessage(usage.classicBlockedReason),
				...usage,
			})
		}
		return usage
	}

	async incrementClassicExtraStart(anonymousId: string): Promise<ClassicExtraUsageInfo> {
		this.validateAnonymousId(anonymousId)

		const puzzleDate = easternYmdToDbDate(getEasternYmd())

		return this.prismaService.$transaction(async (tx) => {
			const usageRow = await tx.dailyClassicExtraUsage.findUnique({
				where: {
					anonymousId_puzzleDate: {
						anonymousId,
						puzzleDate,
					},
				},
				select: { gamesStarted: true },
			})

			const schedule = await tx.triadDailySchedule.findUnique({
				where: { puzzleDate },
				select: { triadGroupId: true },
			})

			const attempt = await tx.dailyTriadAttempt.findUnique({
				where: {
					anonymousId_puzzleDate: {
						anonymousId,
						puzzleDate,
					},
				},
				select: { status: true },
			})

			const dailyScheduled = Boolean(schedule)
			const hasCompletedDaily = attempt?.status === DailyAttemptStatus.WON || attempt?.status === DailyAttemptStatus.LOST
			const used = usageRow?.gamesStarted ?? 0
			const usageInfo = buildClassicExtraUsageInfo(used, dailyScheduled, hasCompletedDaily)

			if (!usageInfo.canPlayClassic) {
				throw new ForbiddenException({
					message: this.classicBlockedMessage(usageInfo.classicBlockedReason),
					...usageInfo,
				})
			}

			const updated = await tx.dailyClassicExtraUsage.upsert({
				where: {
					anonymousId_puzzleDate: {
						anonymousId,
						puzzleDate,
					},
				},
				create: {
					anonymousId,
					puzzleDate,
					gamesStarted: 1,
				},
				update: {
					gamesStarted: { increment: 1 },
				},
				select: { gamesStarted: true },
			})

			return buildClassicExtraUsageInfo(updated.gamesStarted, dailyScheduled, hasCompletedDaily)
		})
	}
}
