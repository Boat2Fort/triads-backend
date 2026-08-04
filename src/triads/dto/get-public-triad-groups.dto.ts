import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class GetPublicTriadGroupsDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	offset?: number

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(50)
	limit?: number
}
