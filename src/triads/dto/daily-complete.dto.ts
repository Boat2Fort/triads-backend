import { IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'

export class DailyCompleteDto {
	@IsOptional()
	@IsDateString({ strict: true })
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	puzzleDate?: string

	@IsIn(['won', 'lost'])
	outcome!: 'won' | 'lost'

	@IsInt()
	@Min(0)
	@Max(15)
	score!: number
}
