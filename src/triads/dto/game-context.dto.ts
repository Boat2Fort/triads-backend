import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Min } from 'class-validator'

export class GameContextDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@IsOptional()
	triadGroupId?: number

	@IsIn(['INITIAL', 'FINAL'])
	@IsOptional()
	triadsStep?: 'INITIAL' | 'FINAL'
}
